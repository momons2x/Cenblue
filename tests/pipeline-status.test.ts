import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PipelineStatusRepository, prisma, SourceAccountRepository, SourcePostRepository } from "@cenblu/database";

beforeEach(async () => {
  await prisma.publishedPost.deleteMany();
  await prisma.publishJob.deleteMany();
  await prisma.mediaAsset.deleteMany();
  await prisma.downloadJob.deleteMany();
  await prisma.sourcePost.deleteMany();
  await prisma.sourceAccount.deleteMany();
  await prisma.runtimeStatus.deleteMany();
});

afterAll(async () => prisma.$disconnect());

describe("pipeline status", () => {
  it("reports counts and renders a readable summary", async () => {
    const accounts = new SourceAccountRepository(prisma);
    const source = await accounts.create({ username: "pipeline_source", enabled: true });
    const posts = new SourcePostRepository(prisma);
    await posts.persistNew(source.id, [
      { platformPostId: "920001", sourceUrl: "https://x.com/pipeline_source/status/920001", text: "a", postedAt: new Date(), mediaType: "VIDEO" },
      { platformPostId: "920002", sourceUrl: "https://x.com/pipeline_source/status/920002", text: "b", postedAt: new Date(), mediaType: "VIDEO" },
    ], new Date());
    await prisma.downloadJob.updateMany({ data: { status: "FAILED" } });
    await prisma.runtimeStatus.create({ data: { component: "pipeline", status: "RUNNING", currentOperation: "download" } });

    const report = await new PipelineStatusRepository(prisma).status();
    expect(report.enabledSources).toBe(1);
    expect(report.failedDownloads).toBe(2);
    expect(report.workerActivity).toEqual([expect.objectContaining({ component: "pipeline", status: "RUNNING" })]);

    const rendered = await new PipelineStatusRepository(prisma).render();
    expect(rendered).toContain("Sources: 1 enabled");
    expect(rendered).toContain("2 failed");
    expect(rendered).toContain("pipeline: RUNNING");
  });

  it("counts posts published today separately from total", async () => {
    const accounts = new SourceAccountRepository(prisma);
    const source = await accounts.create({ username: "pipeline_published", enabled: true });
    const posts = new SourcePostRepository(prisma);
    await posts.persistNew(source.id, [{ platformPostId: "920003", sourceUrl: "https://x.com/pipeline_published/status/920003", text: "c", postedAt: new Date(), mediaType: "VIDEO" }], new Date());
    const post = await prisma.sourcePost.findUniqueOrThrow({ where: { platformPostId: "920003" } });
    const media = await prisma.mediaAsset.create({ data: { sourcePostId: post.id, filePath: "video.mp4", mimeType: "video/mp4", fileSize: 1, durationSeconds: 1, width: 1, height: 1, checksum: "pipeline-checksum" } });
    const job = await prisma.publishJob.create({ data: { sourcePostId: post.id, mediaAssetId: media.id, caption: "c", status: "COMPLETED" } });
    await prisma.publishedPost.create({ data: { publishJobId: job.id, publishedAt: new Date() } });

    const report = await new PipelineStatusRepository(prisma).status();
    expect(report.publishedToday).toBe(1);
    expect(report.publishedTotal).toBe(1);
  });
});
