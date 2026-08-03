import pino from "pino";
import { prisma, SchedulerRepository, SourceAccountRepository, SourcePostRepository } from "@cenblu/database";
import { PipelineService } from "@cenblu/scheduler";

try {
  await prisma.publishedPost.deleteMany();
  await prisma.publishJob.deleteMany();
  await prisma.mediaAsset.deleteMany();
  await prisma.downloadJob.deleteMany();
  await prisma.sourcePost.deleteMany();
  await prisma.sourceAccount.deleteMany();
  await prisma.schedulerLock.deleteMany();
  const account = await new SourceAccountRepository(prisma).create({ username: "pipeline_smoke" });
  await new SourcePostRepository(prisma).persistNew(account.id, [{ platformPostId: "70001", sourceUrl: "https://x.com/pipeline_smoke/status/70001", text: "pipeline smoke", postedAt: new Date(), mediaType: "VIDEO" }], new Date());
  const post = await prisma.sourcePost.findUniqueOrThrow({ where: { platformPostId: "70001" } });
  await prisma.mediaAsset.create({ data: { sourcePostId: post.id, filePath: "storage/videos/70001.mp4", mimeType: "video/mp4", fileSize: 1, durationSeconds: 1, width: 1, height: 1, checksum: "smoke" } });
  await prisma.sourcePost.update({ where: { id: post.id }, data: { status: "DOWNLOADED" } });
  const pipeline = new PipelineService(new SchedulerRepository(prisma), {
    collect: async () => undefined,
    download: async () => 0,
    publish: async () => false,
  }, pino({ level: "silent" }), 60, 60_000);
  const result = await pipeline.runOnce();
  const reviewJob = await prisma.publishJob.findFirst();
  if (!result.acquired || result.publishJobsScheduled !== 1 || result.published || reviewJob?.status !== "READY_FOR_REVIEW" || await prisma.publishedPost.count() !== 0) throw new Error("Pipeline smoke test failed");
  console.log("Pipeline smoke test passed: downloaded asset entered review without automatic publication.");
} finally { await prisma.$disconnect(); }
