import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pino from "pino";
import { prisma, DownloadRepository, SourceAccountRepository, SourcePostRepository } from "@cenblu/database";
import { DownloadService, MediaFiles, type VideoDownloader, type VideoInspector } from "@cenblu/downloader";

const root = "storage/temp/downloader-smoke-files";
const client = prisma;

try {
  await client.mediaAsset.deleteMany();
  await client.downloadJob.deleteMany();
  await client.sourcePost.deleteMany();
  await client.sourceAccount.deleteMany();
  const account = await new SourceAccountRepository(client).create({ username: "downloader_smoke" });
  await new SourcePostRepository(client).persistNew(account.id, [{ platformPostId: "30001", sourceUrl: "https://x.com/downloader_smoke/status/30001", text: "smoke", postedAt: new Date(), mediaType: "VIDEO" }], new Date());
  const ytdlp: VideoDownloader = { download: async (_url: string, output: string) => { await mkdir(join(root, "temp"), { recursive: true }); await writeFile(output, "smoke video"); } };
  const probe: VideoInspector = { inspect: async () => ({ durationSeconds: 1, width: 16, height: 9, codec: "h264" }) };
  const service = new DownloadService(new DownloadRepository(client), ytdlp, probe, new MediaFiles(join(root, "videos"), join(root, "temp"), join(root, "thumbnails")), pino({ level: "silent" }));
  if (await service.processPending() !== 1 || await service.processPending() !== 0 || await client.mediaAsset.count() !== 1) throw new Error("Downloader smoke test failed");
  console.log("Downloader smoke test passed: one asset validated, persisted, and not redownloaded.");
} finally { await client.$disconnect(); }
