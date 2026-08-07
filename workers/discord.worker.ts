import { applyStoredSettings, loadConfig } from "@cenblu/config";
import { prisma, SettingsRepository } from "@cenblu/database";
import { DiscordBot } from "@cenblu/discord-bot";
import { createLogger } from "@cenblu/shared/logger";

async function main(): Promise<void> {
  const config = applyStoredSettings(loadConfig(), await new SettingsRepository(prisma).getAll());
  if (!config.discordBotToken || !config.discordOwnerId) throw new Error("Set DISCORD_BOT_TOKEN and DISCORD_OWNER_ID in .env to run the Discord bot.");
  const logger = createLogger({ directory: config.logStoragePath, component: "discord-bot", maxBytes: config.logMaxBytes, retainedFiles: config.logRetainedFiles });
  const stored = await new SettingsRepository(prisma).getAll();
  const bot = new DiscordBot({
    token: config.discordBotToken,
    ownerId: config.discordOwnerId,
    logger,
    notification: { telegramBotToken: config.telegramBotToken ?? undefined, telegramChatId: stored.TELEGRAM_CHAT_ID ?? null },
    pipelineTimeZone: config.timezone,
  });
  await bot.start();
  logger.info({ operation: "discord-bot.started" }, "Discord bot started; send /help to the bot in a DM. Press Ctrl+C to stop.");
  const shutdown = async () => {
    await bot.stop();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.once("SIGINT", () => { void shutdown(); });
  process.once("SIGTERM", () => { void shutdown(); });
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
  process.exit(1);
});
