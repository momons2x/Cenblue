import { rm } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { PrismaClient } from "@prisma/client";

function inside(root: string, path: string): boolean {
  const value = relative(resolve(root), resolve(path));
  return value !== "" && !value.startsWith("..") && !value.includes(":");
}

export class MediaRemovalService {
  constructor(private readonly client: PrismaClient) {}

  async removePublished(sourcePostId: string, storage: { videos: string; thumbnails: string }): Promise<void> {
    const removedAt = new Date();
    const claimed = await this.client.$transaction(async (transaction) => {
      const post = await transaction.sourcePost.findUniqueOrThrow({
        where: { id: sourcePostId },
        include: { mediaAsset: true, downloadJob: true, publishJobs: { include: { publishedPost: true } } },
      });
      if (!post.publishJobs.some((job) => job.publishedPost && job.status === "COMPLETED") || post.status !== "PUBLISHED") throw new Error("Only a confirmed published post can have its local media removed.");
      if (post.publishJobs.some((job) => !["COMPLETED", "REJECTED", "CANCELLED"].includes(job.status))) throw new Error("Local media cannot be removed while another Publisher target is still pending.");
      if (!post.mediaAsset || post.mediaAsset.localRemovedAt) throw new Error("Local media has already been removed.");
      if (post.downloadJob?.status === "RUNNING") throw new Error("Media cannot be removed while work is running.");
      if (!inside(storage.videos, post.mediaAsset.filePath) || (post.mediaAsset.thumbnailPath && !inside(storage.thumbnails, post.mediaAsset.thumbnailPath))) throw new Error("Media path is outside configured storage.");
      await transaction.mediaAsset.update({ where: { id: post.mediaAsset.id }, data: { localRemovedAt: removedAt } });
      if (post.downloadJob) await transaction.downloadJob.update({ where: { id: post.downloadJob.id }, data: { status: "CANCELLED", nextAttemptAt: null } });
      return { asset: post.mediaAsset, downloadJob: post.downloadJob };
    });
    try {
      if (claimed.asset.thumbnailPath) await rm(claimed.asset.thumbnailPath, { force: true });
      await rm(claimed.asset.filePath, { force: true });
    } catch (error) {
      await this.client.$transaction(async (transaction) => {
        await transaction.mediaAsset.updateMany({ where: { id: claimed.asset.id, localRemovedAt: removedAt }, data: { localRemovedAt: null } });
        if (claimed.downloadJob) await transaction.downloadJob.updateMany({ where: { id: claimed.downloadJob.id, status: "CANCELLED" }, data: { status: claimed.downloadJob.status, nextAttemptAt: claimed.downloadJob.nextAttemptAt } });
      });
      throw error;
    }
  }

  async remove(sourcePostId: string, storage: { videos: string; thumbnails: string }): Promise<void> {
    const post = await this.client.sourcePost.findUniqueOrThrow({ where: { id: sourcePostId }, include: { mediaAsset: true, downloadJob: true, publishJobs: { include: { publishedPost: true } } } });
    if (!post.mediaAsset) throw new Error("No local media exists for this post.");
    if (post.downloadJob?.status === "RUNNING" || post.publishJobs.some((job) => ["RUNNING", "PUBLISHING"].includes(job.status)) || post.status === "PUBLISHING") throw new Error("Media cannot be removed while work is running.");
    const asset = post.mediaAsset;
    if (!inside(storage.videos, asset.filePath) || (asset.thumbnailPath && !inside(storage.thumbnails, asset.thumbnailPath))) throw new Error("Media path is outside configured storage.");
    if (post.publishJobs.some((job) => job.publishedPost)) {
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
