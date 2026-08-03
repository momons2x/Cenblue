import { ResourceBusyError, type ExclusiveLease } from "@cenblu/shared/lease";
import type { SchedulerRepository } from "./scheduler.repository";

export class DatabaseExclusiveLease implements ExclusiveLease {
  constructor(
    private readonly repository: SchedulerRepository,
    private readonly name: string,
    private readonly leaseMs: number,
  ) {}

  async run<T>(operation: (signal?: AbortSignal) => Promise<T>): Promise<T> {
    const lease = await this.repository.acquire(this.name, new Date(), this.leaseMs);
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
