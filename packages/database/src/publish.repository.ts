import { randomUUID } from "node:crypto";
import type { PrismaClient, PublishJob } from "@prisma/client";
import { withDatabaseRetry } from "./retry";

export type ClaimedPublishJob = PublishJob & {
  sourcePost: { platformPostId: string };
  mediaAsset: { filePath: string; fileSize: number; durationSeconds: number; width: number; height: number; codec: string | null };
};

export type PublishedResult = {
  platformPostId: string | null;
  platformUrl: string | null;
};

export class PublishRepository {
  constructor(private readonly client: PrismaClient) {}

  async createForPost(platformPostId: string, caption: string, publisherIdentityId?: string): Promise<PublishJob> {
    return withDatabaseRetry(() => this.client.$transaction(async (transaction) => {
      const sourcePost = await transaction.sourcePost.findUnique({
        where: { platformPostId },
        include: { mediaAsset: true, publishJobs: true },
      });
      if (!sourcePost?.mediaAsset) throw new Error(`No validated media asset exists for post ${platformPostId}`);
      const existing = sourcePost.publishJobs.find((job) => job.publisherIdentityId === (publisherIdentityId ?? null));
      if (existing) return existing;
      const job = await transaction.publishJob.create({
        // The CLI command is an explicit operator confirmation.
        data: { sourcePostId: sourcePost.id, mediaAssetId: sourcePost.mediaAsset.id, publisherIdentityId, caption, status: "APPROVED" },
      });
      await transaction.sourcePost.update({ where: { id: sourcePost.id }, data: { status: "SCHEDULED" } });
      return job;
    }));
  }

  async approveTargets(jobId: string, publisherIdentityIds: string[], scheduledFor: Date | null, caption: string, review?: { notes: string; tags: string }): Promise<string[]> {
    if (publisherIdentityIds.length === 0) throw new Error("Select at least one Publisher identity.");
    const uniquePublisherIds = [...new Set(publisherIdentityIds)];
    return withDatabaseRetry(() => this.client.$transaction(async (transaction) => {
      const reviewJob = await transaction.publishJob.findUniqueOrThrow({ where: { id: jobId }, include: { publishedPost: true } });
      if (reviewJob.publishedPost || !["READY_FOR_REVIEW", "FAILED", "MANUAL_ATTENTION"].includes(reviewJob.status)) throw new Error("This item is no longer awaiting review.");
      const publishers = await transaction.browserIdentity.findMany({ where: { id: { in: uniquePublisherIds }, role: "PUBLISHER", enabled: true } });
      if (publishers.length !== uniquePublisherIds.length) throw new Error("One or more selected Publisher identities are unavailable.");
      const [firstPublisherId, ...additionalPublisherIds] = uniquePublisherIds;
      await transaction.publishJob.update({ where: { id: jobId }, data: { publisherIdentityId: firstPublisherId, status: "APPROVED", scheduledFor, caption, nextAttemptAt: null, lastError: null, startedAt: null, heartbeatAt: null, claimToken: null, phase: null } });
      const targetIds = [jobId];
      for (const publisherIdentityId of additionalPublisherIds) {
        const existingTarget = await transaction.publishJob.findFirst({ where: { sourcePostId: reviewJob.sourcePostId, publisherIdentityId }, include: { publishedPost: true } });
        if (existingTarget?.publishedPost) continue;
        const target = await transaction.publishJob.upsert({
          where: { sourcePostId_publisherIdentityId: { sourcePostId: reviewJob.sourcePostId, publisherIdentityId } },
          create: { sourcePostId: reviewJob.sourcePostId, mediaAssetId: reviewJob.mediaAssetId, publisherIdentityId, caption, status: "APPROVED", scheduledFor },
          update: { caption, status: "APPROVED", scheduledFor, nextAttemptAt: null, lastError: null, startedAt: null, heartbeatAt: null, claimToken: null, phase: null },
        });
        targetIds.push(target.id);
      }
      await transaction.sourcePost.update({ where: { id: reviewJob.sourcePostId }, data: { status: "SCHEDULED", reviewNotes: review?.notes, internalTags: review?.tags } });
      return targetIds;
    }));
  }

