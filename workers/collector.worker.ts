import { applyStoredSettings, browserBindingFingerprint, loadConfig } from "@cenblu/config";
import { CollectionService, PlaywrightTimelineBrowser, XPlaywrightCollector } from "@cenblu/collector";
import { DatabaseExclusiveLease, identityLeaseName, prisma, RuntimeStatusRepository, SchedulerRepository, SettingsRepository, SourceAccountRepository, SourcePostRepository } from "@cenblu/database";
import { resolve } from "node:path";
import { createLogger } from "@cenblu/shared/logger";
import { discoverInstalledChromiumBrowsers, openChromiumProfile } from "@cenblu/publisher";
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
  const identity = await prisma.browserIdentity.findFirst({ where: { role: "COLLECTOR", enabled: true }, orderBy: { createdAt: "asc" } });
  const browserLease = new DatabaseExclusiveLease(new SchedulerRepository(prisma), identity ? identityLeaseName(identity.id) : "x-collector-profile", Math.max(config.workerLockTimeoutMinutes, 10) * 60_000);

  if (process.argv[2] === "--add-source") {
    const [username, collectLimit = config.postsPerSource] = addSourceArguments.parse(process.argv.slice(3));
    const source = await accounts.create({ username, collectLimit, enabled: true });
    logger.info({ operation: "source.create", sourceAccount: source.username, sourceId: source.id }, "Source account created");
    return;
  }
  if (process.argv[2] === "--profile-open") {
    const executablePath = config.collectorBrowserExecutablePath ?? (await discoverInstalledChromiumBrowsers()).find((browser) => browser.id === config.collectorBrowserId)?.executablePath;
    if (!executablePath) throw new Error("The collector browser executable was not found; select it from the dashboard first");
    await openChromiumProfile(executablePath, config.playwrightProfilePath, config.playwrightProfileDirectory);
    logger.info({ operation: "collector.profile.open", browserId: config.collectorBrowserId }, "Opened isolated collector browser for manual session setup");
    return;
  }

  const timeline = new PlaywrightTimelineBrowser({
    headless: config.playwrightHeadless,
    browserId: identity ? identity.browserId as typeof config.collectorBrowserId : config.collectorBrowserId,
    browserExecutablePath: identity?.executablePath ?? config.collectorBrowserExecutablePath,
    repositoryRoot: config.repositoryRoot,
    profileDirectory: identity ? resolve(config.repositoryRoot, identity.profilePath) : config.playwrightProfilePath,
    browserProfileDirectory: identity?.profileDirectory ?? config.playwrightProfileDirectory,
    allowExternalProfile: config.playwrightAllowExternalProfile,
    lease: browserLease,
    diagnosticsDirectory: config.logStoragePath,
    maxScrolls: config.collectorMaxScrolls,
    idleScrolls: config.collectorIdleScrolls,
    scrollDelayMs: config.collectorScrollDelayMs,
    maxSourceDurationMs: config.collectorMaxSourceSeconds * 1_000,
    expectedUsername: identity?.expectedUsername ?? undefined,
  }, logger);
  if (process.argv[2] === "--session-check") {
    const account = await timeline.checkSession();
    await new SettingsRepository(prisma).setMany({ COLLECTOR_BROWSER_SESSION_VERIFIED_AT: new Date().toISOString(), COLLECTOR_BROWSER_SESSION_ACCOUNT: account ?? "", COLLECTOR_BROWSER_SESSION_BINDING: browserBindingFingerprint(config, "collector") });
    return;
  }
  const sourcePosts = new SourcePostRepository(prisma);
  const service = new CollectionService(
    identity ? { listEnabled: (limit) => accounts.listEnabledForCollector(identity.id, limit), recordCollectionSuccess: accounts.recordCollectionSuccess.bind(accounts), recordCollectionFailure: accounts.recordCollectionFailure.bind(accounts) } : accounts,
    identity ? { listPlatformPostIds: sourcePosts.listPlatformPostIds.bind(sourcePosts), persistNew: (sourceAccountId, posts, collectedAt) => sourcePosts.persistNew(sourceAccountId, posts, collectedAt, identity.id) } : sourcePosts,
    new XPlaywrightCollector(timeline),
    logger,
    config.sourceAccountLimit,
    config.postsPerSource,
  );
  const runtime = new RuntimeStatusRepository(prisma);
  await runtime.update("collector", "RUNNING", "collection");
  try {
    const result = await service.runOnce();
    await runtime.update("collector", "IDLE");
    logger.info({ operation: "collector.cycle.complete", ...result }, "Collection cycle completed");
  } catch (error) {
    await runtime.update("collector", "ERROR", undefined, error instanceof Error ? error.message : String(error));
    throw error;
  }
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
