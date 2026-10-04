import { rm } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { MediaAsset, PrismaClient } from "@prisma/client";

export type MediaStorage = { videos: string; thumbnails: string };

export type PublishedMediaPurgeSummary = {
  dryRun: boolean;
  removed: number;
  skipped: number;
  failed: number;
  bytes: number;
  failures: Array<{ sourcePostId: string; platformPostId: string; error: string }>;
};

const TERMINAL_PUBLISH_STATUSES = new Set(["COMPLETED", "REJECTED", "CANCELLED", "FAILED"]);

type RemovablePost = {
  id: string;
  status: string;
  platformPostId: string;
  mediaAsset: MediaAsset | null;
  downloadJob: { id: string; status: string } | null;
  publishJobs: Array<{ status: string }>;
};

function inside(root: string, path: string): boolean {
  const value = relative(resolve(root), resolve(path));
  return value !== "" && !value.startsWith("..") && !value.includes(":");
}

function assertRemovable(post: RemovablePost): MediaAsset {
  if (post.status !== "PUBLISHED") throw new Error("Only a published post can have its local media removed.");
  if (post.publishJobs.some((job) => !TERMINAL_PUBLISH_STATUSES.has(job.status))) throw new Error("Local media cannot be removed while another Publisher target is still pending.");
  if (!post.mediaAsset || post.mediaAsset.localRemovedAt) throw new Error("Local media has already been removed.");
  if (post.downloadJob?.status === "RUNNING") throw new Error("Media cannot be removed while work is running.");
  return post.mediaAsset;
}

function assertStoredInside(asset: MediaAsset, storage: MediaStorage): void {
  if (!inside(storage.videos, asset.filePath) || (asset.thumbnailPath && !inside(storage.thumbnails, asset.thumbnailPath))) throw new Error("Media path is outside configured storage.");
}

export class MediaRemovalService {
  constructor(private readonly client: PrismaClient) {}

  private async claimForRemoval(sourcePostId: string, storage: MediaStorage): Promise<{ asset: MediaAsset; removedAt: Date; downloadJob: { id: string; status: string; nextAttemptAt: Date | null } | null }> {
    const removedAt = new Date();
    const claimed = await this.client.$transaction(async (transaction) => {
      const post = await transaction.sourcePost.findUniqueOrThrow({
        where: { id: sourcePostId },
        include: { mediaAsset: true, downloadJob: { select: { id: true, status: true, nextAttemptAt: true } }, publishJobs: { select: { status: true } } },
      });
      const asset = assertRemovable(post);
      assertStoredInside(asset, storage);
      await transaction.mediaAsset.update({ where: { id: asset.id }, data: { localRemovedAt: removedAt } });
      if (post.downloadJob) await transaction.downloadJob.update({ where: { id: post.downloadJob.id }, data: { status: "CANCELLED", nextAttemptAt: null } });
      return { asset, downloadJob: post.downloadJob };
    });
    return { ...claimed, removedAt };
  }

  private async rollback(claimed: { asset: MediaAsset; removedAt: Date; downloadJob: { id: string; status: string; nextAttemptAt: Date | null } | null }): Promise<void> {
    await this.client.$transaction(async (transaction) => {
      await transaction.mediaAsset.updateMany({ where: { id: claimed.asset.id, localRemovedAt: claimed.removedAt }, data: { localRemovedAt: null } });
      if (claimed.downloadJob) {
        await transaction.downloadJob.updateMany({ where: { id: claimed.downloadJob.id, status: "CANCELLED" }, data: { status: claimed.downloadJob.status, nextAttemptAt: claimed.downloadJob.nextAttemptAt } });
      }
    });
  }

  private async deleteFiles(asset: MediaAsset): Promise<void> {
    if (asset.thumbnailPath) await rm(asset.thumbnailPath, { force: true });
    await rm(asset.filePath, { force: true });
  }

  async removePublished(sourcePostId: string, storage: MediaStorage): Promise<void> {
    const claimed = await this.claimForRemoval(sourcePostId, storage);
    try {
      await this.deleteFiles(claimed.asset);
    } catch (error) {
      await this.rollback(claimed);
      throw error;
    }
  }

  async purgePublished(storage: MediaStorage, options: { dryRun?: boolean } = {}): Promise<PublishedMediaPurgeSummary> {
    const dryRun = options.dryRun === true;
    const candidates = await this.client.sourcePost.findMany({
      where: { status: "PUBLISHED", mediaAsset: { localRemovedAt: null } },
      select: { id: true, platformPostId: true, status: true, mediaAsset: true, downloadJob: { select: { id: true, status: true } }, publishJobs: { select: { status: true } } },
      orderBy: { id: "asc" },
    });

    const summary: PublishedMediaPurgeSummary = { dryRun, removed: 0, skipped: 0, failed: 0, bytes: 0, failures: [] };
    for (const post of candidates) {
      let asset: MediaAsset;
      try {
        asset = assertRemovable(post);
        assertStoredInside(asset, storage);
      } catch {
        summary.skipped += 1;
        continue;
      }
      summary.bytes += asset.fileSize;
      if (dryRun) {
        summary.removed += 1;
        continue;
      }
      try {
        const claimed = await this.claimForRemoval(post.id, storage);
        try {
          await this.deleteFiles(claimed.asset);
          summary.removed += 1;
        } catch (error) {
          await this.rollback(claimed);
          throw error;
        }
      } catch (error) {
        summary.failed += 1;
        summary.bytes -= asset.fileSize;
        summary.failures.push({ sourcePostId: post.id, platformPostId: post.platformPostId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return summary;
  }

  async remove(sourcePostId: string, storage: MediaStorage): Promise<void> {
    const post = await this.client.sourcePost.findUniqueOrThrow({ where: { id: sourcePostId }, include: { mediaAsset: true, downloadJob: true, publishJobs: { include: { publishedPost: true } } } });
    if (!post.mediaAsset) throw new Error("No local media exists for this post.");
    if (post.downloadJob?.status === "RUNNING" || post.publishJobs.some((job) => ["RUNNING", "PUBLISHING"].includes(job.status)) || post.status === "PUBLISHING") throw new Error("Media cannot be removed while work is running.");
    const asset = post.mediaAsset;
    if (!inside(storage.videos, asset.filePath) || (asset.thumbnailPath && !inside(storage.thumbnails, asset.thumbnailPath))) throw new Error("Media path is outside configured storage.");
    // A published post must never fall through to the delete branch: that path drops the
    // publication record and rewrites status to SKIPPED. Legacy rows may have no publish job
    // at all, so route on status as well as on an existing PublishedPost.
    if (post.status === "PUBLISHED" || post.publishJobs.some((job) => job.publishedPost)) {
      return this.removePublished(sourcePostId, storage);
    }
    if (asset.thumbnailPath) await rm(asset.thumbnailPath, { force: true });
    await rm(asset.filePath, { force: true });
    await this.client.$transaction([
      this.client.publishJob.deleteMany({ where: { sourcePostId } }),
      this.client.mediaAsset.delete({ where: { id: asset.id } }),
      this.client.downloadJob.update({ where: { sourcePostId }, data: { status: "CANCELLED", nextAttemptAt: null, completedAt: null } }),
      this.client.sourcePost.update({ where: { id: sourcePostId }, data: { status: "SKIPPED" } }),
    ]);
  }
}