  async approve(jobId: string, scheduledFor: Date | null, caption?: string, review?: { notes: string; tags: string }): Promise<void> {
    await withDatabaseRetry(() => this.client.$transaction(async (transaction) => {
      const job = await transaction.publishJob.findUniqueOrThrow({ where: { id: jobId }, include: { publishedPost: true } });
      if (job.publishedPost || ["COMPLETED", "RUNNING", "PUBLISHING", "CANCELLED", "REJECTED"].includes(job.status)) throw new Error("This publish job can no longer be approved.");
      if (!["READY_FOR_REVIEW", "FAILED", "MANUAL_ATTENTION"].includes(job.status)) throw new Error("This publish job is not awaiting review.");
      await transaction.publishJob.update({ where: { id: jobId }, data: { status: "APPROVED", scheduledFor, caption: caption ?? job.caption, nextAttemptAt: null, lastError: null, startedAt: null, heartbeatAt: null, claimToken: null, phase: null } });
      await transaction.sourcePost.update({ where: { id: job.sourcePostId }, data: { status: "SCHEDULED", reviewNotes: review?.notes, internalTags: review?.tags } });
    }));
  }

  async approveMany(jobIds: string[], scheduledFor: Date | null): Promise<void> {
    await withDatabaseRetry(() => this.client.$transaction(async (transaction) => {
      const jobs = await transaction.publishJob.findMany({ where: { id: { in: jobIds } }, include: { publishedPost: true } });
      if (jobs.length !== jobIds.length || jobs.some((job) => job.publishedPost || !["READY_FOR_REVIEW", "FAILED", "MANUAL_ATTENTION"].includes(job.status))) throw new Error("One or more selected jobs can no longer be approved.");
      await transaction.publishJob.updateMany({ where: { id: { in: jobIds } }, data: { status: "APPROVED", scheduledFor, nextAttemptAt: null, lastError: null, startedAt: null, heartbeatAt: null, claimToken: null, phase: null } });
      await transaction.sourcePost.updateMany({ where: { id: { in: jobs.map((job) => job.sourcePostId) } }, data: { status: "SCHEDULED" } });
    }));
  }

  async scheduleBatch(jobIds: string[], times: { jobId: string; scheduledFor: Date }[]): Promise<void> {
    await withDatabaseRetry(() => this.client.$transaction(async (transaction) => {
      const jobs = await transaction.publishJob.findMany({ where: { id: { in: jobIds } }, include: { publishedPost: true } });
      if (jobs.length !== jobIds.length || jobs.some((job) => job.publishedPost || !["READY_FOR_REVIEW", "FAILED", "MANUAL_ATTENTION"].includes(job.status))) throw new Error("One or more selected jobs can no longer be approved.");
      const byId = new Map(times.map((entry) => [entry.jobId, entry.scheduledFor]));
      for (const job of jobs) {
        await transaction.publishJob.update({ where: { id: job.id }, data: { status: "APPROVED", scheduledFor: byId.get(job.id) ?? null, nextAttemptAt: null, lastError: null, startedAt: null, heartbeatAt: null, claimToken: null, phase: null } });
      }
      await transaction.sourcePost.updateMany({ where: { id: { in: jobs.map((job) => job.sourcePostId) } }, data: { status: "SCHEDULED" } });
    }));
  }

  async reschedule(jobId: string, scheduledFor: Date): Promise<void> {
    await withDatabaseRetry(() => this.client.$transaction(async (transaction) => {
      const job = await transaction.publishJob.findUniqueOrThrow({ where: { id: jobId }, include: { publishedPost: true } });
      if (job.publishedPost || !["APPROVED", "RETRY_WAIT"].includes(job.status)) throw new Error("Only approved unpublished jobs can be rescheduled.");
      await transaction.publishJob.update({ where: { id: jobId }, data: { scheduledFor, status: "APPROVED", nextAttemptAt: null } });
      await transaction.sourcePost.update({ where: { id: job.sourcePostId }, data: { status: "SCHEDULED" } });
    }));
  }

  async reject(jobId: string): Promise<void> {
    await withDatabaseRetry(() => this.client.$transaction(async (transaction) => {
      const job = await transaction.publishJob.findUniqueOrThrow({ where: { id: jobId } });
      if (!["READY_FOR_REVIEW", "MANUAL_ATTENTION", "FAILED"].includes(job.status)) throw new Error("Only review items can be rejected.");
      await transaction.publishJob.update({ where: { id: jobId }, data: { status: "REJECTED", scheduledFor: null, nextAttemptAt: null } });
      await transaction.sourcePost.update({ where: { id: job.sourcePostId }, data: { status: "SKIPPED" } });
    }));
  }

