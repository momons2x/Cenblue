import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { withDatabaseRetry } from "@cenblu/database";

export class FullResetService {
  constructor(private readonly client: PrismaClient) {}

  async reset(storage: { logs: string; thumbnails: string; temporary: string; backups: string; recovery: string }): Promise<string> {
    const [locks, downloads, publishes, collections] = await Promise.all([
      this.client.schedulerLock.count({ where: { lockedUntil: { gt: new Date() } } }),
      this.client.downloadJob.count({ where: { status: "RUNNING" } }),
      this.client.publishJob.count({ where: { status: "RUNNING" } }),
      this.client.collectionRun.count({ where: { status: "RUNNING" } }),
    ]);
    if (locks + downloads + publishes + collections > 0) throw new Error("Stop active collection, download, or publishing work before resetting data.");
    await mkdir(storage.recovery, { recursive: true });
    const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
    const recovery = resolve(storage.recovery, `cenblu-before-reset-${stamp}.db`);
    const escaped = recovery.replaceAll("'", "''").replaceAll("\\", "/");
    await this.client.$executeRawUnsafe(`VACUUM INTO '${escaped}'`);
    await withDatabaseRetry(() => this.client.$transaction([
      this.client.publishedPost.deleteMany(),
      this.client.publishJob.deleteMany(),
      this.client.mediaAsset.deleteMany(),
      this.client.downloadJob.deleteMany(),
      this.client.sourcePost.deleteMany(),
      this.client.duplicateGroup.deleteMany(),
      this.client.sourceAccount.deleteMany(),
      this.client.collectionRun.deleteMany(),
      this.client.schedulerLock.deleteMany(),
      this.client.appSetting.deleteMany(),
    ])).then(() => undefined);
    await Promise.all(Object.values(storage).map(async (directory) => {
      if (directory === storage.recovery) return;
      await rm(directory, { recursive: true, force: true });
      await mkdir(directory, { recursive: true });
    }));
    return recovery;
  }
}
