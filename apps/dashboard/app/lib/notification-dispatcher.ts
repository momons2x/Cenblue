import pino from "pino";
import { applyStoredSettings, loadConfig } from "@cenblu/config";
import { NotificationOutboxRepository, prisma, SettingsRepository } from "@cenblu/database";
import { NotificationDispatcher, TelegramTransport } from "@cenblu/notifications";

const cadenceMs = 15_000;

type DispatcherLoop = { timer: NodeJS.Timeout; running: boolean };
const globalState = globalThis as typeof globalThis & { __cenbluNotificationDispatcher?: DispatcherLoop };

export function startNotificationDispatcher(): void {
  if (globalState.__cenbluNotificationDispatcher) return;
  const state: DispatcherLoop = { timer: undefined as unknown as NodeJS.Timeout, running: false };
  const logger = pino({ name: "notification-dispatcher" });
  const trigger = async () => {
    if (state.running) return;
    state.running = true;
    try {
      const settings = await new SettingsRepository(prisma).getAll();
      if (settings.NOTIFICATIONS_ENABLED !== "true") return;
      const config = applyStoredSettings(loadConfig(), settings);
      if (!config.telegramBotToken || !settings.TELEGRAM_CHAT_ID) return;
      const outbox = new NotificationOutboxRepository(prisma);
      const dispatcher = new NotificationDispatcher(
        outbox,
        new TelegramTransport(config.telegramBotToken),
        { maxAttempts: 5, maxBackoffMs: 60 * 60_000, staleAfterMs: 10 * 60_000 },
      );
      const sent = await dispatcher.runOnce();
      if (sent > 0) logger.info({ operation: "notification-dispatcher.sent", sent }, "Notifications delivered");
    } catch (error) {
      logger.error({ operation: "notification-dispatcher.cycle.failed", error: error instanceof Error ? error.message : String(error) }, "Notification dispatch cycle failed");
    } finally {
      state.running = false;
    }
  };
  state.timer = setInterval(() => { void trigger(); }, cadenceMs);
  state.timer.unref();
  globalState.__cenbluNotificationDispatcher = state;
  void trigger();
  logger.info({ operation: "notification-dispatcher.started", cadenceSeconds: cadenceMs / 1_000 }, "Notification dispatcher started with the dashboard");
}
