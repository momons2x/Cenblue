import pino from "pino";
import { applyStoredSettings, loadConfig } from "@cenblu/config";
import { prisma, SettingsRepository } from "@cenblu/database";
import { DiscordBot } from "@cenblu/discord-bot";

type BotState = { bot: DiscordBot | null; started: boolean };
const globalState = globalThis as typeof globalThis & { __cenbluDiscordBot?: BotState };

export async function startDiscordBot(): Promise<void> {
  if (globalState.__cenbluDiscordBot?.started) return;
  if (!process.env.CENBLU_ROOT || !process.env.DATABASE_URL) return;
  const config = applyStoredSettings(loadConfig(), await new SettingsRepository(prisma).getAll());
  if (!config.discordBotToken || !config.discordOwnerId) return;
  const logger = pino({ name: "discord-bot" });
  const stored = await new SettingsRepository(prisma).getAll();
  const bot = new DiscordBot({
    token: config.discordBotToken,
    ownerId: config.discordOwnerId,
    logger,
    notification: { telegramBotToken: config.telegramBotToken ?? undefined, telegramChatId: stored.TELEGRAM_CHAT_ID ?? null },
    pipelineTimeZone: config.timezone,
  });
  globalState.__cenbluDiscordBot = { bot, started: true };
  try {
    await bot.start();
    logger.info({ operation: "discord-bot.started" }, "Discord bot started with the dashboard");
  } catch (error) {
    logger.error({ operation: "discord-bot.start.failed", error: error instanceof Error ? error.message : String(error) }, "Discord bot failed to start");
  }
}
