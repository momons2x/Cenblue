import type { NotificationOutboxRepository, OperationalEventRepository } from "@cenblu/database";

export type NotificationChannel = "telegram" | "discord";

export type NotificationSettings = {
  enabled: boolean;
  channels: Partial<Record<NotificationChannel, string>>;
};

export type PublishFailureContext = {
  jobId: string;
  platformPostId: string;
  publisherIdentityId: string | null;
  error: string;
  attemptCount: number;
  manualAttention: boolean;
  retryable: boolean;
};

export class NotificationEmitter {
  constructor(
    private readonly events: OperationalEventRepository,
    private readonly outbox: NotificationOutboxRepository,
    private readonly dedupeWindowMs = 6 * 60 * 60_000,
    private readonly resolvePublisherLabel?: (identityId: string) => Promise<string | null>,
  ) {}

  async emitPublishFailure(context: PublishFailureContext, settings: NotificationSettings, now = new Date()): Promise<boolean> {
    if (!settings.enabled) return false;
    const recipients = Object.entries(settings.channels).filter((entry): entry is [NotificationChannel, string] => Boolean(entry[1]));
    if (recipients.length === 0) return false;
    const dedupeKey = `publish-failure:${context.jobId}`;
    if (await this.events.hasRecentDedupe(dedupeKey, now)) return false;
    const severity = context.manualAttention ? "CRITICAL" : "ERROR";
    const label = context.publisherIdentityId
      ? (await this.resolvePublisherLabel?.(context.publisherIdentityId)) ?? "unknown publisher"
      : "unassigned publisher";
    const attention = context.manualAttention ? "\nManual review required before retrying." : context.retryable ? "\nAutomatic retry will be scheduled." : "\nNot retrying automatically.";
    const message = `Publication failed for X post ${context.platformPostId} (${label}, attempt ${context.attemptCount}).\n${context.error}${attention}`;
    await this.events.insert({
      type: "publish.failed",
      severity,
      component: "publisher",
      message,
      meta: JSON.stringify({ jobId: context.jobId, platformPostId: context.platformPostId }),
      dedupeKey,
      dedupeUntil: new Date(now.getTime() + this.dedupeWindowMs),
    });
    for (const [channel, recipient] of recipients) {
      await this.outbox.enqueue({ channel, recipient, text: message }, now);
    }
    return true;
  }

  async sendTestMessage(settings: NotificationSettings, now = new Date()): Promise<boolean> {
    if (!settings.enabled) return false;
    const recipients = Object.entries(settings.channels).filter((entry): entry is [NotificationChannel, string] => Boolean(entry[1]));
    for (const [channel, recipient] of recipients) {
      await this.outbox.enqueue({ channel, recipient, text: "Cenblue test message — notifications are working." }, now);
    }
    return recipients.length > 0;
  }
}
