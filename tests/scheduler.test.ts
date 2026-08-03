import { afterAll, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import { DatabaseExclusiveLease, prisma, PublishRepository, SchedulerRepository, SourceAccountRepository, SourcePostRepository } from "@cenblu/database";
import { PipelineService } from "@cenblu/scheduler";

async function downloadedPost(platformPostId: string): Promise<void> {
  const account = await new SourceAccountRepository(prisma).create({ username: `scheduler_${platformPostId}` });
  await new SourcePostRepository(prisma).persistNew(account.id, [{ platformPostId, sourceUrl: `https://x.com/scheduler_${platformPostId}/status/${platformPostId}`, text: `caption ${platformPostId}`, postedAt: new Date(), mediaType: "VIDEO" }], new Date());
  const post = await prisma.sourcePost.findUniqueOrThrow({ where: { platformPostId } });
  await prisma.mediaAsset.create({ data: { sourcePostId: post.id, filePath: `storage/videos/${platformPostId}.mp4`, mimeType: "video/mp4", fileSize: 1, durationSeconds: 1, width: 1, height: 1, checksum: platformPostId } });
  await prisma.sourcePost.update({ where: { id: post.id }, data: { status: "DOWNLOADED" } });
}

beforeEach(async () => {
  await prisma.publishedPost.deleteMany();
  await prisma.publishJob.deleteMany();
  await prisma.mediaAsset.deleteMany();
  await prisma.downloadJob.deleteMany();
  await prisma.sourcePost.deleteMany();
  await prisma.sourceAccount.deleteMany();
  await prisma.schedulerLock.deleteMany();
});

afterAll(async () => prisma.$disconnect());

describe("scheduler", () => {
  it("uses an exclusive lease and recovers it after expiry", async () => {
    const repository = new SchedulerRepository(prisma);
    const now = new Date("2026-01-01T00:00:00.000Z");
    const lease = await repository.acquire("pipeline", now, 60_000);
    expect(lease).not.toBeNull();
    expect(await repository.acquire("pipeline", now, 60_000)).toBeNull();
    expect(await repository.acquire("pipeline", new Date(now.getTime() + 60_001), 60_000)).not.toBeNull();
  });

  it("renews only the current lease owner", async () => {
    const repository = new SchedulerRepository(prisma);
    const now = new Date("2026-01-01T00:00:00.000Z");
    const lease = await repository.acquire("renewable", now, 60_000);
    expect(await repository.renew(lease!, new Date(now.getTime() + 30_000), 60_000)).toBe(true);
    expect(await repository.renew({ name: "renewable", ownerId: "stale-owner" }, new Date(now.getTime() + 31_000), 60_000)).toBe(false);
    expect(await repository.acquire("renewable", new Date(now.getTime() + 61_000), 60_000)).toBeNull();
  });

  it("prevents concurrent access to one X browser profile", async () => {
    const repository = new SchedulerRepository(prisma);
    const held = await repository.acquire("x-collector-profile", new Date(), 60_000);
    expect(held).not.toBeNull();
    const exclusive = new DatabaseExclusiveLease(repository, "x-collector-profile", 60_000);
    await expect(exclusive.run(async () => "unreachable")).rejects.toThrow("already in use");
    await repository.release(held!);
    await expect(exclusive.run(async () => "available")).resolves.toBe("available");
  });

  it("allows collector and publisher profiles to operate independently", async () => {
    const repository = new SchedulerRepository(prisma);
    const collector = await repository.acquire("x-collector-profile", new Date(), 60_000);
    expect(collector).not.toBeNull();
    const publisher = new DatabaseExclusiveLease(repository, "x-publisher-profile", 60_000);
    await expect(publisher.run(async () => "publisher available")).resolves.toBe("publisher available");
    await repository.release(collector!);
  });

  it("creates review items in downloaded order without duplicates", async () => {
    await downloadedPost("60001");
    await downloadedPost("60002");
    const repository = new SchedulerRepository(prisma);
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(await repository.scheduleDownloadedAssets(now, 60)).toBe(2);
    expect(await repository.scheduleDownloadedAssets(now, 60)).toBe(0);
    const jobs = await prisma.publishJob.findMany({ orderBy: { scheduledFor: "asc" } });
    expect(jobs.map((job) => ({ status: job.status, scheduledFor: job.scheduledFor }))).toEqual([
      { status: "READY_FOR_REVIEW", scheduledFor: null },
      { status: "READY_FOR_REVIEW", scheduledFor: null },
    ]);
  });

  it("sends only the selected downloaded asset to review", async () => {
    await downloadedPost("60011");
    await downloadedPost("60012");
    const first = await prisma.sourcePost.findUniqueOrThrow({ where: { platformPostId: "60011" } });
    const repository = new SchedulerRepository(prisma);
    expect(await repository.scheduleDownloadedAsset(first.id, (source) => `${source.text}\n\nfrom @${source.sourceAccount.username}`)).toBe(true);
    expect(await prisma.publishJob.count()).toBe(1);
    expect(await prisma.publishJob.findFirstOrThrow()).toMatchObject({ sourcePostId: first.id, status: "READY_FOR_REVIEW", caption: "caption 60011\n\nfrom @scheduler_60011" });
    expect(await prisma.sourcePost.findUniqueOrThrow({ where: { platformPostId: "60012" } })).toMatchObject({ status: "DOWNLOADED" });
  });

  it("does not claim future scheduled jobs or retry jobs before their persisted due time", async () => {
    await downloadedPost("60003");
    const repository = new SchedulerRepository(prisma);
    const now = new Date("2026-01-01T00:00:00.000Z");
    await repository.scheduleDownloadedAssets(new Date(now.getTime() + 60 * 60_000), 60);
    const publish = new PublishRepository(prisma);
    expect(await publish.claimNext(now, new Date(0))).toBeNull();
    const job = await prisma.publishJob.findFirstOrThrow();
    await prisma.publishJob.update({ where: { id: job.id }, data: { status: "RETRY_WAIT", scheduledFor: now, nextAttemptAt: new Date(now.getTime() + 60_000) } });
    expect(await publish.claimNext(now, new Date(0))).toBeNull();
  });

  it("skips overlapping cycles and releases the durable lease after a completed cycle", async () => {
    const repository = new SchedulerRepository(prisma);
    const steps = { collect: async () => undefined, download: async () => 0, publish: async () => false };
    const first = new PipelineService(repository, steps, pino({ level: "silent" }), 60, 60_000);
    const result = await first.runOnce(new Date("2026-01-01T00:00:00.000Z"));
    expect(result).toMatchObject({ acquired: true, downloadsProcessed: 0, publishJobsScheduled: 0, published: false });
    const second = new PipelineService(repository, steps, pino({ level: "silent" }), 60, 60_000);
    expect((await second.runOnce(new Date("2026-01-01T00:00:01.000Z"))).acquired).toBe(true);
  });
});
