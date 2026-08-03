import type { DownloadRepository, MediaAssetInput } from "@cenblu/database";
import type { ClaimedDownloadJob } from "@cenblu/database";
import type { Logger } from "pino";
import type { VideoInspector } from "./ffprobe";
import type { MediaFiles } from "./media-files";
import { ProcessExecutionError } from "./process-runner";
import { PermanentDownloadError } from "./errors";
import type { VideoDownloader } from "./ytdlp";
import type { PerceptualVideoHasher } from "./perceptual-video";

export class DownloadService {
  constructor(
    private readonly repository: DownloadRepository,
    private readonly ytdlp: VideoDownloader,
    private readonly ffprobe: VideoInspector,
    private readonly files: MediaFiles,
    private readonly logger: Logger,
    private readonly maxAttempts = 3,
    private readonly perceptualHasher?: PerceptualVideoHasher,
  ) {}

  async processNext(): Promise<boolean> {
    const now = new Date();
    const job = await this.repository.claimNext(now, new Date(now.getTime() - 15 * 60_000));
    if (!job) return false;
    await this.processClaimed(job);
    return true;
  }

  async processJob(jobId: string): Promise<boolean> {
    const now = new Date();
    const job = await this.repository.claimById(jobId, now, new Date(now.getTime() - 15 * 60_000));
    if (!job) return false;
    await this.processClaimed(job);
    return true;
  }

  private async processClaimed(job: ClaimedDownloadJob): Promise<void> {
    const paths = this.files.paths(job.sourcePost.platformPostId, job.attemptCount);
    try {
      const recoveringFinal = await this.files.exists(paths.finalVideo);
      const validationPath = recoveringFinal ? paths.finalVideo : paths.temporaryVideo;
      if (!recoveringFinal) await this.ytdlp.download(job.sourcePost.sourceUrl, paths.temporaryVideo, paths.temporaryThumbnail);
      const fileSize = await this.files.fileSize(validationPath);
      const metadata = await this.ffprobe.inspect(validationPath);
      const checksum = await this.files.checksum(validationPath);
      const perceptualHash = this.perceptualHasher ? await this.perceptualHasher.hash(validationPath) : null;
      if (!recoveringFinal) await this.files.moveToFinal(paths.temporaryVideo, paths.finalVideo);
      const hasThumbnail = await this.files.exists(paths.finalThumbnail) || await this.files.moveThumbnailToFinal(paths.temporaryThumbnail, paths.finalThumbnail);
      const asset: MediaAssetInput = { filePath: paths.finalVideo, thumbnailPath: hasThumbnail ? paths.finalThumbnail : null, mimeType: "video/mp4", fileSize, ...metadata, checksum, perceptualHash, localRemovedAt: null };
      await this.repository.complete(job.id, job.sourcePost.id, asset, new Date());
      this.logger.info({ operation: "downloader.complete", jobId: job.id, postId: job.sourcePost.platformPostId, attemptCount: job.attemptCount }, "Download completed");
    } catch (error) {
      await this.files.cleanup(paths.temporaryVideo, paths.temporaryThumbnail);
      const message = error instanceof Error ? error.message : String(error);
      const retryable = error instanceof PermanentDownloadError ? false : !(error instanceof ProcessExecutionError) || error.retryable;
      const nextAttemptAt = retryable && job.attemptCount < this.maxAttempts ? new Date(Date.now() + 60_000 * 2 ** (job.attemptCount - 1)) : null;
      await this.repository.fail(job.id, job.sourcePost.id, message, nextAttemptAt);
      this.logger.error({ operation: "downloader.failed", jobId: job.id, postId: job.sourcePost.platformPostId, attemptCount: job.attemptCount, error: message, retryable: nextAttemptAt !== null, nextAttemptAt: nextAttemptAt?.toISOString() ?? null, manualIntervention: nextAttemptAt === null }, "Download failed");
    }
  }

  async processPending(concurrency = 1, limit = 20, onProgress?: (processed: number) => Promise<void>): Promise<number> {
    let attempts = 0;
    let processed = 0;
    const workers = Array.from({ length: concurrency }, async () => {
      while (attempts < limit) {
        attempts += 1;
        if (!await this.processNext()) return;
        processed += 1;
        await onProgress?.(processed);
      }
    });
    await Promise.all(workers);
    return processed;
  }
}
