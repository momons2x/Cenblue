import { ActivityType, Client, GatewayIntentBits, type Message } from "discord.js";
import type { Logger } from "pino";
import { NotificationOutboxRepository, PipelineStatusRepository, prisma, RuntimeStatusRepository } from "@cenblu/database";
import { NotificationStatusService, TelegramTransport } from "@cenblu/notifications";
import { setActiveDiscordClient } from "./registry";

export const commandPrefix = "!";
export const commandHelp = "Commands: !status, !pipeline, !test, !help";

export type DiscordBotOptions = {
  token: string;
  ownerId: string;
  logger: Logger;
  notification?: {
    telegramBotToken: string | undefined;
    telegramChatId: string | null;
  };
  pipelineTimeZone?: string;
};

export function parseCommand(content: string): string | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith(commandPrefix)) return null;
  const command = trimmed.slice(commandPrefix.length).trim().split(/\s+/)[0].toLowerCase();
  return command || null;
}

export class DiscordBot {
  readonly client = new Client({ intents: [GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent] });
  private readonly runtime = new RuntimeStatusRepository(prisma);

  constructor(private readonly options: DiscordBotOptions) {
    this.client.once("ready", async (client) => {
      setActiveDiscordClient(client);
      try {
        await client.user?.setPresence({ status: "online", activities: [{ name: "Cenblue", type: ActivityType.Playing }] });
      } catch (error) {
        this.options.logger.warn({ operation: "discord-bot.presence.failed", error: error instanceof Error ? error.message : String(error) }, "Could not set Discord presence");
      }
      await this.runtime.update("discord-bot", "READY", "gateway connected");
      this.options.logger.info({ operation: "discord-bot.ready", user: client.user?.tag }, "Discord bot connected");
    });
    this.client.on("reconnecting", () => this.options.logger.warn({ operation: "discord-bot.reconnecting" }, "Discord bot reconnecting"));
    this.client.on("error", (error) => this.options.logger.error({ operation: "discord-bot.error", error: error.message }, "Discord bot error"));
    this.client.on("messageCreate", (message) => {
      void this.handleMessage(message).catch((error) => {
        this.options.logger.error({ operation: "discord-bot.command.failed", error: error instanceof Error ? error.message : String(error) }, "Discord command failed");
      });
    });
  }

  async start(): Promise<void> {
    await this.client.login(this.options.token);
  }

  async stop(): Promise<void> {
    setActiveDiscordClient(null);
    await this.runtime.update("discord-bot", "OFFLINE", undefined, "Bot stopped");
    await this.client.destroy();
  }

  private async handleMessage(message: Message): Promise<void> {
    if (message.author.bot) return;
    if (message.channel.type !== 1) return;
    if (message.author.id !== this.options.ownerId) {
      await message.reply("This bot is restricted to its owner.").catch(() => undefined);
      return;
    }
    const command = parseCommand(message.content);
    if (!command) return;
    if (command === "status") await this.statusCommand(message);
    else if (command === "pipeline") await this.pipelineCommand(message);
    else if (command === "test") await this.testCommand(message);
    else if (command === "help") await message.reply(commandHelp);
  }

  private async statusCommand(message: Message): Promise<void> {
    const outbox = new NotificationOutboxRepository(prisma);
    const transport = this.options.notification?.telegramBotToken ? new TelegramTransport(this.options.notification.telegramBotToken) : null;
    const status = await new NotificationStatusService(transport, outbox).withChat(this.options.notification?.telegramChatId ?? "");
    const lines = [
      "Notification status:",
      `  Telegram: ${status.tokenConfigured ? (status.tokenValid ? `connected${status.botUsername ? ` (@${status.botUsername})` : ""}` : "token invalid") : "not configured"}`,
      `  Chat: ${status.chatReachable ? "reachable" : "not reachable"}`,
      `  Outbox: ${status.outbox.pending} pending · ${status.outbox.sent} sent · ${status.outbox.dead} dead`,
    ];
    if (status.lastDeliveredAt) lines.push(`  Last sent: ${new Date(status.lastDeliveredAt).toISOString()}`);
    if (status.lastError) lines.push(`  Last error: ${status.lastError}`);
    await message.reply(lines.join("\n"));
  }

  private async pipelineCommand(message: Message): Promise<void> {
    const report = await new PipelineStatusRepository(prisma).render();
    await message.reply(`Pipeline status:\n${report}`);
  }

  private async testCommand(message: Message): Promise<void> {
    const notification = this.options.notification;
    if (!notification?.telegramBotToken) {
      await message.reply("No Telegram token is configured in .env.");
      return;
    }
    if (!notification.telegramChatId) {
      await message.reply("No Telegram chat ID is configured in Settings.");
      return;
    }
    const result = await new TelegramTransport(notification.telegramBotToken).send(notification.telegramChatId, "Cenblue test message — triggered from Discord.");
    await message.reply(result.ok ? "Test message delivered." : `Test message failed: ${result.error ?? "unknown error"}`);
  }
}
