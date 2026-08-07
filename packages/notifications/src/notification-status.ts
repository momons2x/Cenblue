import type { NotificationOutboxRepository } from "@cenblu/database";
import type { TelegramBotInfo, TelegramTransport } from "./telegram-transport";

export type NotificationStatus = {
  tokenConfigured: boolean;
  tokenValid: boolean;
  botUsername: string | null;
  chatSet: boolean;
  chatReachable: boolean;
  chatTitle: string | null;
  outbox: { pending: number; sending: number; sent: number; failed: number; dead: number };
  lastDeliveredAt: string | null;
  lastError: string | null;
};

export class NotificationStatusService {
  constructor(
    private readonly transport: TelegramTransport | null,
    private readonly outbox: NotificationOutboxRepository,
  ) {}

  async status(): Promise<NotificationStatus> {
    const [bot, outbox, delivered, failure] = await Promise.all([
      this.transport ? this.transport.getMe() : Promise.resolve<TelegramBotInfo>({ ok: false, error: "Bot token is not configured" }),
      this.outbox.statusSummary(),
      this.outbox.latestDelivery(),
      this.outbox.latestFailure(),
    ]);
    return {
      tokenConfigured: Boolean(this.transport),
      tokenValid: bot.ok,
      botUsername: bot.ok ? bot.username ?? null : null,
      chatSet: true,
      chatReachable: bot.ok,
      chatTitle: null,
      outbox,
      lastDeliveredAt: delivered?.sentAt.toISOString() ?? null,
      lastError: failure?.error ?? null,
    };
  }

  async withChat(chatId: string): Promise<NotificationStatus> {
    const base = await this.status();
    if (!this.transport) return base;
    const chat = await this.transport.getChat(chatId);
    return { ...base, chatSet: Boolean(chatId), chatReachable: chat.ok, chatTitle: chat.ok ? chat.title ?? null : null, lastError: chat.ok ? base.lastError : chat.error ?? null };
  }
}
