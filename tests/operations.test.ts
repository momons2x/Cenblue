import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, SourceAccountRepository, SourcePostRepository } from "@cenblu/database";
import { MediaRemovalService, PortableConfigService, SourcePurgeService } from "@cenblu/operations";

const root = resolve("storage/temp/source-purge-test");
const videos = resolve(root, "videos");
const thumbnails = resolve(root, "thumbnails");
const temporary = resolve(root, "temporary");

beforeEach(async () => {
  await prisma.appSetting.deleteMany();
  await prisma.publishedPost.deleteMany();
  await prisma.publishJob.deleteMany();
  await prisma.mediaAsset.deleteMany();
  await prisma.downloadJob.deleteMany();
  await prisma.sourcePost.deleteMany();
  await prisma.sourceAccount.deleteMany();
});

describe("portable preferences", () => {
  it("exports and imports only portable settings and managed source rules", async () => {
    await prisma.appSetting.createMany({ data: [
      { key: "CAPTION_TEMPLATES", value: "{sourceCaption}\n\nShared" },
      { key: "PUBLISHER_BROWSER_SESSION_VERIFIED_AT", value: new Date().toISOString() },
      { key: "DEVICE_PUBLISHER_BROWSER_EXECUTABLE", value: "C:/private/browser.exe" },
      { key: "VIDEO_STORAGE_PATH", value: "C:/private/videos" },
    ] });
    await new SourceAccountRepository(prisma).create({ username: "portable", collectLimit: 9, captionTemplate: "Caption", hashtagRules: "#tag" });
    const service = new PortableConfigService(prisma);
    const exported = await service.export();
    expect(exported.settings).toEqual({ CAPTION_TEMPLATES: "{sourceCaption}\n\nShared" });
    expect(exported.sources[0]).toMatchObject({ username: "portable", collectLimit: 9, captionTemplate: "Caption", hashtagRules: "#tag" });

    await prisma.appSetting.deleteMany();
    await prisma.sourceAccount.deleteMany();
    await prisma.appSetting.createMany({ data: [
      { key: "COLLECTOR_BROWSER_SESSION_VERIFIED_AT", value: new Date().toISOString() },
      { key: "COLLECTOR_BROWSER_SESSION_BINDING", value: "private-device-binding" },
    ] });
    expect(await service.import(exported)).toEqual({ settings: 1, sources: 1 });
    expect(await prisma.appSetting.findUnique({ where: { key: "COLLECTOR_BROWSER_SESSION_VERIFIED_AT" } })).toBeNull();
    expect(await prisma.appSetting.findUnique({ where: { key: "COLLECTOR_BROWSER_SESSION_BINDING" } })).toBeNull();
    expect(await prisma.sourceAccount.findUniqueOrThrow({ where: { username: "portable" } })).toMatchObject({ managedSource: true, enabled: true, collectLimit: 9 });
  });

  it("rejects machine paths and unknown fields in imported manifests", async () => {
    const service = new PortableConfigService(prisma);
    await expect(service.import({ version: 1, exportedAt: new Date().toISOString(), settings: { VIDEO_STORAGE_PATH: "C:/videos" }, sources: [] })).rejects.toThrow();
  });
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await prisma.$disconnect();
});

describe("source purge", () => {
  it("removes cascaded records and staged local media after typed confirmation", async () => {
    const source = await new SourceAccountRepository(prisma).create({ username: "purge_me" });
    await new SourcePostRepository(prisma).persistNew(source.id, [{ platformPostId: "81001", sourceUrl: "https://x.com/purge_me/status/81001", text: "purge", postedAt: new Date(), mediaType: "VIDEO" }], new Date());
    const post = await prisma.sourcePost.findUniqueOrThrow({ where: { platformPostId: "81001" } });
    const videoPath = resolve(videos, "81001.mp4");
    await mkdir(videos, { recursive: true });
    await writeFile(videoPath, "video");
    await prisma.mediaAsset.create({ data: { sourcePostId: post.id, filePath: videoPath, mimeType: "video/mp4", fileSize: 5, durationSeconds: 1, width: 1, height: 1, checksum: "checksum" } });
    const result = await new SourcePurgeService(prisma).purge(source.id, "purge_me", { videos, thumbnails, temporary });
    expect(result).toEqual({ posts: 1, assets: 1, filesRemoved: 1 });
    expect(await prisma.sourceAccount.count()).toBe(0);
    await expect(stat(videoPath)).rejects.toThrow();
  });

  it("blocks purge while a related job is running", async () => {
    const source = await new SourceAccountRepository(prisma).create({ username: "active_source" });
    await new SourcePostRepository(prisma).persistNew(source.id, [{ platformPostId: "81002", sourceUrl: "https://x.com/active_source/status/81002", text: "active", postedAt: new Date(), mediaType: "VIDEO" }], new Date());
    await prisma.downloadJob.updateMany({ data: { status: "RUNNING", startedAt: new Date() } });
    await expect(new SourcePurgeService(prisma).purge(source.id, "active_source", { videos, thumbnails, temporary })).rejects.toThrow("jobs are running");
    expect(await prisma.sourceAccount.count()).toBe(1);
  });
});

