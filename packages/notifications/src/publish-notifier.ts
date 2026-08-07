import type { PrismaClient } from "@prisma/client";
import { NotificationOutboxRepository, OperationalEventRepository, SettingsRepository } from "@cenblu/database";
import { NotificationEmitter, type NotificationChannel, type PublishFailureContext, type PublishedPostContext } from "./emitter";

export type PublishNotifierConfig = {
  telegramBotToken: string | undefined;
  discordBotToken: string | undefined;
  discordOwnerId: string | undefined;
};

export type PublishNotifier = {
  onPublishFailure: (failure: PublishFailureContext) => Promise<void>;
  onPublishSuccess: (success: PublishedPostContext) => Promise<void>;
};

export async function createPublishNotifier(
  client: PrismaClient,
  config: PublishNotifierConfig,
  resolvePublisherLabel?: (identityId: string) => Promise<string | null>,
): Promise<PublishNotifier | null> {
  const stored = await new SettingsRepository(client).getAll();
  const channels: Partial<Record<NotificationChannel, string>> = {};
  if (config.telegramBotToken && stored.TELEGRAM_CHAT_ID) channels.telegram = stored.TELEGRAM_CHAT_ID;
  if (config.discordBotToken && config.discordOwnerId && stored.NOTIFICATIONS_DISCORD_ENABLED === "true") channels.discord = config.discordOwnerId;
  const enabled = stored.NOTIFICATIONS_ENABLED === "true" && Object.keys(channels).length > 0;
  if (!enabled) return null;

  const emitter = new NotificationEmitter(
    new OperationalEventRepository(client),
    new NotificationOutboxRepository(client),
    undefined,
    resolvePublisherLabel,
  );
  return {
    onPublishFailure: async (failure) => {
      await emitter.emitPublishFailure(failure, { enabled: true, channels });
    },
    onPublishSuccess: async (success) => {
      await emitter.emitPublishedPost(success, { enabled: true, channels });
    },
  };
}
