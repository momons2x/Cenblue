import { applyStoredSettings, browserBindingFingerprint, loadConfig } from "@cenblu/config";
import { DatabaseExclusiveLease, identityLeaseName, prisma, PublishRepository, SchedulerRepository, SettingsRepository } from "@cenblu/database";
import { resolve } from "node:path";
import { cloneEdgeProfile, discoverInstalledChromiumBrowsers, LocalPublishMediaVerifier, openChromiumProfile, PublishService, validateCaption, XPlaywrightPublisher } from "@cenblu/publisher";
import { createLogger } from "@cenblu/shared/logger";
import { combineExclusiveLeases } from "@cenblu/shared/lease";
import pino from "pino";
import { z } from "zod";

const queueArguments = z.tuple([z.string().regex(/^\d+$/, "Platform post ID must be numeric"), z.string().optional()]);

async function main(): Promise<void> {
  const config = applyStoredSettings(loadConfig(), await new SettingsRepository(prisma).getAll());
  const logger = createLogger({ directory: config.logStoragePath, component: "publisher", maxBytes: config.logMaxBytes, retainedFiles: config.logRetainedFiles });
  const repository = new PublishRepository(prisma);
  const identity = await prisma.browserIdentity.findFirst({ where: { role: "PUBLISHER", enabled: true }, orderBy: { createdAt: "asc" } });
  const browserLease = new DatabaseExclusiveLease(new SchedulerRepository(prisma), identity ? identityLeaseName(identity.id) : "x-publisher-profile", Math.max(config.workerLockTimeoutMinutes, 10) * 60_000);
  const capacityLease = new DatabaseExclusiveLease(new SchedulerRepository(prisma), "publisher-capacity:1", Math.max(config.workerLockTimeoutMinutes, 10) * 60_000);
  const publisher = new XPlaywrightPublisher({
    repositoryRoot: config.repositoryRoot,
    profileDirectory: identity ? resolve(config.repositoryRoot, identity.profilePath) : config.publisherProfilePath,
    browserId: identity ? identity.browserId as typeof config.publisherBrowserId : config.publisherBrowserId,
    browserExecutablePath: identity?.executablePath ?? config.publisherBrowserExecutablePath,
    browserProfileDirectory: identity?.profileDirectory ?? config.publisherProfileDirectory,
    allowExternalProfile: config.playwrightAllowExternalProfile,
    lease: combineExclusiveLeases(capacityLease, browserLease),
    diagnosticsDirectory: config.logStoragePath,
    headless: config.playwrightHeadless,
    minUploadMbps: config.publishMinUploadMbps,
    maxUploadTimeoutMs: config.publishMaxUploadMinutes * 60_000,
    expectedUsername: identity?.expectedUsername ?? undefined,
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
    const executablePath = config.publisherBrowserExecutablePath ?? (await discoverInstalledChromiumBrowsers()).find((browser) => browser.id === config.publisherBrowserId)?.executablePath;
    if (!executablePath) throw new Error("The publisher browser executable was not found; select it from the dashboard first");
    await openChromiumProfile(executablePath, config.publisherProfilePath, config.publisherProfileDirectory);
    logger.info({ operation: "publisher.profile.open", browserId: config.publisherBrowserId }, "Opened isolated publisher browser for manual session setup");
    return;
  }
  if (process.argv[2] === "--session-check") {
    const account = await publisher.checkSession();
    await new SettingsRepository(prisma).setMany({ PUBLISHER_BROWSER_SESSION_VERIFIED_AT: new Date().toISOString(), PUBLISHER_BROWSER_SESSION_ACCOUNT: account ?? "", PUBLISHER_BROWSER_SESSION_BINDING: browserBindingFingerprint(config, "publisher") });
    return;
  }
  if (process.argv[2] === "--queue") {
    const [platformPostId, rawCaption = ""] = queueArguments.parse([process.argv[3], process.argv.slice(4).join(" ") || undefined]);
    const caption = validateCaption(rawCaption, config.publishAllowEmptyCaption);
    const job = await repository.createForPost(platformPostId, caption, identity?.id);
    logger.info({ operation: "publisher.queue", jobId: job.id, postId: platformPostId }, "Publish job queued");
    return;
  }

  const service = new PublishService(
    repository,
    publisher,
    new LocalPublishMediaVerifier(config.videoStoragePath),
    logger,
    config.publishAllowEmptyCaption,
    3,
    identity?.id,
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
