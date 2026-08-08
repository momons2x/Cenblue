import pino from "pino";
import { resolve } from "node:path";
import { applyStoredSettings, loadConfig } from "@cenblu/config";
import { DatabaseExclusiveLease, identityLeaseName, prisma, RuntimeStatusRepository, SchedulerRepository, SettingsRepository, DownloadRepository } from "@cenblu/database";
import { DownloadService, FfmpegPerceptualVideoHasher, FfprobeService, MediaFiles, NodeProcessRunner, verifyDownloadBinaries, YtDlpService } from "@cenblu/downloader";
import { resolveCaption } from "@cenblu/publisher";

type RunnerState = { running: boolean };
const globalState = globalThis as typeof globalThis & { __cenbluBackgroundDownloader?: RunnerState };

async function buildDownloader() {
  const config = applyStoredSettings(loadConfig(), await new SettingsRepository(prisma).getAll());
  const runner = new NodeProcessRunner();
  await verifyDownloadBinaries(runner, { ytDlp: config.ytDlpBinary, ffmpeg: config.ffmpegBinary, ffprobe: config.ffprobeBinary });
  const service = new DownloadService(
    new DownloadRepository(prisma),
    new YtDlpService(runner, config.ytDlpBinary, config.ffmpegBinary, config.playwrightProfileDirectory ? resolve(config.playwrightProfilePath, config.playwrightProfileDirectory) : config.playwrightProfilePath, config.collectorBrowserId, async (collectorIdentityId) => {
      const identity = await prisma.browserIdentity.findUniqueOrThrow({ where: { id: collectorIdentityId } });
      const lease = new DatabaseExclusiveLease(new SchedulerRepository(prisma), identityLeaseName(identity.id), Math.max(config.workerLockTimeoutMinutes, 10) * 60_000);
      return { profilePath: resolve(config.repositoryRoot, identity.profilePath), browserId: identity.browserId as typeof config.collectorBrowserId, runExclusive: (operation: () => Promise<void>) => lease.run(operation) };
    }),
    new FfprobeService(runner, config.ffprobeBinary),
    new MediaFiles(config.videoStoragePath, config.tempStoragePath, config.thumbnailStoragePath),
    pino({ level: "silent" }),
    3,
    new FfmpegPerceptualVideoHasher(runner, config.ffmpegBinary),
  );
  return { config, service };
}

export function isBackgroundDownloadRunning(): boolean {
  return Boolean(globalState.__cenbluBackgroundDownloader?.running);
}

export async function triggerPendingDownloads(limit?: number): Promise<boolean> {
  if (globalState.__cenbluBackgroundDownloader?.running) return false;
  globalState.__cenbluBackgroundDownloader = { running: true };
  const runtime = new RuntimeStatusRepository(prisma);
  const logger = pino({ name: "background-downloader" });
  void (async () => {
    try {
      const { config, service } = await buildDownloader();
      const resolvedLimit = limit ?? config.downloadBatchLimit;
      await runtime.update("dashboard-downloader", "RUNNING", JSON.stringify({ processed: 0, limit: resolvedLimit }));
      const processed = await service.processPending(config.downloadConcurrency, resolvedLimit, async (count) => {
        await runtime.update("dashboard-downloader", "RUNNING", JSON.stringify({ processed: count, limit: resolvedLimit }));
      });
      await new SchedulerRepository(prisma).scheduleDownloadedAssets(new Date(), 0, (source) => resolveCaption(source, config.captionTemplates));
      await runtime.update("dashboard-downloader", "IDLE", JSON.stringify({ processed, limit: resolvedLimit }));
      logger.info({ operation: "background-downloader.complete", processed }, "Background download run completed");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await runtime.update("dashboard-downloader", "ERROR", JSON.stringify({ processed: 0, limit: limit ?? 0 }), message);
      logger.error({ operation: "background-downloader.failed", error: message }, "Background download run failed");
    } finally {
      globalState.__cenbluBackgroundDownloader = { running: false };
    }
  })();
  return true;
}
