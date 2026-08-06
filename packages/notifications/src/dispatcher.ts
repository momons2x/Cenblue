import type { NotificationOutboxRepository } from "@cenblu/database";
import type { NotificationTransport } from "./telegram-transport";

export type DispatcherConfig = {
  maxAttempts: number;
  maxBackoffMs: number;
  staleAfterMs: number;
};

export class NotificationDispatcher {
  constructor(
    private readonly outbox: NotificationOutboxRepository,
    private readonly transport: NotificationTransport,
    private readonly config: DispatcherConfig,
  ) {}

  async runOnce(now = new Date()): Promise<number> {
    const staleBefore = new Date(now.getTime() - this.config.staleAfterMs);
    let sent = 0;
    while (true) {
      const item = await this.outbox.claimNext(now, staleBefore);
      if (!item) break;
      const result = await this.transport.send(item.recipient, item.text);
      if (result.ok) {
        await this.outbox.complete(item.id, item.claimToken, now);
        sent += 1;
        continue;
      }
      const attemptCount = await this.attemptCountFor(item.id);
      const dead = attemptCount >= this.config.maxAttempts;
      const retryAfter = result.retryAfterSeconds ?? this.backoffMs(attemptCount) / 1_000;
      const nextAttemptAt = dead ? null : new Date(now.getTime() + retryAfter * 1_000);
      await this.outbox.fail(item.id, item.claimToken, result.error ?? "Telegram delivery failed", nextAttemptAt, dead);
    }
    return sent;
  }

  private async attemptCountFor(id: string): Promise<number> {
    return this.outbox.attemptCount(id);
  }

  private backoffMs(attempt: number): number {
    const exponential = 60_000 * 2 ** Math.max(attempt - 1, 0);
    return Math.min(exponential, this.config.maxBackoffMs);
  }
}
