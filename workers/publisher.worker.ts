import { applyStoredSettings, loadConfig } from "@cenblu/config";
import { DatabaseExclusiveLease, prisma, PublishRepository, SchedulerRepository, SettingsRepository } from "@cenblu/database";
import { cloneEdgeProfile, LocalPublishMediaVerifier, openEdgeProfile, PublishService, validateCaption, XPlaywrightPublisher } from "@cenblu/publisher";
import { createLogger } from "@cenblu/shared/logger";
import pino from "pino";
import { z } from "zod";

const queueArguments = z.tuple([z.string().regex(/^\d+$/, "Platform post ID must be numeric"), z.string().optional()]);

async function main(): Promise<void> {
  const config = applyStoredSettings(loadConfig(), await new SettingsRepository(prisma).getAll());
  const logger = createLogger({ directory: config.logStoragePath, component: "publisher", maxBytes: config.logMaxBytes, retainedFiles: config.logRetainedFiles });
  const repository = new PublishRepository(prisma);
  const browserLease = new DatabaseExclusiveLease(new SchedulerRepository(prisma), "x-publisher-profile", Math.max(config.workerLockTimeoutMinutes, 10) * 60_000);
  const publisher = new XPlaywrightPublisher({
    repositoryRoot: config.repositoryRoot,
    profileDirectory: config.publisherProfilePath,
    browserChannel: config.playwrightBrowserChannel,
    browserProfileDirectory: config.publisherProfileDirectory,
    allowExternalProfile: config.playwrightAllowExternalProfile,
    lease: browserLease,
    diagnosticsDirectory: config.logStoragePath,
    headless: config.playwrightHeadless,
    minUploadMbps: config.publishMinUploadMbps,
    maxUploadTimeoutMs: config.publishMaxUploadMinutes * 60_000,
  }, logger);

  if (process.argv[2] === "--login") {
    await publisher.setupLogin();
    return;
  }
  if (process.argv[2] === "--profile-clone") {
    if (!config.playwrightProfileSourcePath || !config.publisherProfileDirectory) throw new Error("Profile clone requires PLAYWRIGHT_PROFILE_SOURCE_PATH and PUBLISHER_PROFILE_DIRECTORY");
    await cloneEdgeProfile(config.playwrightProfileSourcePath, config.publisherProfileDirectory, config.publisherProfilePath);
    logger.info({ operation: "publisher.profile.clone", browserProfileDirectory: config.publisherProfileDirectory }, "Edge profile cloned into publisher storage");
    return;
  }
  if (process.argv[2] === "--profile-open") {
    if (!config.publisherProfileDirectory) throw new Error("Profile setup requires PUBLISHER_PROFILE_DIRECTORY");
    await openEdgeProfile(config.publisherProfilePath, config.publisherProfileDirectory);
    logger.info({ operation: "publisher.profile.open", browserProfileDirectory: config.publisherProfileDirectory }, "Opened isolated publisher profile in normal Edge for manual session setup");
    return;
  }
  if (process.argv[2] === "--session-check") {
    await publisher.checkSession();
    await new SettingsRepository(prisma).setMany({ PUBLISHER_BROWSER_SESSION_VERIFIED_AT: new Date().toISOString() });
    return;
  }
  if (process.argv[2] === "--queue") {
    const [platformPostId, rawCaption = ""] = queueArguments.parse([process.argv[3], process.argv.slice(4).join(" ") || undefined]);
    const caption = validateCaption(rawCaption, config.publishAllowEmptyCaption);
    const job = await repository.createForPost(platformPostId, caption);
    logger.info({ operation: "publisher.queue", jobId: job.id, postId: platformPostId }, "Publish job queued");
    return;
  }

  const service = new PublishService(
    repository,
    publisher,
    new LocalPublishMediaVerifier(config.videoStoragePath),
    logger,
    config.publishAllowEmptyCaption,
  );
  const processed = await service.processNext() ? 1 : 0;
  logger.info({ operation: "publisher.cycle.complete", processed }, "Publish cycle completed");
}

main()
  .catch((error: unknown) => {
    pino().error({ operation: "publisher.worker.failed", error: error instanceof Error ? error.message : String(error) }, "Publisher command failed");
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
