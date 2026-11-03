import { ActivityType, Client, GatewayIntentBits, type Message } from "discord.js";
import type { Logger } from "pino";
import { NotificationOutboxRepository, PipelineStatusRepository, prisma, RuntimeStatusRepository } from "@cenblu/database";
import { setActiveDiscordClient, getActiveDiscordClient } from "./registry";
import { DiscordDmTransport } from "./dm-transport";

export const commandPrefix = "!";
export const commandHelp = "Commands: !status, !pipeline, !published, !test, !help";

export type DiscordBotOptions = {
  token: string;
  ownerId: string;
  logger: Logger;
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
    else if (command === "published") await this.publishedCommand(message);
    else if (command === "test") await this.testCommand(message);
    else if (command === "help") await message.reply(commandHelp);
  }

  private async publishedCommand(message: Message): Promise<void> {
    const published = await new PipelineStatusRepository(prisma).listPublished(10);
    if (published.length === 0) {
      await message.reply("No published posts yet.");
      return;
    }
    const lines = ["Recent published posts:"];
    for (const entry of published) {
      const time = new Intl.DateTimeFormat("en", { dateStyle: "short", timeStyle: "short" }).format(entry.publishedAt);
      const media = entry.mediaRemoved ? "media removed" : "media local";
      const publisher = entry.publisherLabel ?? "unknown";
      const anchor = entry.platformUrl ? ` · [post](<${entry.platformUrl}>)` : "";
      lines.push(`- ${entry.platformPostId} · ${publisher} · ${time} · ${media}${anchor}`);
    }
    await message.reply(lines.join("\n"));
  }

  private async statusCommand(message: Message): Promise<void> {
    const outbox = new NotificationOutboxRepository(prisma);
    const [summary, delivered, failure] = await Promise.all([outbox.statusSummary(), outbox.latestDelivery(), outbox.latestFailure()]);
    const lines = [
      "Notification status:",
      `  Discord: ${getActiveDiscordClient() ? "connected" : "not connected"}`,
      `  Outbox: ${summary.pending} pending · ${summary.sent} sent · ${summary.dead} dead`,
    ];
    if (delivered) lines.push(`  Last sent: ${delivered.sentAt.toISOString()}`);
    if (failure?.error) lines.push(`  Last error: ${failure.error}`);
    await message.reply(lines.join("\n"));
  }

  private async pipelineCommand(message: Message): Promise<void> {
    const report = await new PipelineStatusRepository(prisma).render();
    await message.reply(`Pipeline status:\n${report}`);
  }

  private async testCommand(message: Message): Promise<void> {
    const result = await new DiscordDmTransport().send(this.options.ownerId, "Cenblue test message — notifications are working.");
    await message.reply(result.ok ? "Test message delivered." : `Test message failed: ${result.error ?? "unknown error"}`);
  }
}