  async returnToDownloads(jobId: string): Promise<void> {
    await withDatabaseRetry(() => this.client.$transaction(async (transaction) => {
      const job = await transaction.publishJob.findUniqueOrThrow({ where: { id: jobId }, include: { publishedPost: true } });
      if (job.publishedPost || !["READY_FOR_REVIEW", "FAILED", "MANUAL_ATTENTION"].includes(job.status)) throw new Error("Only unpublished review items can return to Downloads.");
      await transaction.publishJob.delete({ where: { id: jobId } });
      await transaction.sourcePost.update({ where: { id: job.sourcePostId }, data: { status: "DOWNLOADED" } });
    }));
  }

  async resolveManualAttention(jobId: string): Promise<void> {
    await withDatabaseRetry(() => this.client.$transaction(async (transaction) => {
      const job = await transaction.publishJob.findUniqueOrThrow({ where: { id: jobId }, include: { publishedPost: true } });
      if (job.publishedPost || job.status !== "MANUAL_ATTENTION") throw new Error("Only a manual-attention job can be returned to Review.");
      await transaction.publishJob.update({ where: { id: jobId }, data: { status: "READY_FOR_REVIEW", scheduledFor: null, nextAttemptAt: null, startedAt: null, heartbeatAt: null, claimToken: null, phase: null } });
      await transaction.sourcePost.update({ where: { id: job.sourcePostId }, data: { status: "READY_FOR_REVIEW" } });
    }));
  }

  async recoverIncorrectPublishedPost(jobId: string): Promise<void> {
    await withDatabaseRetry(() => this.client.$transaction(async (transaction) => {
      const job = await transaction.publishJob.findUniqueOrThrow({ where: { id: jobId }, include: { publishedPost: true, mediaAsset: true } });
      if (job.status !== "COMPLETED" || !job.publishedPost) throw new Error("Only a completed published job can use this recovery action.");
      if (job.mediaAsset.localRemovedAt) throw new Error("A publication cannot return to Review after its local media has been removed.");
      await transaction.publishedPost.delete({ where: { publishJobId: jobId } });
      await transaction.publishJob.update({ where: { id: jobId }, data: { status: "READY_FOR_REVIEW", scheduledFor: null, nextAttemptAt: null, startedAt: null, heartbeatAt: null, claimToken: null, phase: null, publishedAt: null, lastError: "Operator deleted an incorrect X post and requested a corrected republish" } });
      await transaction.sourcePost.update({ where: { id: job.sourcePostId }, data: { status: "READY_FOR_REVIEW" } });
    }));
  }

  async retry(jobId: string): Promise<void> {
    await withDatabaseRetry(() => this.client.$transaction(async (transaction) => {
      const job = await transaction.publishJob.findUniqueOrThrow({ where: { id: jobId }, include: { publishedPost: true } });
      if (job.publishedPost || !["FAILED", "RETRY_WAIT"].includes(job.status)) throw new Error("Only failed unpublished jobs can be retried.");
      await transaction.publishJob.update({ where: { id: jobId }, data: { status: "APPROVED", nextAttemptAt: null, lastError: null, startedAt: null, heartbeatAt: null, claimToken: null, phase: null } });
      await transaction.sourcePost.update({ where: { id: job.sourcePostId }, data: { status: "SCHEDULED" } });
    }));
  }

  async cancel(jobId: string): Promise<void> {
    await withDatabaseRetry(() => this.client.$transaction(async (transaction) => {
      const job = await transaction.publishJob.findUniqueOrThrow({ where: { id: jobId }, include: { publishedPost: true } });
      if (job.publishedPost || !["APPROVED", "RETRY_WAIT"].includes(job.status)) throw new Error("Only approved unpublished jobs can return to review.");
      await transaction.publishJob.update({ where: { id: jobId }, data: { status: "READY_FOR_REVIEW", scheduledFor: null, nextAttemptAt: null, startedAt: null, heartbeatAt: null, claimToken: null, phase: null } });
      await transaction.sourcePost.update({ where: { id: job.sourcePostId }, data: { status: "READY_FOR_REVIEW" } });
    }));
  }

