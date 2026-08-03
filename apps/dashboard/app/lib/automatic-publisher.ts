import pino from "pino";
import { applyStoredSettings, loadConfig } from "@cenblu/config";
import { DatabaseExclusiveLease, prisma, PublishRepository, SchedulerRepository, SettingsRepository } from "@cenblu/database";
import { LocalPublishMediaVerifier, PublishService, XPlaywrightPublisher } from "@cenblu/publisher";

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
      if (!automaticPublishingEnabled(config.publishMode, storedSettings.PUBLISHER_BROWSER_SESSION_VERIFIED_AT)) return;
      const repository = new PublishRepository(prisma);
      const dueJobIds = await repository.findDueScheduledIds(new Date());
      if (dueJobIds.length === 0) return;
      const browserLease = new DatabaseExclusiveLease(new SchedulerRepository(prisma), "x-publisher-profile", Math.max(config.workerLockTimeoutMinutes, 10) * 60_000);
      const service = new PublishService(
        repository,
        new XPlaywrightPublisher({ repositoryRoot: config.repositoryRoot, profileDirectory: config.publisherProfilePath, browserChannel: config.playwrightBrowserChannel, browserProfileDirectory: config.publisherProfileDirectory, allowExternalProfile: config.playwrightAllowExternalProfile, lease: browserLease, diagnosticsDirectory: config.logStoragePath, headless: config.playwrightHeadless, minUploadMbps: config.publishMinUploadMbps, maxUploadTimeoutMs: config.publishMaxUploadMinutes * 60_000 }, logger),
        new LocalPublishMediaVerifier(config.videoStoragePath),
        logger,
        config.publishAllowEmptyCaption,
      );
      for (const jobId of dueJobIds) {
        try {
          await service.processJob(jobId);
        } catch (error) {
          logger.warn({ operation: "automatic-publisher.job.skipped", jobId, error: error instanceof Error ? error.message : String(error) }, "Scheduled publish job could not be processed");
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
