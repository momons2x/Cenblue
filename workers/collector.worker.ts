import { applyStoredSettings, loadConfig } from "@cenblu/config";
import { CollectionService, PlaywrightTimelineBrowser, XPlaywrightCollector } from "@cenblu/collector";
import { DatabaseExclusiveLease, prisma, SchedulerRepository, SettingsRepository, SourceAccountRepository, SourcePostRepository } from "@cenblu/database";
import { createLogger } from "@cenblu/shared/logger";
import { openEdgeProfile } from "@cenblu/publisher";
import pino from "pino";
import { z } from "zod";

const addSourceArguments = z.tuple([
  z.string().regex(/^[A-Za-z0-9_]{1,15}$/, "Username must be an X username without @"),
  z.coerce.number().int().min(1).optional(),
]);

async function main(): Promise<void> {
  const config = applyStoredSettings(loadConfig(), await new SettingsRepository(prisma).getAll());
  const logger = createLogger({ directory: config.logStoragePath, component: "collector", maxBytes: config.logMaxBytes, retainedFiles: config.logRetainedFiles });
  const accounts = new SourceAccountRepository(prisma);
  const browserLease = new DatabaseExclusiveLease(new SchedulerRepository(prisma), "x-collector-profile", Math.max(config.workerLockTimeoutMinutes, 10) * 60_000);

  if (process.argv[2] === "--add-source") {
    const [username, collectLimit = config.postsPerSource] = addSourceArguments.parse(process.argv.slice(3));
    const source = await accounts.create({ username, collectLimit, enabled: true });
    logger.info({ operation: "source.create", sourceAccount: source.username, sourceId: source.id }, "Source account created");
    return;
  }
  if (process.argv[2] === "--profile-open") {
    if (!config.playwrightProfileDirectory) throw new Error("Collector profile setup requires PLAYWRIGHT_PROFILE_DIRECTORY");
    await openEdgeProfile(config.playwrightProfilePath, config.playwrightProfileDirectory);
    logger.info({ operation: "collector.profile.open", browserProfileDirectory: config.playwrightProfileDirectory }, "Opened isolated collector profile in normal Edge for manual session setup");
    return;
  }

  const timeline = new PlaywrightTimelineBrowser({
    headless: config.playwrightHeadless,
    browserChannel: config.playwrightBrowserChannel,
    repositoryRoot: config.repositoryRoot,
    profileDirectory: config.playwrightProfilePath,
    browserProfileDirectory: config.playwrightProfileDirectory,
    allowExternalProfile: config.playwrightAllowExternalProfile,
    lease: browserLease,
    diagnosticsDirectory: config.logStoragePath,
    maxScrolls: config.collectorMaxScrolls,
    idleScrolls: config.collectorIdleScrolls,
    scrollDelayMs: config.collectorScrollDelayMs,
    maxSourceDurationMs: config.collectorMaxSourceSeconds * 1_000,
  }, logger);
  if (process.argv[2] === "--session-check") {
    await timeline.checkSession();
    await new SettingsRepository(prisma).setMany({ COLLECTOR_BROWSER_SESSION_VERIFIED_AT: new Date().toISOString() });
    return;
  }
  const service = new CollectionService(
    accounts,
    new SourcePostRepository(prisma),
    new XPlaywrightCollector(timeline),
    logger,
    config.sourceAccountLimit,
    config.postsPerSource,
  );
  const result = await service.runOnce();
  logger.info({ operation: "collector.cycle.complete", ...result }, "Collection cycle completed");
}

main()
  .catch((error: unknown) => {
    const logger = pino();
    logger.error({
      operation: "collector.cycle.failed",
      error: error instanceof Error ? error.message : String(error),
    }, "Collection cycle failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
