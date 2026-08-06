import type { Logger } from "pino";
import type { ClaimedPublishJob, PublishRepository } from "@cenblu/database";
import { validateCaption } from "./caption";
import type { PublishMediaVerifier } from "./media-verifier";
import { PublisherError, type Publisher } from "./types";

export type PublishFailureNotification = {
  jobId: string;
  platformPostId: string;
  publisherIdentityId: string | null;
  error: string;
  attemptCount: number;
  manualAttention: boolean;
  retryable: boolean;
};

export class PublishService {
  constructor(
    private readonly repository: PublishRepository,
    private readonly publisher: Publisher,
    private readonly media: PublishMediaVerifier,
    private readonly logger: Logger,
    private readonly allowEmptyCaption: boolean,
    private readonly maxAttempts = 3,
    private readonly publisherIdentityId?: string,
    private readonly onPublishFailure?: (failure: PublishFailureNotification) => Promise<void> | void,
  ) {}

  async processNext(): Promise<boolean> {
    const now = new Date();
    const job = await this.repository.claimNext(now, new Date(now.getTime() - 15 * 60_000), this.publisherIdentityId);
    if (!job) return false;
    await this.processClaimed(job);
    return true;
  }

  async processJob(jobId: string): Promise<boolean> {
    const now = new Date();
    const job = await this.repository.claimById(jobId, now, new Date(now.getTime() - 15 * 60_000), this.publisherIdentityId);
    if (!job) return false;
    await this.processClaimed(job);
    return true;
  }

  private async processClaimed(job: ClaimedPublishJob): Promise<void> {
    if (!job.claimToken) throw new Error(`Publish job ${job.id} was claimed without a claim token`);
    const claimToken = job.claimToken;
    const controller = new AbortController();
    let phase = "PREPARING";
    let heartbeatFailure: unknown = null;
    let publicationConfirmed = false;
    const heartbeat = async (nextPhase = phase): Promise<void> => {
      phase = nextPhase;
      if (!await this.repository.heartbeat(job.id, claimToken, phase)) {
        const error = new PublisherError("LEASE_LOST", "Publish job claim was lost while work was active", true, false);
        controller.abort(error);
        throw error;
      }
    };
    await heartbeat();
    const heartbeatTimer = setInterval(() => {
      void heartbeat().catch((error) => {
        heartbeatFailure = error;
        controller.abort(error);
      });
    }, 30_000);
    heartbeatTimer.unref();
    try {
      const caption = validateCaption(job.caption, this.allowEmptyCaption);
      await this.media.verify(job.mediaAsset.filePath);
      const result = await this.publisher.publish({
        jobId: job.id,
        platformPostId: job.sourcePost.platformPostId,
        mediaPath: job.mediaAsset.filePath,
        mediaKind: "video",
        caption,
        fileSize: job.mediaAsset.fileSize,
        durationSeconds: job.mediaAsset.durationSeconds,
        width: job.mediaAsset.width,
        height: job.mediaAsset.height,
        codec: job.mediaAsset.codec,
        signal: controller.signal,
        reportProgress: heartbeat,
      });
      publicationConfirmed = true;
      if (heartbeatFailure) throw heartbeatFailure;
      if (!await this.repository.complete(job.id, claimToken, result, new Date())) throw new PublisherError("LEASE_LOST", "Publish completed remotely after its job claim was lost; reconcile the account manually", false, true);
      this.logger.info({ operation: "publisher.complete", jobId: job.id, postId: job.sourcePost.platformPostId, attemptCount: job.attemptCount, publishedPostId: result.platformPostId }, "Publish completed");
    } catch (error) {
      const publisherError = error instanceof PublisherError
        ? error
        : publicationConfirmed
          ? new PublisherError("CONFIRMATION_FAILED", error instanceof Error ? error.message : String(error), false, true, { cause: error })
          : new PublisherError("SUBMISSION_FAILED", error instanceof Error ? error.message : String(error), true, false, { cause: error });
      const maxAttempts = publisherError.kind === "PROCESSING_TIMEOUT" ? Math.min(this.maxAttempts, 2) : this.maxAttempts;
      const nextAttemptAt = publisherError.retryable && job.attemptCount < maxAttempts ? new Date(Date.now() + 60_000 * 2 ** (job.attemptCount - 1)) : null;
      const manualAttention = publisherError.manualAttention;
      const persisted = await this.repository.fail(job.id, claimToken, `${publisherError.kind}: ${publisherError.message}`, nextAttemptAt, manualAttention);
      if (!persisted) this.logger.warn({ operation: "publisher.claim.lost", jobId: job.id, postId: job.sourcePost.platformPostId, failure: publisherError.kind }, "Publish result was not persisted because the claim is no longer current");
      this.logger.error({ operation: "publisher.failed", jobId: job.id, postId: job.sourcePost.platformPostId, attemptCount: job.attemptCount, failure: publisherError.kind, retryable: nextAttemptAt !== null, nextAttemptAt: nextAttemptAt?.toISOString() ?? null, manualIntervention: manualAttention }, "Publish failed");
      try {
        await this.onPublishFailure?.({ jobId: job.id, platformPostId: job.sourcePost.platformPostId, publisherIdentityId: this.publisherIdentityId ?? null, error: `${publisherError.kind}: ${publisherError.message}`, attemptCount: job.attemptCount, manualAttention, retryable: nextAttemptAt !== null });
      } catch (notificationError) {
        this.logger.warn({ operation: "publisher.notification.failed", jobId: job.id, error: notificationError instanceof Error ? notificationError.message : String(notificationError) }, "Publish failure notification could not be emitted");
      }
    } finally {
      clearInterval(heartbeatTimer);
    }
  }

  async processPending(): Promise<number> {
    let processed = 0;
    while (await this.processNext()) processed += 1;
    return processed;
  }
}