  async setOperatorStatus(jobId: string, status: "READY_FOR_REVIEW" | "APPROVED" | "REJECTED"): Promise<void> {
    await withDatabaseRetry(() => this.client.$transaction(async (transaction) => {
      const job = await transaction.publishJob.findUniqueOrThrow({ where: { id: jobId }, include: { publishedPost: true } });
      if (job.publishedPost || ["COMPLETED", "RUNNING", "PUBLISHING"].includes(job.status)) throw new Error("Active or completed publications cannot be changed manually.");
      await transaction.publishJob.update({
        where: { id: jobId },
        data: { status, scheduledFor: null, nextAttemptAt: null, lastError: null, startedAt: null, heartbeatAt: null, claimToken: null, phase: null },
      });
      await transaction.sourcePost.update({ where: { id: job.sourcePostId }, data: { status: status === "APPROVED" ? "SCHEDULED" : status === "REJECTED" ? "SKIPPED" : "READY_FOR_REVIEW" } });
    }));
  }

  async findDueScheduledIds(now: Date, limit = 10, publisherIdentityId?: string): Promise<string[]> {
    const jobs = await this.client.publishJob.findMany({
      where: {
        publisherIdentityId,
        publishedPost: null,
        scheduledFor: { not: null, lte: now },
        OR: [
          { status: "APPROVED" },
          { status: "RETRY_WAIT", nextAttemptAt: { lte: now } },
        ],
      },
      orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }],
      take: limit,
      select: { id: true },
    });
    return jobs.map((job) => job.id);
  }

  async claimNext(now: Date, staleBefore: Date, publisherIdentityId?: string): Promise<ClaimedPublishJob | null> {
    return withDatabaseRetry(() => this.client.$transaction(async (transaction) => {
      const stale = await transaction.publishJob.findMany({
        where: { status: "RUNNING", publisherIdentityId, OR: [{ heartbeatAt: { lt: staleBefore } }, { heartbeatAt: null, startedAt: { lt: staleBefore } }] }, select: { id: true, sourcePostId: true },
      });
      if (stale.length > 0) {
        await transaction.publishJob.updateMany({
          where: { id: { in: stale.map((job) => job.id) } },
          data: { status: "MANUAL_ATTENTION", lastError: "Recovered uncertain stale publish claim; verify account before retry", startedAt: null, heartbeatAt: null, claimToken: null, phase: null },
        });
        await transaction.sourcePost.updateMany({
          where: { id: { in: stale.map((job) => job.sourcePostId) } }, data: { status: "READY_FOR_REVIEW" },
        });
      }
      const candidate = await transaction.publishJob.findFirst({
        where: {
          publisherIdentityId,
          publishedPost: null,
          AND: [
            { OR: [{ status: "APPROVED" }, { status: "RETRY_WAIT", nextAttemptAt: { lte: now } }] },
            { OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }] },
          ],
        },
        orderBy: { createdAt: "asc" }, select: { id: true },
      });
      if (!candidate) return null;
      const claimToken = randomUUID();
      const claimed = await transaction.publishJob.updateMany({
        where: { id: candidate.id, OR: [{ status: "APPROVED" }, { status: "RETRY_WAIT", nextAttemptAt: { lte: now } }] },
        data: { status: "RUNNING", startedAt: now, heartbeatAt: now, claimToken, phase: "PREPARING", attemptCount: { increment: 1 }, nextAttemptAt: null, lastError: null },
      });
      if (claimed.count !== 1) return null;
      const job = await transaction.publishJob.findUniqueOrThrow({
        where: { id: candidate.id },
        include: { sourcePost: { select: { platformPostId: true } }, mediaAsset: { select: { filePath: true, fileSize: true, durationSeconds: true, width: true, height: true, codec: true } } },
      });
      await transaction.sourcePost.update({ where: { id: job.sourcePostId }, data: { status: "PUBLISHING" } });
      return job;
    }));
  }

  async claimById(jobId: string, now: Date, staleBefore: Date, publisherIdentityId?: string): Promise<ClaimedPublishJob | null> {
    return withDatabaseRetry(() => this.client.$transaction(async (transaction) => {
      const existing = await transaction.publishJob.findUnique({
        where: { id: jobId },
        include: { publishedPost: true },
      });
      if (!existing) throw new Error("Publish job no longer exists.");
      if (publisherIdentityId && existing.publisherIdentityId !== publisherIdentityId) throw new Error("This publish job belongs to a different Publisher identity.");
      if (existing.publishedPost || existing.status === "COMPLETED") {
        if (existing.publishedPost && existing.status !== "COMPLETED") {
          await transaction.publishJob.update({ where: { id: jobId }, data: { status: "COMPLETED", publishedAt: existing.publishedPost.publishedAt } });
        }
        throw new Error("This post has already been published.");
      }
      if (existing.status === "RUNNING") {
        const lastHeartbeat = existing.heartbeatAt ?? existing.startedAt;
        if (!lastHeartbeat || lastHeartbeat >= staleBefore) throw new Error("This post is already being published.");
        await transaction.publishJob.update({ where: { id: jobId }, data: { status: "MANUAL_ATTENTION", startedAt: null, heartbeatAt: null, claimToken: null, phase: null, lastError: "Recovered uncertain stale publish claim; verify account before retry" } });
        await transaction.sourcePost.update({ where: { id: existing.sourcePostId }, data: { status: "READY_FOR_REVIEW" } });
        throw new Error("The previous publish attempt is uncertain. Verify the X account before retrying.");
      }
      if (!["APPROVED", "RETRY_WAIT"].includes(existing.status)) throw new Error("Only an approved post can be published.");
      if (existing.scheduledFor && existing.scheduledFor > now) throw new Error("This post is scheduled for later.");
      if (existing.status === "RETRY_WAIT" && existing.nextAttemptAt && existing.nextAttemptAt > now) throw new Error("This post is still waiting for its retry time.");
      const claimToken = randomUUID();
      const claimed = await transaction.publishJob.updateMany({
        where: { id: jobId, status: existing.status },
        data: { status: "RUNNING", startedAt: now, heartbeatAt: now, claimToken, phase: "PREPARING", attemptCount: { increment: 1 }, nextAttemptAt: null, lastError: null },
      });
      if (claimed.count !== 1) return null;
      const job = await transaction.publishJob.findUniqueOrThrow({
        where: { id: jobId },
        include: { sourcePost: { select: { platformPostId: true } }, mediaAsset: { select: { filePath: true, fileSize: true, durationSeconds: true, width: true, height: true, codec: true } } },
      });
      await transaction.sourcePost.update({ where: { id: job.sourcePostId }, data: { status: "PUBLISHING" } });
      return job;
    }));
  }

  async heartbeat(jobId: string, claimToken: string, phase: string, now = new Date()): Promise<boolean> {
    const updated = await withDatabaseRetry(() => this.client.publishJob.updateMany({
      where: { id: jobId, status: "RUNNING", claimToken },
      data: { heartbeatAt: now, phase },
    }));
    return updated.count === 1;
  }

  async complete(jobId: string, claimToken: string, result: PublishedResult, publishedAt: Date): Promise<boolean> {
    return withDatabaseRetry(() => this.client.$transaction(async (transaction) => {
      const job = await transaction.publishJob.findFirst({ where: { id: jobId, status: "RUNNING", claimToken }, select: { sourcePostId: true } });
      if (!job) return false;
      await transaction.publishedPost.create({ data: { publishJobId: jobId, ...result, publishedAt } });
      await transaction.publishJob.update({ where: { id: jobId }, data: { status: "COMPLETED", publishedAt, lastError: null, heartbeatAt: null, claimToken: null, phase: null } });
      await transaction.sourcePost.update({ where: { id: job.sourcePostId }, data: { status: "PUBLISHED" } });
      return true;
    }));
  }

  async fail(jobId: string, claimToken: string, error: string, nextAttemptAt: Date | null, manualAttention: boolean): Promise<boolean> {
    return withDatabaseRetry(() => this.client.$transaction(async (transaction) => {
      const job = await transaction.publishJob.findFirst({ where: { id: jobId, status: "RUNNING", claimToken }, select: { sourcePostId: true } });
      if (!job) return false;
      await transaction.publishJob.update({
        where: { id: jobId },
        data: { status: manualAttention ? "MANUAL_ATTENTION" : nextAttemptAt ? "RETRY_WAIT" : "FAILED", lastError: error.slice(0, 2_000), nextAttemptAt, startedAt: null, heartbeatAt: null, claimToken: null, phase: null },
      });
      await transaction.sourcePost.update({ where: { id: job.sourcePostId }, data: { status: "READY_FOR_REVIEW" } });
      return true;
    }));
  }
}
