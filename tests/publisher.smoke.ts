import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import pino from "pino";
import { prisma, PublishRepository, SourceAccountRepository, SourcePostRepository } from "@cenblu/database";
import { LocalPublishMediaVerifier, PublishService, type Publisher } from "@cenblu/publisher";

const videos = resolve("storage/temp/publisher-smoke-files/videos");
try {
  await prisma.publishedPost.deleteMany();
  await prisma.publishJob.deleteMany();
  await prisma.mediaAsset.deleteMany();
  await prisma.downloadJob.deleteMany();
  await prisma.sourcePost.deleteMany();
  await prisma.sourceAccount.deleteMany();
  const account = await new SourceAccountRepository(prisma).create({ username: "publisher_smoke" });
  await new SourcePostRepository(prisma).persistNew(account.id, [{ platformPostId: "50001", sourceUrl: "https://x.com/publisher_smoke/status/50001", text: "smoke", postedAt: new Date(), mediaType: "VIDEO" }], new Date());
  const post = await prisma.sourcePost.findUniqueOrThrow({ where: { platformPostId: "50001" } });
  const videoPath = resolve(videos, "50001.mp4");
  await mkdir(videos, { recursive: true });
  await writeFile(videoPath, "smoke video");
  await prisma.mediaAsset.create({ data: { sourcePostId: post.id, filePath: videoPath, mimeType: "video/mp4", fileSize: 11, durationSeconds: 1, width: 16, height: 9, checksum: "smoke" } });
  const repository = new PublishRepository(prisma);
  await repository.createForPost("50001", "Smoke caption");
  const publisher: Publisher = { publish: async () => ({ platformPostId: "950001", platformUrl: "https://x.com/cenblu/status/950001" }) };
  const service = new PublishService(repository, publisher, new LocalPublishMediaVerifier(videos), pino({ level: "silent" }), false);
  if (await service.processPending() !== 1 || await service.processPending() !== 0 || await prisma.publishedPost.count() !== 1) throw new Error("Publisher smoke test failed");
  console.log("Publisher smoke test passed: one job published, persisted, and not published twice.");
} finally { await prisma.$disconnect(); }
