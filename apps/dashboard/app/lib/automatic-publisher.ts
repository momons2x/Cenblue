import pino from "pino";
import { resolve } from "node:path";
import { applyStoredSettings, loadConfig } from "@cenblu/config";
import { DatabaseExclusiveLease, identityFingerprint, identityLeaseName, prisma, PublishRepository, SchedulerRepository, SettingsRepository } from "@cenblu/database";
import { createPublishNotifier } from "@cenblu/notifications";
import { LocalPublishMediaVerifier, PublishService, XPlaywrightPublisher } from "@cenblu/publisher";
import { combineExclusiveLeases } from "@cenblu/shared/lease";

const cadenceMs = 30_000;

type PublisherLoop = { timer: NodeJS.Timeout; running: boolean };
const globalState = globalThis as typeof globalThis & { __cenbluAutomaticPublisher?: PublisherLoop };

export function automaticPublishingEnabled(mode: "ASSISTED" | "AUTOMATIC", sessionVerifiedAt: string | undefined): boolean {
  return mode === "AUTOMATIC" && Boolean(sessionVerifiedAt);
}

export function startAutomaticPublisher(): void {
  if (globalState.__cenbluAutomaticPublisher) return;
  const state: PublisherLoop = { timer: undefined as unknown as NodeJS.Timeout, running: false };
  const logger = pino({ name: "automatic-publisher" });
  const trigger = async () => {
    if (state.running) return;
    state.running = true;
    try {
      const settings = new SettingsRepository(prisma);
      const storedSettings = await settings.getAll();
      const config = applyStoredSettings(loadConfig(), storedSettings);
      if (config.publishMode !== "AUTOMATIC") return;
      const repository = new PublishRepository(prisma);
      const notifier = await createPublishNotifier(prisma, {
        telegramBotToken: config.telegramBotToken,
        discordBotToken: config.discordBotToken,
        discordOwnerId: config.discordOwnerId,
      }, async (identityId) => (await prisma.browserIdentity.findUnique({ where: { id: identityId }, select: { label: true } }))?.label ?? null);
      const identities = await prisma.browserIdentity.findMany({ where: { role: "PUBLISHER", enabled: true, automaticEnabled: true, verifiedAt: { not: null } }, orderBy: { createdAt: "asc" } });
      for (const identity of identities) {
        if (!identity.expectedUsername || identity.verifiedUsername !== identity.expectedUsername || identity.verifiedFingerprint !== identityFingerprint(identity)) continue;
        const dueJobIds = await repository.findDueScheduledIds(new Date(), 10, identity.id);
        if (dueJobIds.length === 0) continue;
        const browserLease = new DatabaseExclusiveLease(new SchedulerRepository(prisma), identityLeaseName(identity.id), Math.max(config.workerLockTimeoutMinutes, 10) * 60_000);
        const capacityLease = new DatabaseExclusiveLease(new SchedulerRepository(prisma), "publisher-capacity:1", Math.max(config.workerLockTimeoutMinutes, 10) * 60_000);
        const service = new PublishService(
          repository,
          new XPlaywrightPublisher({ repositoryRoot: config.repositoryRoot, profileDirectory: resolve(config.repositoryRoot, identity.profilePath), browserId: identity.browserId as typeof config.publisherBrowserId, browserExecutablePath: identity.executablePath ?? undefined, browserProfileDirectory: identity.profileDirectory ?? undefined, lease: combineExclusiveLeases(capacityLease, browserLease), diagnosticsDirectory: config.logStoragePath, headless: config.playwrightHeadless, minUploadMbps: config.publishMinUploadMbps, maxUploadTimeoutMs: config.publishMaxUploadMinutes * 60_000, expectedUsername: identity.expectedUsername }, logger),
          new LocalPublishMediaVerifier(config.videoStoragePath), logger, config.publishAllowEmptyCaption, 3, identity.id,
          notifier?.onPublishFailure, notifier?.onPublishSuccess,
        );
        for (const jobId of dueJobIds) {
          try { await service.processJob(jobId); }
          catch (error) { logger.warn({ operation: "automatic-publisher.job.skipped", jobId, publisherIdentityId: identity.id, error: error instanceof Error ? error.message : String(error) }, "Scheduled publish job could not be processed"); }
        }
      }
    } catch (error) {
      logger.error({ operation: "automatic-publisher.cycle.failed", error: error instanceof Error ? error.message : String(error) }, "Scheduled publisher cycle failed");
    } finally {
      state.running = false;
    }
  };
  state.timer = setInterval(() => { void trigger(); }, cadenceMs);
  state.timer.unref();
  globalState.__cenbluAutomaticPublisher = state;
  void trigger();
  logger.info({ operation: "automatic-publisher.started", cadenceSeconds: cadenceMs / 1_000 }, "Scheduled publisher started with the dashboard");
}
