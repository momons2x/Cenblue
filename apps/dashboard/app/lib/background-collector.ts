import { resolve } from "node:path";
import pino, { type Logger } from "pino";
import { CollectionService, PlaywrightTimelineBrowser, XPlaywrightCollector } from "@cenblu/collector";
import { applyStoredSettings, loadConfig, type AppConfig } from "@cenblu/config";
import { CollectionRunRepository, DatabaseExclusiveLease, identityLeaseName, prisma, RuntimeStatusRepository, SchedulerRepository, SettingsRepository, SourceAccountRepository, SourcePostRepository } from "@cenblu/database";
import { ResourceBusyError } from "@cenblu/shared/lease";

type CollectorState = { running: boolean };
const globalState = globalThis as typeof globalThis & { __cenbluBackgroundCollector?: CollectorState };

export function isBackgroundCollectionRunning(): boolean {
  return Boolean(globalState.__cenbluBackgroundCollector?.running);
}

async function runGroups(config: AppConfig, sourceRepository: SourceAccountRepository, sources: Awaited<ReturnType<SourceAccountRepository["listEnabled"]>>, logger: Logger): Promise<void> {
  const identities = await prisma.browserIdentity.findMany({ where: { role: "COLLECTOR", enabled: true } });
  const identityMap = new Map(identities.map((identity) => [identity.id, identity]));
  const grouped = new Map<string, typeof sources>();
  for (const source of sources) {
    const identityId = source.collectorIdentityId ?? "";
    grouped.set(identityId, [...(grouped.get(identityId) ?? []), source]);
  }
  const groups = [...grouped.entries()];
  for (let index = 0; index < groups.length; index += 2) {
    const batch = groups.slice(index, index + 2);
    await Promise.all(batch.map(async ([identityId, identitySources]) => {
      const identity = identityId ? identityMap.get(identityId) : undefined;
      const runs = new CollectionRunRepository(prisma);
      if (!identity) {
        const message = identityId ? "The assigned Collector identity no longer exists. Reassign these sources to a verified Collector." : "This source has no Collector assigned. Assign one under Sources → Manage source.";
        const run = await runs.start(identitySources.map((source) => ({ id: source.id, targetNew: Math.min(source.collectLimit, config.postsPerSource) })));
        await runs.finish(run.id, "FAILED", message);
        for (const source of identitySources) await runs.finishSource(run.id, source.id, { failed: true, cancelled: false, inserted: 0, error: message });
        return;
      }
      if (!identity.verifiedAt || identity.verifiedUsername !== identity.expectedUsername) {
        const message = `${identity.label} must be verified before collection. Reassign these sources to a verified Collector or verify ${identity.label}.`;
        const run = await runs.start(identitySources.map((source) => ({ id: source.id, targetNew: Math.min(source.collectLimit, config.postsPerSource) })));
        await runs.finish(run.id, "FAILED", message);
        for (const source of identitySources) await runs.finishSource(run.id, source.id, { failed: true, cancelled: false, inserted: 0, error: `${identity.label} is not verified for collection.` });
        return;
      }
      await runs.recoverStale(new Date(Date.now() - Math.max(config.workerLockTimeoutMinutes, 10) * 60_000));
      const run = await runs.start(identitySources.map((source) => ({ id: source.id, targetNew: Math.min(source.collectLimit, config.postsPerSource) })), identity.id);
      const runtime = new RuntimeStatusRepository(prisma);
      await runtime.update(`collector:${identity.id}`, "RUNNING", "collection");
      const browserLease = new DatabaseExclusiveLease(new SchedulerRepository(prisma), identityLeaseName(identity.id), Math.max(config.workerLockTimeoutMinutes, 10) * 60_000);
      const sourcePosts = new SourcePostRepository(prisma);
      const service = new CollectionService({ listEnabled: async () => identitySources, recordCollectionSuccess: sourceRepository.recordCollectionSuccess.bind(sourceRepository), recordCollectionFailure: sourceRepository.recordCollectionFailure.bind(sourceRepository) }, {
        listPlatformPostIds: sourcePosts.listPlatformPostIds.bind(sourcePosts),
        persistNew: (sourceAccountId, posts, collectedAt) => sourcePosts.persistNew(sourceAccountId, posts, collectedAt, identity.id),
      }, new XPlaywrightCollector(new PlaywrightTimelineBrowser({ headless: config.playwrightHeadless, browserId: identity.browserId as typeof config.collectorBrowserId, browserExecutablePath: identity.executablePath ?? undefined, repositoryRoot: config.repositoryRoot, profileDirectory: resolve(config.repositoryRoot, identity.profilePath), browserProfileDirectory: identity.profileDirectory ?? undefined, lease: browserLease, diagnosticsDirectory: config.logStoragePath, maxScrolls: config.collectorMaxScrolls, idleScrolls: config.collectorIdleScrolls, scrollDelayMs: config.collectorScrollDelayMs, maxSourceDurationMs: config.collectorMaxSourceSeconds * 1_000, expectedUsername: identity.expectedUsername ?? undefined }, logger)), logger, identitySources.length, config.postsPerSource, {
        sourceStarting: (source) => runs.startSource(run.id, source.id, source.username), sourceProgress: (sourceId, progress) => runs.progressSource(run.id, sourceId, progress), sourceFinished: (source) => runs.finishSource(run.id, source.id, source), shouldCancel: () => runs.shouldCancel(run.id),
      });
      try {
        const result = await service.runOnce();
        await runs.finish(run.id, result.cancelled ? "CANCELLED" : result.sourcesFailed > 0 ? "FAILED" : "COMPLETED");
        await runtime.update(`collector:${identity.id}`, result.cancelled ? "CANCELLED" : result.sourcesFailed > 0 ? "FAILED" : "IDLE");
      } catch (error) {
        await runs.finish(run.id, error instanceof ResourceBusyError ? "BUSY" : "FAILED", error instanceof Error ? error.message : String(error));
        await runtime.update(`collector:${identity.id}`, error instanceof ResourceBusyError ? "BUSY" : "FAILED", undefined, error instanceof Error ? error.message : String(error));
        if (!(error instanceof ResourceBusyError)) throw error;
      }
    }));
  }
}

export async function triggerCollection(sourceIds?: string[]): Promise<{ started: boolean }> {
  if (globalState.__cenbluBackgroundCollector?.running) return { started: false };
  const config = applyStoredSettings(loadConfig(), await new SettingsRepository(prisma).getAll());
  const sourceRepository = new SourceAccountRepository(prisma, config.sourceAccountLimit);
  const enabled = await sourceRepository.listEnabled(config.sourceAccountLimit);
  const sources = sourceIds ? enabled.filter((source) => sourceIds.includes(source.id)) : enabled;
  if (sources.length === 0) throw new Error("No enabled sources are available to collect.");
  globalState.__cenbluBackgroundCollector = { running: true };
  const serviceLogger = pino({ level: "silent" });
  const logger = pino({ name: "background-collector" });
  void runGroups(config, sourceRepository, sources, serviceLogger)
    .then(() => {
      logger.info({ operation: "background-collection.complete" }, "Background collection completed");
    })
    .catch((error: unknown) => {
      logger.error({ operation: "background-collection.failed", error: error instanceof Error ? error.message : String(error) }, "Background collection failed");
    })
    .finally(() => {
      globalState.__cenbluBackgroundCollector = { running: false };
    });
  return { started: true };
}
