import { Client, GatewayIntentBits, SlashCommandBuilder, type ChatInputCommandInteraction, type Interaction } from "discord.js";
import type { Logger } from "pino";
import { NotificationOutboxRepository, PipelineStatusRepository, prisma } from "@cenblu/database";
import { NotificationStatusService, TelegramTransport } from "@cenblu/notifications";

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

export const botCommands = [
  new SlashCommandBuilder().setName("status").setDescription("Show notification and pipeline status"),
  new SlashCommandBuilder().setName("pipeline").setDescription("Show pipeline activity summary"),
  new SlashCommandBuilder().setName("test").setDescription("Send a test notification"),
  new SlashCommandBuilder().setName("help").setDescription("List available commands"),
].map((command) => command.toJSON());

export class DiscordBot {
  readonly client = new Client({ intents: [GatewayIntentBits.DirectMessages] });

  constructor(private readonly options: DiscordBotOptions) {
    this.client.once("ready", (client) => {
      this.options.logger.info({ operation: "discord-bot.ready", user: client.user?.tag }, "Discord bot connected");
    });
    this.client.on("reconnecting", () => this.options.logger.warn({ operation: "discord-bot.reconnecting" }, "Discord bot reconnecting"));
    this.client.on("error", (error) => this.options.logger.error({ operation: "discord-bot.error", error: error.message }, "Discord bot error"));
    this.client.on("interactionCreate", (interaction) => {
      void this.handleInteraction(interaction).catch((error) => {
        this.options.logger.error({ operation: "discord-bot.command.failed", error: error instanceof Error ? error.message : String(error) }, "Discord command failed");
      });
    });
  }

  async start(): Promise<void> {
    await this.client.login(this.options.token);
  }

  async stop(): Promise<void> {
    await this.client.destroy();
  }

  private isAuthorized(interaction: Interaction): boolean {
    return "user" in interaction && interaction.user !== null && interaction.user.id === this.options.ownerId;
  }

  private isDirectMessage(interaction: Interaction): boolean {
    return "channel" in interaction && interaction.channel !== null && interaction.channel.type === 1;
  }

  private async handleInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.isChatInputCommand()) return;
    if (!this.isAuthorized(interaction)) {
      if (this.isDirectMessage(interaction) && interaction.isRepliable()) {
        await interaction.reply({ content: "This bot is restricted to its owner.", ephemeral: true });
      }
      return;
    }
    if (!this.isDirectMessage(interaction)) {
      await interaction.reply({ content: "Commands work only in a direct message with the bot.", ephemeral: true });
      return;
    }
    const command = interaction.commandName;
    if (command === "status") await this.statusCommand(interaction);
    else if (command === "pipeline") await this.pipelineCommand(interaction);
    else if (command === "test") await this.testCommand(interaction);
    else if (command === "help") await interaction.reply({ content: "Commands: /status, /pipeline, /test, /help" });
  }

  private async statusCommand(interaction: ChatInputCommandInteraction): Promise<void> {
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
    await interaction.reply({ content: lines.join("\n") });
  }

  private async pipelineCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const report = await new PipelineStatusRepository(prisma).render();
    await interaction.reply({ content: `Pipeline status:\n${report}`, ephemeral: true });
  }

  private async testCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const notification = this.options.notification;
    if (!notification?.telegramBotToken) {
      await interaction.reply({ content: "No Telegram token is configured in .env.", ephemeral: true });
      return;
    }
    if (!notification.telegramChatId) {
      await interaction.reply({ content: "No Telegram chat ID is configured in Settings.", ephemeral: true });
      return;
    }
    const result = await new TelegramTransport(notification.telegramBotToken).send(notification.telegramChatId, "Cenblue test message — triggered from Discord.");
    await interaction.reply({ content: result.ok ? "Test message delivered." : `Test message failed: ${result.error ?? "unknown error"}`, ephemeral: true });
  }
}
