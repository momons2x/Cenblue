import { mkdir, rename, rm, stat } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { withDatabaseRetry } from "@cenblu/database";

type StagedFile = { original: string; staged: string };

function inside(directory: string, path: string): boolean {
  const value = relative(resolve(directory), resolve(path));
  return value !== "" && !value.startsWith("..") && !value.includes(":");
}

async function exists(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

export type SourcePurgeSummary = { posts: number; assets: number; filesRemoved: number };

export class SourcePurgeService {
  constructor(private readonly client: PrismaClient) {}

  async purge(
    sourceId: string,
    confirmedUsername: string,
    storage: { videos: string; thumbnails: string; temporary: string },
  ): Promise<SourcePurgeSummary> {
    const source = await this.client.sourceAccount.findUnique({
      where: { id: sourceId },
      include: {
        posts: { include: { mediaAsset: true, downloadJob: true, publishJobs: true } },
      },
    });
    if (!source) throw new Error("Source no longer exists");
    if (confirmedUsername.trim().toLowerCase().replace(/^@/, "") !== source.username) throw new Error("Username confirmation does not match the source");
    const active = source.posts.some((post) => post.downloadJob?.status === "RUNNING" || post.publishJobs.some((job) => job.status === "RUNNING"));
    if (active) throw new Error("Source cannot be purged while related jobs are running");

    const files = source.posts.flatMap((post) => {
      if (!post.mediaAsset) return [];
      const values: { path: string; root: string }[] = [{ path: post.mediaAsset.filePath, root: storage.videos }];
      if (post.mediaAsset.thumbnailPath) values.push({ path: post.mediaAsset.thumbnailPath, root: storage.thumbnails });
      return values;
    });
    const quarantine = resolve(storage.temporary, `purge-${source.id}-${Date.now()}`);
    const staged: StagedFile[] = [];
    await mkdir(quarantine, { recursive: true });
    try {
      for (const [index, file] of files.entries()) {
        if (!inside(file.root, file.path)) throw new Error(`Refusing to purge file outside configured storage: ${file.path}`);
        if (!await exists(file.path)) continue;
        const stagedPath = resolve(quarantine, `${index}-${basename(file.path)}`);
        await rename(file.path, stagedPath);
        staged.push({ original: file.path, staged: stagedPath });
      }
      await withDatabaseRetry(() => this.client.sourceAccount.delete({ where: { id: source.id } }));
    } catch (error) {
      for (const file of staged.reverse()) {
        await mkdir(resolve(file.original, ".."), { recursive: true });
        await rename(file.staged, file.original).catch(() => undefined);
      }
      throw error;
    }
    await rm(quarantine, { recursive: true, force: true });
    return { posts: source.posts.length, assets: source.posts.filter((post) => post.mediaAsset).length, filesRemoved: staged.length };
  }
}
