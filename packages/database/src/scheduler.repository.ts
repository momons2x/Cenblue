import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { withDatabaseRetry } from "./retry";

export type SchedulerLease = { name: string; ownerId: string };
export type ReviewCaptionSource = { platformPostId: string; text: string; sourceUrl: string; sourceAccount: { username: string; captionTemplate: string | null; attributionTemplate: string | null; hashtagRules: string | null } };
export type ReviewCaptionResolver = (source: ReviewCaptionSource) => string;

export class SchedulerRepository {
  constructor(private readonly client: PrismaClient) {}

  async acquire(name: string, now: Date, leaseMs: number): Promise<SchedulerLease | null> {
    const ownerId = randomUUID();
    const lockedUntil = new Date(now.getTime() + leaseMs);
    return withDatabaseRetry(() => this.client.$transaction(async (transaction) => {
      const existing = await transaction.schedulerLock.findUnique({ where: { name } });
      if (!existing) {
        await transaction.schedulerLock.create({ data: { name, ownerId, lockedUntil } });
        return { name, ownerId };
      }
      const updated = await transaction.schedulerLock.updateMany({
        where: { name, lockedUntil: { lte: now } }, data: { ownerId, lockedUntil },
      });
      return updated.count === 1 ? { name, ownerId } : null;
    }));
  }

  async release(lease: SchedulerLease): Promise<void> {
    await this.client.schedulerLock.updateMany({
      where: { name: lease.name, ownerId: lease.ownerId },
      data: { lockedUntil: new Date(0) },
    });
  }

  async renew(lease: SchedulerLease, now: Date, leaseMs: number): Promise<boolean> {
    const updated = await withDatabaseRetry(() => this.client.schedulerLock.updateMany({
      where: { name: lease.name, ownerId: lease.ownerId, lockedUntil: { gt: now } },
      data: { lockedUntil: new Date(now.getTime() + leaseMs) },
    }));
    return updated.count === 1;
  }

  async scheduleDownloadedAssets(now: Date, intervalMinutes: number, captionResolver?: ReviewCaptionResolver): Promise<number> {
    // Kept in the interface so existing scheduler callers need no special review-mode branch.
    void now;
    void intervalMinutes;
    return withDatabaseRetry(() => this.client.$transaction(async (transaction) => {
      const assets = await transaction.mediaAsset.findMany({
        where: { sourcePost: { publishJobs: { none: {} }, status: "DOWNLOADED" } },
        include: { sourcePost: { include: { sourceAccount: { select: { username: true, captionTemplate: true, attributionTemplate: true, hashtagRules: true } } } } },
        orderBy: { createdAt: "asc" },
      });
      if (assets.length === 0) return 0;
      for (const asset of assets) {
        await transaction.publishJob.create({
          data: { sourcePostId: asset.sourcePost.id, mediaAssetId: asset.id, caption: captionResolver?.(asset.sourcePost) ?? asset.sourcePost.text, status: "READY_FOR_REVIEW" },
        });
        await transaction.sourcePost.update({ where: { id: asset.sourcePost.id }, data: { status: "READY_FOR_REVIEW" } });
      }
      return assets.length;
    }));
  }

  async scheduleDownloadedAsset(sourcePostId: string, captionResolver?: ReviewCaptionResolver): Promise<boolean> {
    return withDatabaseRetry(() => this.client.$transaction(async (transaction) => {
      const asset = await transaction.mediaAsset.findFirst({ where: { sourcePostId, sourcePost: { publishJobs: { none: {} }, status: "DOWNLOADED" } }, include: { sourcePost: { include: { sourceAccount: { select: { username: true, captionTemplate: true, attributionTemplate: true, hashtagRules: true } } } } } });
      if (!asset) return false;
      await transaction.publishJob.create({ data: { sourcePostId: asset.sourcePost.id, mediaAssetId: asset.id, caption: captionResolver?.(asset.sourcePost) ?? asset.sourcePost.text, status: "READY_FOR_REVIEW" } });
      await transaction.sourcePost.update({ where: { id: sourcePostId }, data: { status: "READY_FOR_REVIEW" } });
      return true;
    }));
  }
}
