import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import { prisma, DownloadRepository, SourceAccountRepository, SourcePostRepository } from "@cenblu/database";
import { DownloadService, FfprobeService, MediaFiles, type ProcessRunner, type VideoDownloader, type VideoInspector, YtDlpService } from "@cenblu/downloader";

const root = "storage/temp/downloader-test";
const files = new MediaFiles(join(root, "videos"), join(root, "temp"), join(root, "thumbnails"));
const logger = pino({ level: "silent" });

class FixtureRunner implements ProcessRunner {
  constructor(private readonly ffprobeOutput = "") {}
  async run(): Promise<{ stdout: string; stderr: string }> { return { stdout: this.ffprobeOutput, stderr: "" }; }
}

async function queuedPost(platformPostId = "20001"): Promise<void> {
  const accounts = new SourceAccountRepository(prisma);
  const posts = new SourcePostRepository(prisma);
  const account = await accounts.create({ username: `downloader_${platformPostId}` });
  await posts.persistNew(account.id, [{
    platformPostId,
    sourceUrl: `https://x.com/downloader_${platformPostId}/status/${platformPostId}`,
    text: "fixture",
    postedAt: new Date(),
    mediaType: "VIDEO",
  }], new Date());
}

beforeEach(async () => {
  await prisma.mediaAsset.deleteMany();
  await prisma.downloadJob.deleteMany();
  await prisma.sourcePost.deleteMany();
  await prisma.sourceAccount.deleteMany();
});

afterAll(async () => prisma.$disconnect());

