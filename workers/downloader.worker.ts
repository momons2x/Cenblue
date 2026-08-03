import { applyStoredSettings, loadConfig } from "@cenblu/config";
import { resolve } from "node:path";
import { prisma, DownloadRepository, SchedulerRepository, SettingsRepository } from "@cenblu/database";
import { DownloadService, FfmpegPerceptualVideoHasher, FfprobeService, MediaFiles, NodeProcessRunner, verifyDownloadBinaries, YtDlpService } from "@cenblu/downloader";
import { createLogger } from "@cenblu/shared/logger";
import { resolveCaption } from "@cenblu/publisher";
import pino from "pino";

async function main(): Promise<void> {
  const config = applyStoredSettings(loadConfig(), await new SettingsRepository(prisma).getAll());
  const logger = createLogger({ directory: config.logStoragePath, component: "downloader", maxBytes: config.logMaxBytes, retainedFiles: config.logRetainedFiles });
  const runner = new NodeProcessRunner();
  await verifyDownloadBinaries(runner, { ytDlp: config.ytDlpBinary, ffmpeg: config.ffmpegBinary, ffprobe: config.ffprobeBinary });
  const service = new DownloadService(
    new DownloadRepository(prisma),
    new YtDlpService(runner, config.ytDlpBinary, config.ffmpegBinary, config.playwrightProfileDirectory ? resolve(config.playwrightProfilePath, config.playwrightProfileDirectory) : undefined),
    new FfprobeService(runner, config.ffprobeBinary),
    new MediaFiles(config.videoStoragePath, config.tempStoragePath, config.thumbnailStoragePath),
    logger,
    3,
    new FfmpegPerceptualVideoHasher(runner, config.ffmpegBinary),
  );
  const processed = await service.processPending(config.downloadConcurrency, config.downloadBatchLimit);
  await new SchedulerRepository(prisma).scheduleDownloadedAssets(new Date(), 0, (source) => resolveCaption(source, config.captionTemplates));
  logger.info({ operation: "downloader.cycle.complete", processed }, "Download cycle completed");
}

main()
  .catch((error: unknown) => {
    pino().error({ operation: "downloader.cycle.failed", error: error instanceof Error ? error.message : String(error) }, "Download cycle failed");
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
