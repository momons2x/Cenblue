import { createHash } from "node:crypto";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import { PermanentDownloadError } from "./errors";

export type DownloadPaths = { temporaryVideo: string; finalVideo: string; temporaryThumbnail: string; finalThumbnail: string };

function inside(directory: string, path: string): boolean {
  const value = relative(resolve(directory), resolve(path));
  return value !== "" && !value.startsWith("..") && !value.includes(":");
}

export class MediaFiles {
  constructor(
    private readonly videosDirectory: string,
    private readonly temporaryDirectory: string,
    private readonly thumbnailsDirectory: string,
  ) {}

  paths(platformPostId: string, attempt: number): DownloadPaths {
    const filename = `${platformPostId}.${attempt}`;
    return {
      temporaryVideo: resolve(this.temporaryDirectory, `${filename}.part.mp4`),
      finalVideo: resolve(this.videosDirectory, `${platformPostId}.mp4`),
      temporaryThumbnail: resolve(this.temporaryDirectory, `${filename}.part.jpg`),
      finalThumbnail: resolve(this.thumbnailsDirectory, `${platformPostId}.jpg`),
    };
  }

  async moveToFinal(temporaryPath: string, finalPath: string): Promise<void> {
    if (!inside(this.temporaryDirectory, temporaryPath) || !inside(this.videosDirectory, finalPath)) {
      throw new Error("Refusing to move media outside configured storage");
    }
    await mkdir(resolve(this.videosDirectory), { recursive: true });
    await rename(temporaryPath, finalPath);
  }

  async moveThumbnailToFinal(temporaryPath: string, finalPath: string): Promise<boolean> {
    try {
      if (!inside(this.temporaryDirectory, temporaryPath) || !inside(this.thumbnailsDirectory, finalPath)) return false;
      await stat(temporaryPath);
      await mkdir(resolve(this.thumbnailsDirectory), { recursive: true });
      await rename(temporaryPath, finalPath);
      return true;
    } catch { return false; }
  }

  async cleanup(...paths: string[]): Promise<void> {
    await Promise.all(paths.filter((path) => inside(this.temporaryDirectory, path)).map((path) => rm(path, { force: true })));
  }

  // Removes every attempt's leftovers for a post, not just the current one,
  // so retried downloads cannot accumulate .part files across attempts.
  async cleanupPostAttempts(platformPostId: string): Promise<void> {
    const directory = resolve(this.temporaryDirectory);
    let entries: string[];
    try { entries = await readdir(directory); }
    catch { return; }
    const prefix = `${platformPostId}.`;
    const targets = entries.filter((entry) => entry.startsWith(prefix) && entry.includes(".part."));
    await Promise.all(targets.map((entry) => {
      const path = resolve(directory, entry);
      if (!inside(this.temporaryDirectory, path)) return Promise.resolve();
      return rm(path, { force: true });
    }));
  }

  async exists(path: string): Promise<boolean> {
    try { return (await stat(path)).isFile(); }
    catch { return false; }
  }

  async checksum(path: string): Promise<string> {
    const { createReadStream } = await import("node:fs");
    return new Promise((resolvePromise, reject) => {
      const hash = createHash("sha256");
      createReadStream(path).on("error", reject).on("data", (chunk: Buffer) => hash.update(chunk)).on("end", () => resolvePromise(hash.digest("hex")));
    });
  }

  async fileSize(path: string): Promise<number> {
    const info = await stat(path);
    if (info.size <= 0) throw new PermanentDownloadError(`Downloaded file is empty: ${basename(path)}`);
    return info.size;
  }
}
