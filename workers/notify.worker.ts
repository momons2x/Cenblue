import { applyStoredSettings, loadConfig } from "@cenblu/config";
import { NotificationOutboxRepository, prisma, SettingsRepository } from "@cenblu/database";
import { NotificationStatusService, TelegramTransport } from "@cenblu/notifications";

async function main(): Promise<void> {
  const config = applyStoredSettings(loadConfig(), await new SettingsRepository(prisma).getAll());
  const stored = await new SettingsRepository(prisma).getAll();
  const outbox = new NotificationOutboxRepository(prisma);
  const transport = config.telegramBotToken ? new TelegramTransport(config.telegramBotToken) : null;
  const status = new NotificationStatusService(transport, outbox);
  const command = process.argv[2];

  if (command === "status") {
    const report = await status.withChat(stored.TELEGRAM_CHAT_ID ?? "");
    console.log(`Bot token:   ${report.tokenConfigured ? (report.tokenValid ? `valid${report.botUsername ? ` (@${report.botUsername})` : ""}` : "set but INVALID") : "not configured"}`);
    console.log(`Chat ID:     ${report.chatSet ? (report.chatReachable ? `reachable${report.chatTitle ? ` (${report.chatTitle})` : ""}` : "NOT reachable") : "not set"}`);
    console.log(`Outbox:      ${report.outbox.pending} pending · ${report.outbox.sending} sending · ${report.outbox.sent} sent · ${report.outbox.dead} dead`);
    if (report.lastDeliveredAt) console.log(`Last sent:   ${new Date(report.lastDeliveredAt).toLocaleString()}`);
    if (report.lastError) console.log(`Last error:  ${report.lastError}`);
    if (!report.tokenValid || (report.chatSet && !report.chatReachable)) process.exitCode = 1;
    return;
  }

  if (command === "test") {
    if (!config.telegramBotToken) throw new Error("TELEGRAM_BOT_TOKEN is not set in .env");
    const chatId = stored.TELEGRAM_CHAT_ID;
    if (!chatId) throw new Error("TELEGRAM_CHAT_ID is not set in Settings");
    const result = await new TelegramTransport(config.telegramBotToken).send(chatId, "Cenblue test message — notifications are working.");
    if (result.ok) { console.log("Test message delivered."); return; }
    console.error(`Test message failed: ${result.error ?? "unknown error"}`);
    process.exitCode = 1;
    return;
  }

  throw new Error("Use one of: status, test");
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
