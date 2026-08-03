import type { MediaAsset, PrismaClient } from "@prisma/client";
import { withDatabaseRetry } from "./retry";

export type ClaimedDownloadJob = {
  id: string;
  attemptCount: number;
  sourcePost: { id: string; platformPostId: string; sourceUrl: string };
};

export type MediaAssetInput = Omit<MediaAsset, "id" | "sourcePostId" | "createdAt" | "updatedAt">;

export class DownloadRepository {
  constructor(private readonly client: PrismaClient) {}

  async claimNext(now: Date, staleBefore: Date): Promise<ClaimedDownloadJob | null> {
    return withDatabaseRetry(() => this.client.$transaction(async (transaction) => {
      const stale = await transaction.downloadJob.findMany({
        where: { status: "RUNNING", startedAt: { lt: staleBefore } }, select: { sourcePostId: true },
      });
      await transaction.downloadJob.updateMany({
        where: { status: "RUNNING", startedAt: { lt: staleBefore } },
        data: { status: "RETRY_WAIT", nextAttemptAt: now, lastError: "Recovered stale download claim", startedAt: null },
      });
      if (stale.length > 0) await transaction.sourcePost.updateMany({
        where: { id: { in: stale.map((job) => job.sourcePostId) } }, data: { status: "QUEUED_FOR_DOWNLOAD" },
      });
      const candidate = await transaction.downloadJob.findFirst({
        where: {
          sourcePost: { status: "QUEUED_FOR_DOWNLOAD" },
          OR: [
            { status: "PENDING" },
            { status: "RETRY_WAIT", nextAttemptAt: { lte: now } },
          ],
        },
        orderBy: [{ priority: "desc" }, { requestedAt: "asc" }, { createdAt: "asc" }],
        select: { id: true },
      });
      if (!candidate) return null;
      const claimed = await transaction.downloadJob.updateMany({
        where: {
          id: candidate.id,
          OR: [
            { status: "PENDING" },
            { status: "RETRY_WAIT", nextAttemptAt: { lte: now } },
          ],
        },
        data: { status: "RUNNING", startedAt: now, attemptCount: { increment: 1 }, nextAttemptAt: null, lastError: null, priority: 0 },
      });
      if (claimed.count !== 1) return null;
      const job = await transaction.downloadJob.findUniqueOrThrow({
        where: { id: candidate.id },
        include: { sourcePost: { select: { id: true, platformPostId: true, sourceUrl: true } } },
      });
      await transaction.sourcePost.update({ where: { id: job.sourcePost.id }, data: { status: "DOWNLOADING" } });
      return job;
    }));
  }

  async claimById(jobId: string, now: Date, staleBefore: Date): Promise<ClaimedDownloadJob | null> {
    return withDatabaseRetry(() => this.client.$transaction(async (transaction) => {
      const stale = await transaction.downloadJob.findUnique({ where: { id: jobId }, select: { status: true, startedAt: true, sourcePostId: true } });
      if (stale?.status === "RUNNING" && stale.startedAt && stale.startedAt < staleBefore) {
        await transaction.downloadJob.update({ where: { id: jobId }, data: { status: "RETRY_WAIT", nextAttemptAt: now, lastError: "Recovered stale download claim", startedAt: null } });
        await transaction.sourcePost.update({ where: { id: stale.sourcePostId }, data: { status: "QUEUED_FOR_DOWNLOAD" } });
      }
      const claimed = await transaction.downloadJob.updateMany({
        where: { id: jobId, OR: [{ status: "PENDING" }, { status: "RETRY_WAIT", nextAttemptAt: { lte: now } }] },
        data: { status: "RUNNING", startedAt: now, attemptCount: { increment: 1 }, nextAttemptAt: null, lastError: null, priority: 0 },
      });
      if (claimed.count !== 1) return null;
      const job = await transaction.downloadJob.findUniqueOrThrow({
        where: { id: jobId }, include: { sourcePost: { select: { id: true, platformPostId: true, sourceUrl: true } } },
      });
      await transaction.sourcePost.update({ where: { id: job.sourcePost.id }, data: { status: "DOWNLOADING" } });
      return job;
    }));
  }

  async requestNow(jobId: string, requestedAt = new Date()): Promise<void> {
    await withDatabaseRetry(() => this.client.$transaction(async (transaction) => {
      const job = await transaction.downloadJob.findUniqueOrThrow({ where: { id: jobId }, select: { status: true, sourcePostId: true } });
      if (job.status === "COMPLETED") throw new Error("Completed downloads cannot be downloaded again from this action");
      if (job.status === "RUNNING") throw new Error("Download is already running");
      await transaction.downloadJob.update({
        where: { id: jobId },
        data: { status: "PENDING", attemptCount: 0, nextAttemptAt: null, lastError: null, startedAt: null, priority: 100, requestedAt },
      });
      await transaction.sourcePost.update({ where: { id: job.sourcePostId }, data: { status: "QUEUED_FOR_DOWNLOAD" } });
    }));
  }

  async cancel(jobId: string): Promise<void> {
    await withDatabaseRetry(() => this.client.$transaction(async (transaction) => {
      const job = await transaction.downloadJob.findUniqueOrThrow({ where: { id: jobId }, select: { status: true, sourcePostId: true } });
      if (job.status === "RUNNING") throw new Error("Running downloads cannot be cancelled");
      if (job.status === "COMPLETED") throw new Error("Completed downloads cannot be cancelled");
      await transaction.downloadJob.update({ where: { id: jobId }, data: { status: "CANCELLED", nextAttemptAt: null, priority: 0 } });
      await transaction.sourcePost.update({ where: { id: job.sourcePostId }, data: { status: "SKIPPED" } });
    }));
  }

  async complete(jobId: string, sourcePostId: string, asset: MediaAssetInput, completedAt: Date): Promise<void> {
    await withDatabaseRetry(() => this.client.$transaction(async (transaction) => {
      await transaction.mediaAsset.upsert({
        where: { sourcePostId },
        create: { sourcePostId, ...asset },
        update: asset,
      });
      await transaction.sourcePost.update({ where: { id: sourcePostId }, data: { status: "DOWNLOADED" } });
      await transaction.downloadJob.update({
        where: { id: jobId },
        data: { status: "COMPLETED", completedAt, nextAttemptAt: null, lastError: null, priority: 0 },
      });
    }));
  }

  async fail(jobId: string, sourcePostId: string, error: string, nextAttemptAt: Date | null): Promise<void> {
    await withDatabaseRetry(() => this.client.$transaction([
      this.client.downloadJob.update({
        where: { id: jobId },
        data: { status: nextAttemptAt ? "RETRY_WAIT" : "FAILED", lastError: error.slice(0, 2_000), nextAttemptAt, startedAt: null },
      }),
      this.client.sourcePost.update({
        where: { id: sourcePostId }, data: { status: nextAttemptAt ? "QUEUED_FOR_DOWNLOAD" : "FAILED" },
      }),
    ])).then(() => undefined);
  }
}
