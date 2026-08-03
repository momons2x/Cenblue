import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { PrismaClient } from "@prisma/client";

export type StorageIssue = { sourcePostId: string; path: string; problem: string };

function inside(directory: string, path: string): boolean {
  const value = relative(resolve(directory), resolve(path));
  return value !== "" && !value.startsWith("..") && !value.includes(":");
}

async function checksum(path: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    createReadStream(path).on("error", reject).on("data", (chunk: Buffer) => hash.update(chunk)).on("end", () => resolvePromise(hash.digest("hex")));
  });
}

export class StorageMaintenance {
  constructor(private readonly client: PrismaClient) {}

  async audit(videosDirectory: string, thumbnailsDirectory: string): Promise<StorageIssue[]> {
    const assets = await this.client.mediaAsset.findMany();
    const issues: StorageIssue[] = [];
    for (const asset of assets) {
      if (!inside(videosDirectory, asset.filePath)) {
        issues.push({ sourcePostId: asset.sourcePostId, path: asset.filePath, problem: "video path is outside configured storage" });
        continue;
      }
      try {
        const file = await stat(asset.filePath);
        if (!file.isFile() || file.size <= 0) issues.push({ sourcePostId: asset.sourcePostId, path: asset.filePath, problem: "video is missing or empty" });
        else if (file.size !== asset.fileSize) issues.push({ sourcePostId: asset.sourcePostId, path: asset.filePath, problem: "file size differs from database metadata" });
        else if (await checksum(asset.filePath) !== asset.checksum) issues.push({ sourcePostId: asset.sourcePostId, path: asset.filePath, problem: "checksum mismatch" });
      } catch { issues.push({ sourcePostId: asset.sourcePostId, path: asset.filePath, problem: "video file is missing" }); }
      if (asset.thumbnailPath) {
        if (!inside(thumbnailsDirectory, asset.thumbnailPath)) issues.push({ sourcePostId: asset.sourcePostId, path: asset.thumbnailPath, problem: "thumbnail path is outside configured storage" });
        else try { await stat(asset.thumbnailPath); } catch { issues.push({ sourcePostId: asset.sourcePostId, path: asset.thumbnailPath, problem: "thumbnail file is missing" }); }
      }
    }
    return issues;
  }

  async cleanTemporary(directory: string, olderThan: Date): Promise<number> {
    const root = resolve(directory);
    await mkdir(root, { recursive: true });
    const entries = await readdir(root, { withFileTypes: true });
    let removed = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.includes(".part")) continue;
      const path = resolve(root, entry.name);
      if (!inside(root, path) || (await stat(path)).mtime >= olderThan) continue;
      await rm(path, { force: true });
      removed += 1;
    }
    return removed;
  }

  async backup(directory: string, now = new Date()): Promise<string> {
    const root = resolve(directory);
    await mkdir(root, { recursive: true });
    const stamp = now.toISOString().replaceAll(":", "-").replaceAll(".", "-");
    const path = resolve(root, `cenblu-${stamp}.db`);
    if (!inside(root, path)) throw new Error("Backup path is outside configured storage");
    const escaped = path.replaceAll("'", "''").replaceAll("\\", "/");
    await this.client.$executeRawUnsafe(`VACUUM INTO '${escaped}'`);
    return path;
  }
}
