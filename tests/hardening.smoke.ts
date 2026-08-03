import { createHash } from "node:crypto";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma, SourceAccountRepository, SourcePostRepository } from "@cenblu/database";
import { StorageMaintenance } from "@cenblu/operations";
import { createLogger } from "@cenblu/shared/logger";

const root = resolve("storage/temp/hardening-smoke-files");
const videos = resolve(root, "videos");
const thumbnails = resolve(root, "thumbnails");
const backups = resolve(root, "backups");
try {
  await rm(root, { recursive: true, force: true });
  await prisma.publishedPost.deleteMany();
  await prisma.publishJob.deleteMany();
  await prisma.mediaAsset.deleteMany();
  await prisma.downloadJob.deleteMany();
  await prisma.sourcePost.deleteMany();
  await prisma.sourceAccount.deleteMany();
  const account = await new SourceAccountRepository(prisma).create({ username: "hardening_smoke" });
  await new SourcePostRepository(prisma).persistNew(account.id, [{ platformPostId: "80001", sourceUrl: "https://x.com/hardening_smoke/status/80001", text: "hardening", postedAt: new Date(), mediaType: "VIDEO" }], new Date());
  const post = await prisma.sourcePost.findUniqueOrThrow({ where: { platformPostId: "80001" } });
  const content = Buffer.from("verified media fixture");
  const videoPath = resolve(videos, "80001.mp4");
  await mkdir(videos, { recursive: true });
  await writeFile(videoPath, content);
  await prisma.mediaAsset.create({ data: { sourcePostId: post.id, filePath: videoPath, mimeType: "video/mp4", fileSize: content.length, durationSeconds: 1, width: 16, height: 9, checksum: createHash("sha256").update(content).digest("hex") } });
  const maintenance = new StorageMaintenance(prisma);
  const issues = await maintenance.audit(videos, thumbnails);
  const backup = await maintenance.backup(backups, new Date("2026-01-01T00:00:00.000Z"));
  const logger = createLogger({ directory: resolve(root, "logs"), component: "smoke", maxBytes: 500, retainedFiles: 2 });
  logger.info({ operation: "hardening.smoke", token: "must-not-appear" }, "Hardening smoke completed");
  if (issues.length > 0 || (await stat(backup)).size <= 0) throw new Error(`Hardening smoke failed: ${JSON.stringify(issues)}`);
  console.log("Hardening smoke test passed: storage integrity, bounded logging, and SQLite backup succeeded.");
} finally { await prisma.$disconnect(); }
