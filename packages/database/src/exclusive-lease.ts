import { ResourceBusyError, type ExclusiveLease } from "@cenblu/shared/lease";
import type { SchedulerRepository, SchedulerLease } from "./scheduler.repository";

const POLL_INTERVAL_MS = 500;

export class DatabaseExclusiveLease implements ExclusiveLease {
  constructor(
    private readonly repository: SchedulerRepository,
    private readonly name: string,
    private readonly leaseMs: number,
    private readonly waitMs = 0,
  ) {}

  private async acquire(now: Date): Promise<SchedulerLease | null> {
    const held = await this.repository.acquire(this.name, now, this.leaseMs);
    if (held) return held;
    if (this.waitMs <= 0) return null;
    const deadline = now.getTime() + this.waitMs;
    while (Date.now() < deadline) {
      await new Promise((resolveSleep) => { setTimeout(resolveSleep, POLL_INTERVAL_MS); });
      const retry = await this.repository.acquire(this.name, new Date(), this.leaseMs);
      if (retry) return retry;
    }
    return null;
  }

  async run<T>(operation: (signal?: AbortSignal) => Promise<T>): Promise<T> {
    const lease = await this.acquire(new Date());
    if (!lease) throw new ResourceBusyError(`Resource is already in use: ${this.name}`);
    const controller = new AbortController();
    let renewing = false;
    const renewals = new Set<Promise<void>>();
    const timer = setInterval(() => {
      if (renewing) return;
      renewing = true;
      const renewal = this.repository.renew(lease, new Date(), this.leaseMs)
        .then((renewed) => {
          if (!renewed) controller.abort(new ResourceBusyError(`Lease was lost: ${this.name}`));
        })
        .catch((error) => controller.abort(error))
        .finally(() => { renewing = false; renewals.delete(renewal); });
      renewals.add(renewal);
    }, Math.max(1_000, Math.floor(this.leaseMs / 3)));
    timer.unref();
    try { return await operation(controller.signal); }
    finally {
      clearInterval(timer);
      await Promise.allSettled(renewals);
      await this.repository.release(lease);
    }
  }
}
