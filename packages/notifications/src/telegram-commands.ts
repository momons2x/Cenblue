import type { NotificationOutboxRepository, PipelineStatusRepository } from "@cenblu/database";
import type { TelegramTransport, TelegramUpdate } from "./telegram-transport";
import { NotificationStatusService } from "./notification-status";

export type TelegramCommandOptions = {
  chatId: string;
  transport: TelegramTransport;
  outbox: NotificationOutboxRepository;
  pipeline: PipelineStatusRepository;
};

export type TelegramCommandResult = { handled: boolean; replied?: boolean };

export function parseTelegramCommand(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const command = trimmed.slice(1).trim().split(/\s+/)[0].toLowerCase();
  return command || null;
}

export class TelegramCommandHandler {
  constructor(private readonly options: TelegramCommandOptions) {}

  async handle(update: TelegramUpdate): Promise<TelegramCommandResult> {
    if (update.chatId !== this.options.chatId) return { handled: false };
    const command = parseTelegramCommand(update.text);
    if (!command) return { handled: false };
    if (command === "status") {
      await this.reply(await this.statusText());
      return { handled: true, replied: true };
    }
    if (command === "pipeline") {
      const report = await this.options.pipeline.render();
      await this.reply(`Pipeline status:\n${report}`);
      return { handled: true, replied: true };
    }
    if (command === "test") {
      const result = await this.options.transport.send(this.options.chatId, "Cenblue test message — triggered from Telegram.");
      await this.reply(result.ok ? "Test message delivered." : `Test message failed: ${result.error ?? "unknown error"}`);
      return { handled: true, replied: true };
    }
    if (command === "help") {
      await this.reply("Commands: /status, /pipeline, /test, /help");
      return { handled: true, replied: true };
    }
    return { handled: false };
  }

  private async statusText(): Promise<string> {
    const status = await new NotificationStatusService(this.options.transport, this.options.outbox).withChat(this.options.chatId);
    const lines = [
      "Notification status:",
      `  Telegram: ${status.tokenConfigured ? (status.tokenValid ? `connected${status.botUsername ? ` (@${status.botUsername})` : ""}` : "token invalid") : "not configured"}`,
      `  Chat: ${status.chatReachable ? "reachable" : "not reachable"}`,
      `  Outbox: ${status.outbox.pending} pending · ${status.outbox.sent} sent · ${status.outbox.dead} dead`,
    ];
    if (status.lastDeliveredAt) lines.push(`  Last sent: ${new Date(status.lastDeliveredAt).toISOString()}`);
    if (status.lastError) lines.push(`  Last error: ${status.lastError}`);
    return lines.join("\n");
  }

  private async reply(text: string): Promise<void> {
    await this.options.transport.send(this.options.chatId, text);
  }
}