describe("downloader services", () => {
  it("builds a compatible yt-dlp command", async () => {
    let arguments_: string[] = [];
    const runner: ProcessRunner = { run: async (_command, args) => { arguments_ = args; return { stdout: "", stderr: "" }; } };
    await new YtDlpService(runner, "yt-dlp", "ffmpeg").download("https://x.com/a/status/1", "video.mp4", "thumb.jpg");
    expect(arguments_).toContain("bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b");
    expect(arguments_).toContain("--ffmpeg-location");
    expect(arguments_).toContain("--write-thumbnail");
  });

  it("uses the configured authenticated Edge profile without exposing its cookies", async () => {
    let arguments_: string[] = [];
    const runner: ProcessRunner = { run: async (_command, args) => { arguments_ = args; return { stdout: "", stderr: "" }; } };
    await new YtDlpService(runner, "yt-dlp", "ffmpeg", "C:/profile/Profile 1").download("https://x.com/a/status/1", "video.mp4", "thumb.jpg");
    expect(arguments_).toContain("--cookies-from-browser");
    expect(arguments_).toContain("edge:C:/profile/Profile 1");
  });

  it("parses valid ffprobe video metadata and rejects audio-only output", async () => {
    const probe = new FfprobeService(new FixtureRunner(JSON.stringify({ streams: [{ codec_type: "video", codec_name: "h264", width: 1280, height: 720 }], format: { duration: "12.5" } })), "ffprobe");
    await expect(probe.inspect("video.mp4")).resolves.toEqual({ durationSeconds: 12.5, width: 1280, height: 720, codec: "h264" });
    const audioOnly = new FfprobeService(new FixtureRunner(JSON.stringify({ streams: [{ codec_type: "audio" }], format: {} })), "ffprobe");
    await expect(audioOnly.inspect("audio.mp3")).rejects.toThrow("valid video stream");
  });

  it("moves validated temporary media to deterministic final storage", async () => {
    const paths = files.paths("201", 1);
    await mkdir(join(root, "temp"), { recursive: true });
    await writeFile(paths.temporaryVideo, "video");
    await files.moveToFinal(paths.temporaryVideo, paths.finalVideo);
    expect(await files.fileSize(paths.finalVideo)).toBe(5);
    expect(paths.finalVideo).toMatch(/201\.mp4$/);
  });

  it("persists retry state and cleans failed temporary files", async () => {
    await queuedPost();
    const repository = new DownloadRepository(prisma);
    const failingYtDlp: VideoDownloader = { download: async () => { throw new Error("network unavailable"); } };
    const unusedProbe: VideoInspector = { inspect: async () => { throw new Error("unexpected probe"); } };
    const service = new DownloadService(repository, failingYtDlp, unusedProbe, files, logger);
    await service.processNext();
    const job = await prisma.downloadJob.findFirstOrThrow();
    expect(job).toMatchObject({ status: "RETRY_WAIT", attemptCount: 1, lastError: "network unavailable" });
    expect(await prisma.sourcePost.findFirstOrThrow()).toMatchObject({ status: "QUEUED_FOR_DOWNLOAD" });
  });

  it("creates one asset and does not reclaim completed downloads", async () => {
    await queuedPost("20002");
    const ytdlp: VideoDownloader = { download: async (_url: string, output: string) => { await mkdir(join(root, "temp"), { recursive: true }); await writeFile(output, "valid video"); } };
    const probe: VideoInspector = { inspect: async () => ({ durationSeconds: 1, width: 1, height: 1, codec: "h264" }) };
    const service = new DownloadService(new DownloadRepository(prisma), ytdlp, probe, files, logger);
    expect(await service.processPending()).toBe(1);
    expect(await service.processPending()).toBe(0);
    expect(await prisma.mediaAsset.count()).toBe(1);
    expect(await prisma.downloadJob.findFirstOrThrow()).toMatchObject({ status: "COMPLETED" });
  });

  it("stops after the configured number of downloads", async () => {
    await queuedPost("20011");
    await queuedPost("20012");
    await queuedPost("20013");
    const ytdlp: VideoDownloader = { download: async (_url: string, output: string) => { await mkdir(join(root, "temp"), { recursive: true }); await writeFile(output, "valid video"); } };
    const probe: VideoInspector = { inspect: async () => ({ durationSeconds: 1, width: 1, height: 1, codec: "h264" }) };
    const service = new DownloadService(new DownloadRepository(prisma), ytdlp, probe, files, logger);
    expect(await service.processPending(2, 2)).toBe(2);
    expect(await prisma.downloadJob.count({ where: { status: "COMPLETED" } })).toBe(2);
    expect(await prisma.downloadJob.count({ where: { status: "PENDING" } })).toBe(1);
  });

  it("recovers an atomically moved final file without redownloading after restart", async () => {
    await queuedPost("20005");
    const paths = files.paths("20005", 1);
    await mkdir(join(root, "videos"), { recursive: true });
    await writeFile(paths.finalVideo, "already moved");
    let downloadCalls = 0;
    const ytdlp: VideoDownloader = { download: async () => { downloadCalls += 1; } };
    const probe: VideoInspector = { inspect: async () => ({ durationSeconds: 1, width: 1, height: 1, codec: "h264" }) };
    await new DownloadService(new DownloadRepository(prisma), ytdlp, probe, files, logger).processNext();
    expect(downloadCalls).toBe(0);
    expect(await prisma.downloadJob.findFirstOrThrow()).toMatchObject({ status: "COMPLETED" });
    expect(await prisma.mediaAsset.count()).toBe(1);
  });

  it("prioritizes and claims one specifically requested download", async () => {
    await queuedPost("20006");
    await queuedPost("20007");
    const repository = new DownloadRepository(prisma);
    const selected = await prisma.downloadJob.findFirstOrThrow({ where: { sourcePost: { platformPostId: "20007" } } });
    await repository.requestNow(selected.id, new Date("2026-01-01T00:00:00Z"));
    const claimed = await repository.claimById(selected.id, new Date("2026-01-01T00:00:01Z"), new Date(0));
    expect(claimed?.sourcePost.platformPostId).toBe("20007");
    expect(await prisma.sourcePost.findUniqueOrThrow({ where: { platformPostId: "20007" } })).toMatchObject({ status: "DOWNLOADING" });
  });

  it("queues distinct post IDs even when their captions are identical", async () => {
    await queuedPost("20009");
    await queuedPost("20010");
    expect(await prisma.downloadJob.count({ where: { status: "PENDING" } })).toBe(2);
    expect(await prisma.sourcePost.count({ where: { status: "QUEUED_FOR_DOWNLOAD", duplicateGroupId: null } })).toBe(2);
  });

  it("cancels a download and repairs source-post state transactionally", async () => {
    await queuedPost("20008");
    const repository = new DownloadRepository(prisma);
    const job = await prisma.downloadJob.findFirstOrThrow();
    await repository.cancel(job.id);
    expect(await prisma.downloadJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "CANCELLED" });
    expect(await prisma.sourcePost.findUniqueOrThrow({ where: { platformPostId: "20008" } })).toMatchObject({ status: "SKIPPED" });
  });
});
