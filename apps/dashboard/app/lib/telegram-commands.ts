import pino from "pino";
import { applyStoredSettings, loadConfig } from "@cenblu/config";
import { NotificationOutboxRepository, PipelineStatusRepository, prisma, SettingsRepository } from "@cenblu/database";
import { TelegramCommandHandler, TelegramTransport } from "@cenblu/notifications";

const pollTimeoutSeconds = 25;
const pollIntervalMs = 1_000;

type LoopState = { running: boolean; stopping: boolean; timer: NodeJS.Timeout | null; offset: number | undefined };
const globalState = globalThis as typeof globalThis & { __cenbluTelegramCommands?: LoopState };

export function startTelegramCommands(): void {
  if (globalState.__cenbluTelegramCommands) return;
  const state: LoopState = { running: false, stopping: false, timer: null, offset: undefined };
  const logger = pino({ name: "telegram-commands" });

  const poll = async (): Promise<void> => {
    if (state.running || state.stopping) return;
    state.running = true;
    try {
      const settings = await new SettingsRepository(prisma).getAll();
      if (settings.NOTIFICATIONS_ENABLED !== "true") return;
      const config = applyStoredSettings(loadConfig(), settings);
      if (!config.telegramBotToken || !settings.TELEGRAM_CHAT_ID) return;
      const transport = new TelegramTransport(config.telegramBotToken);
      const handler = new TelegramCommandHandler({
        chatId: settings.TELEGRAM_CHAT_ID,
        transport,
        outbox: new NotificationOutboxRepository(prisma),
        pipeline: new PipelineStatusRepository(prisma),
      });
      const result = await transport.getUpdates(state.offset, pollTimeoutSeconds);
      if (!result.ok) {
        logger.warn({ operation: "telegram-commands.poll.failed", error: result.error }, "Telegram getUpdates failed");
        return;
      }
      if (result.updates.length === 0) return;
      let maxUpdateId = state.offset ?? 0;
      for (const update of result.updates) {
        try {
          await handler.handle(update);
        } catch (error) {
          logger.error({ operation: "telegram-commands.handle.failed", error: error instanceof Error ? error.message : String(error) }, "Telegram command failed");
        }
        maxUpdateId = Math.max(maxUpdateId, update.updateId);
      }
      state.offset = maxUpdateId + 1;
    } catch (error) {
      logger.error({ operation: "telegram-commands.cycle.failed", error: error instanceof Error ? error.message : String(error) }, "Telegram command cycle failed");
    } finally {
      state.running = false;
    }
  };

  const schedule = (): void => {
    if (state.stopping) return;
    state.timer = setTimeout(() => {
      void poll().finally(schedule);
    }, pollIntervalMs);
    state.timer.unref();
  };

  state.stopping = false;
  globalState.__cenbluTelegramCommands = state;
  schedule();
  logger.info({ operation: "telegram-commands.started", pollTimeoutSeconds }, "Telegram command polling started with the dashboard");
}

export function stopTelegramCommands(): void {
  const state = globalState.__cenbluTelegramCommands;
  if (!state) return;
  state.stopping = true;
  if (state.timer) clearTimeout(state.timer);
  delete globalState.__cenbluTelegramCommands;
}
