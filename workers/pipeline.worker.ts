import { applyStoredSettings, loadConfig } from "@cenblu/config";
import { resolve } from "node:path";
import { CollectionService, PlaywrightTimelineBrowser, XPlaywrightCollector } from "@cenblu/collector";
import { DatabaseExclusiveLease, identityFingerprint, identityLeaseName, prisma, DownloadRepository, PublishRepository, SchedulerRepository, SettingsRepository, SourceAccountRepository, SourcePostRepository } from "@cenblu/database";
import { DownloadService, FfmpegPerceptualVideoHasher, FfprobeService, MediaFiles, NodeProcessRunner, verifyDownloadBinaries, YtDlpService } from "@cenblu/downloader";
import { LocalPublishMediaVerifier, PublishService, resolveCaption, XPlaywrightPublisher } from "@cenblu/publisher";
import { PipelineRunner, PipelineService } from "@cenblu/scheduler";
import { createLogger } from "@cenblu/shared/logger";
import { combineExclusiveLeases } from "@cenblu/shared/lease";
import pino from "pino";

async function main(): Promise<void> {
  const storedSettings = await new SettingsRepository(prisma).getAll();
  const config = applyStoredSettings(loadConfig(), storedSettings);
  const logger = createLogger({ directory: config.logStoragePath, component: "pipeline", maxBytes: config.logMaxBytes, retainedFiles: config.logRetainedFiles });
  const processRunner = new NodeProcessRunner();
  await verifyDownloadBinaries(processRunner, { ytDlp: config.ytDlpBinary, ffmpeg: config.ffmpegBinary, ffprobe: config.ffprobeBinary });
  const collectorLease = new DatabaseExclusiveLease(new SchedulerRepository(prisma), "x-collector-profile", Math.max(config.workerLockTimeoutMinutes, 10) * 60_000);
  const collector = new CollectionService(
    new SourceAccountRepository(prisma, config.sourceAccountLimit), new SourcePostRepository(prisma),
    new XPlaywrightCollector(new PlaywrightTimelineBrowser({ headless: config.playwrightHeadless, browserId: config.collectorBrowserId, browserExecutablePath: config.collectorBrowserExecutablePath, repositoryRoot: config.repositoryRoot, profileDirectory: config.playwrightProfilePath, browserProfileDirectory: config.playwrightProfileDirectory, allowExternalProfile: config.playwrightAllowExternalProfile, lease: collectorLease, diagnosticsDirectory: config.logStoragePath, maxScrolls: config.collectorMaxScrolls, idleScrolls: config.collectorIdleScrolls, scrollDelayMs: config.collectorScrollDelayMs, maxSourceDurationMs: config.collectorMaxSourceSeconds * 1_000 }, logger)),
    logger, config.sourceAccountLimit, config.postsPerSource,
  );
  const downloader = new DownloadService(
    new DownloadRepository(prisma), new YtDlpService(processRunner, config.ytDlpBinary, config.ffmpegBinary, config.playwrightProfileDirectory ? resolve(config.playwrightProfilePath, config.playwrightProfileDirectory) : config.playwrightProfilePath, config.collectorBrowserId, async (collectorIdentityId) => {
      const identity = await prisma.browserIdentity.findUniqueOrThrow({ where: { id: collectorIdentityId } });
      const lease = new DatabaseExclusiveLease(new SchedulerRepository(prisma), identityLeaseName(identity.id), Math.max(config.workerLockTimeoutMinutes, 10) * 60_000);
      return { profilePath: resolve(config.repositoryRoot, identity.profilePath), browserId: identity.browserId as typeof config.collectorBrowserId, runExclusive: (operation: () => Promise<void>) => lease.run(operation) };
    }),
    new FfprobeService(processRunner, config.ffprobeBinary), new MediaFiles(config.videoStoragePath, config.tempStoragePath, config.thumbnailStoragePath), logger, 3,
    new FfmpegPerceptualVideoHasher(processRunner, config.ffmpegBinary),
  );
  const publishRepository = new PublishRepository(prisma);
  const pipeline = new PipelineService(new SchedulerRepository(prisma), {
    collect: async () => { await collector.runOnce(); },
    download: async () => downloader.processPending(config.downloadConcurrency, config.downloadBatchLimit),
    publish: async () => {
      if (config.publishMode !== "AUTOMATIC") return false;
      const identities = await prisma.browserIdentity.findMany({ where: { role: "PUBLISHER", enabled: true, automaticEnabled: true, verifiedAt: { not: null } }, orderBy: { createdAt: "asc" } });
      for (const identity of identities) {
        if (!identity.expectedUsername || identity.verifiedUsername !== identity.expectedUsername || identity.verifiedFingerprint !== identityFingerprint(identity)) continue;
        const [jobId] = await publishRepository.findDueScheduledIds(new Date(), 1, identity.id);
        if (!jobId) continue;
        const lease = new DatabaseExclusiveLease(new SchedulerRepository(prisma), identityLeaseName(identity.id), Math.max(config.workerLockTimeoutMinutes, 10) * 60_000);
        const capacityLease = new DatabaseExclusiveLease(new SchedulerRepository(prisma), "publisher-capacity:1", Math.max(config.workerLockTimeoutMinutes, 10) * 60_000);
        const publisher = new PublishService(publishRepository, new XPlaywrightPublisher({ repositoryRoot: config.repositoryRoot, profileDirectory: resolve(config.repositoryRoot, identity.profilePath), browserId: identity.browserId as typeof config.publisherBrowserId, browserExecutablePath: identity.executablePath ?? undefined, browserProfileDirectory: identity.profileDirectory ?? undefined, lease: combineExclusiveLeases(capacityLease, lease), diagnosticsDirectory: config.logStoragePath, headless: config.playwrightHeadless, minUploadMbps: config.publishMinUploadMbps, maxUploadTimeoutMs: config.publishMaxUploadMinutes * 60_000, expectedUsername: identity.expectedUsername }, logger), new LocalPublishMediaVerifier(config.videoStoragePath), logger, config.publishAllowEmptyCaption, 3, identity.id);
        return publisher.processJob(jobId);
      }
      return false;
    },
  }, logger, config.publishIntervalMinutes, config.workerLockTimeoutMinutes * 60_000, (source) => resolveCaption(source, config.captionTemplates));

  if (process.argv[2] === "--once") {
    await pipeline.runOnce();
    return;
  }
  const runner = new PipelineRunner(pipeline, logger, config.collectionIntervalMinutes);
  runner.start();
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await runner.stop();
    await prisma.$disconnect();
  };
  process.once("SIGINT", () => { void shutdown(); });
  process.once("SIGTERM", () => { void shutdown(); });
}

main().catch((error: unknown) => {
  pino().error({ operation: "pipeline.failed", error: error instanceof Error ? error.message : String(error) }, "Pipeline failed");
  process.exitCode = 1;
});