describe("published media removal", () => {
  it("deletes local files while preserving the published record", async () => {
    const source = await new SourceAccountRepository(prisma).create({ username: "published_media" });
    await new SourcePostRepository(prisma).persistNew(source.id, [{ platformPostId: "82001", sourceUrl: "https://x.com/published_media/status/82001", text: "published", postedAt: new Date(), mediaType: "VIDEO" }], new Date());
    const post = await prisma.sourcePost.findUniqueOrThrow({ where: { platformPostId: "82001" } });
    const videoPath = resolve(videos, "82001.mp4");
    const thumbnailPath = resolve(thumbnails, "82001.jpg");
    await mkdir(videos, { recursive: true });
    await mkdir(thumbnails, { recursive: true });
    await writeFile(videoPath, "video");
    await writeFile(thumbnailPath, "image");
    const asset = await prisma.mediaAsset.create({ data: { sourcePostId: post.id, filePath: videoPath, thumbnailPath, mimeType: "video/mp4", fileSize: 5, durationSeconds: 1, width: 1, height: 1, checksum: "checksum" } });
    const job = await prisma.publishJob.create({ data: { sourcePostId: post.id, mediaAssetId: asset.id, caption: "published", status: "COMPLETED", publishedAt: new Date() } });
    await prisma.publishedPost.create({ data: { publishJobId: job.id, platformPostId: "published-82001", platformUrl: "https://x.com/me/status/published-82001", publishedAt: new Date() } });
    await prisma.sourcePost.update({ where: { id: post.id }, data: { status: "PUBLISHED" } });

    await new MediaRemovalService(prisma).removePublished(post.id, { videos, thumbnails });

    await expect(stat(videoPath)).rejects.toThrow();
    await expect(stat(thumbnailPath)).rejects.toThrow();
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).localRemovedAt).not.toBeNull();
    expect(await prisma.publishedPost.count({ where: { publishJobId: job.id } })).toBe(1);
    expect((await prisma.publishJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("COMPLETED");
    await expect(new MediaRemovalService(prisma).removePublished(post.id, { videos, thumbnails })).rejects.toThrow("already been removed");
  });

  it("deletes rejected local media and keeps the source post tracked", async () => {
    const source = await new SourceAccountRepository(prisma).create({ username: "rejected_media" });
    await new SourcePostRepository(prisma).persistNew(source.id, [{ platformPostId: "82003", sourceUrl: "https://x.com/rejected_media/status/82003", text: "rejected", postedAt: new Date(), mediaType: "VIDEO" }], new Date());
    const post = await prisma.sourcePost.findUniqueOrThrow({ where: { platformPostId: "82003" } });
    const videoPath = resolve(videos, "82003.mp4");
    const thumbnailPath = resolve(thumbnails, "82003.jpg");
    await mkdir(videos, { recursive: true });
    await mkdir(thumbnails, { recursive: true });
    await writeFile(videoPath, "video");
    await writeFile(thumbnailPath, "image");
    const asset = await prisma.mediaAsset.create({ data: { sourcePostId: post.id, filePath: videoPath, thumbnailPath, mimeType: "video/mp4", fileSize: 5, durationSeconds: 1, width: 1, height: 1, checksum: "rejected-checksum" } });
    await prisma.publishJob.create({ data: { sourcePostId: post.id, mediaAssetId: asset.id, caption: "rejected", status: "REJECTED" } });
    await prisma.sourcePost.update({ where: { id: post.id }, data: { status: "SKIPPED" } });

    await new MediaRemovalService(prisma).remove(post.id, { videos, thumbnails });

    await expect(stat(videoPath)).rejects.toThrow();
    await expect(stat(thumbnailPath)).rejects.toThrow();
    expect(await prisma.mediaAsset.count({ where: { id: asset.id } })).toBe(0);
    expect(await prisma.publishJob.count({ where: { sourcePostId: post.id } })).toBe(0);
    expect((await prisma.sourcePost.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("SKIPPED");
  });

  it("refuses removal while related work is running", async () => {
    const source = await new SourceAccountRepository(prisma).create({ username: "running_media" });
    await new SourcePostRepository(prisma).persistNew(source.id, [{ platformPostId: "82004", sourceUrl: "https://x.com/running_media/status/82004", text: "running", postedAt: new Date(), mediaType: "VIDEO" }], new Date());
    const post = await prisma.sourcePost.findUniqueOrThrow({ where: { platformPostId: "82004" } });
    const videoPath = resolve(videos, "82004.mp4");
    await mkdir(videos, { recursive: true });
    await writeFile(videoPath, "video");
    await prisma.mediaAsset.create({ data: { sourcePostId: post.id, filePath: videoPath, mimeType: "video/mp4", fileSize: 5, durationSeconds: 1, width: 1, height: 1, checksum: "running-checksum" } });
    await prisma.downloadJob.update({ where: { sourcePostId: post.id }, data: { status: "RUNNING" } });

    await expect(new MediaRemovalService(prisma).remove(post.id, { videos, thumbnails })).rejects.toThrow("work is running");
    expect((await stat(videoPath)).isFile()).toBe(true);
  });

  it("refuses cleanup when publication is not confirmed", async () => {
    const source = await new SourceAccountRepository(prisma).create({ username: "not_published" });
    await new SourcePostRepository(prisma).persistNew(source.id, [{ platformPostId: "82002", sourceUrl: "https://x.com/not_published/status/82002", text: "pending", postedAt: new Date(), mediaType: "VIDEO" }], new Date());
    const post = await prisma.sourcePost.findUniqueOrThrow({ where: { platformPostId: "82002" } });
    const videoPath = resolve(videos, "82002.mp4");
    await mkdir(videos, { recursive: true });
    await writeFile(videoPath, "video");
    await prisma.mediaAsset.create({ data: { sourcePostId: post.id, filePath: videoPath, mimeType: "video/mp4", fileSize: 5, durationSeconds: 1, width: 1, height: 1, checksum: "checksum" } });

    await expect(new MediaRemovalService(prisma).removePublished(post.id, { videos, thumbnails })).rejects.toThrow("Only a confirmed published post");
    expect((await stat(videoPath)).isFile()).toBe(true);
  });
});
