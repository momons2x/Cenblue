"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { access, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, relative, resolve } from "node:path";
import { z } from "zod";
import { CollectionService, PlaywrightTimelineBrowser, XPlaywrightCollector } from "@cenblu/collector";
import { applyStoredSettings, loadConfig } from "@cenblu/config";
import { CollectionRunRepository, DatabaseExclusiveLease, prisma, PublishRepository, RuntimeStatusRepository, SchedulerRepository, SettingsRepository, SourceAccountRepository, SourcePostRepository } from "@cenblu/database";
import { DownloadRepository } from "@cenblu/database";
import { DownloadService, FfmpegPerceptualVideoHasher, FfmpegVideoCompressor, FfprobeService, MediaFiles, NodeProcessRunner, verifyDownloadBinaries, YtDlpService } from "@cenblu/downloader";
import { FullResetService, MediaRemovalService, SourcePurgeService } from "@cenblu/operations";
import { LocalPublishMediaVerifier, PublishService, resolveCaption, validateCaption, XPlaywrightPublisher } from "@cenblu/publisher";
import { ResourceBusyError } from "@cenblu/shared/lease";
import pino from "pino";

const username = z.string().trim().regex(/^[A-Za-z0-9_]{1,15}$/);
const id = z.string().min(1);
const limit = z.coerce.number().int().min(1).max(100);
const manualImageTypes = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" } as const;

function refresh(...paths: string[]) { paths.forEach((path) => revalidatePath(path)); }

function inside(root: string, path: string): boolean {
  const value = relative(resolve(root), resolve(path));
  return value !== "" && !value.startsWith("..") && !value.includes(":");
}

function validImageSignature(type: keyof typeof manualImageTypes, bytes: Uint8Array): boolean {
  if (type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") return bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
  const header = new TextDecoder().decode(bytes.slice(0, 12));
  if (type === "image/gif") return header.startsWith("GIF87a") || header.startsWith("GIF89a");
  return header.startsWith("RIFF") && header.slice(8, 12) === "WEBP";
}

export async function addSource(formData: FormData) {
  const parsed = username.safeParse(formData.get("username"));
  if (!parsed.success) throw new Error("Enter a valid X username without @.");
  const config = applyStoredSettings(loadConfig(), await new SettingsRepository(prisma).getAll());
  await new SourceAccountRepository(prisma, config.sourceAccountLimit).create({ username: parsed.data, collectLimit: limit.parse(formData.get("collectLimit") ?? 5) });
  refresh("/", "/sources");
}

export async function toggleSource(formData: FormData) {
  const sourceId = id.parse(formData.get("sourceId"));
  const source = await prisma.sourceAccount.findUniqueOrThrow({ where: { id: sourceId } });
  const config = applyStoredSettings(loadConfig(), await new SettingsRepository(prisma).getAll());
  await new SourceAccountRepository(prisma, config.sourceAccountLimit).update(sourceId, { enabled: !source.enabled });
  refresh("/", "/sources");
}

export async function updateSourceLimit(formData: FormData) {
  await new SourceAccountRepository(prisma).update(id.parse(formData.get("sourceId")), { collectLimit: limit.parse(formData.get("collectLimit")) });
  refresh("/sources");
}

export async function updateSourceCaptionSettings(formData: FormData) {
  await new SourceAccountRepository(prisma).update(id.parse(formData.get("sourceId")), {
    captionTemplate: z.string().max(2_000).parse(formData.get("captionTemplate") ?? "") || null,
    attributionTemplate: z.string().max(1_000).parse(formData.get("attributionTemplate") ?? "") || null,
    hashtagRules: z.string().max(1_000).parse(formData.get("hashtagRules") ?? "") || null,
  });
  refresh("/sources", "/review");
}

export async function archiveSource(formData: FormData) {
  await new SourceAccountRepository(prisma).archive(id.parse(formData.get("sourceId")));
  refresh("/", "/sources");
}

export async function restoreSource(formData: FormData) {
  await new SourceAccountRepository(prisma).restore(id.parse(formData.get("sourceId")));
  refresh("/", "/sources");
}

export async function purgeSource(formData: FormData) {
  const config = applyStoredSettings(loadConfig(), await new SettingsRepository(prisma).getAll());
  await new SourcePurgeService(prisma).purge(
    id.parse(formData.get("sourceId")),
    username.parse(formData.get("confirmedUsername")),
    { videos: config.videoStoragePath, thumbnails: config.thumbnailStoragePath, temporary: config.tempStoragePath },
  );
  refresh("/", "/sources", "/queue", "/downloads", "/published");
}

export async function resetAllData(formData: FormData) {
  if (z.string().parse(formData.get("confirmation")).trim() !== "RESET ALL") throw new Error('Type "RESET ALL" to confirm the full reset.');
  const config = applyStoredSettings(loadConfig(), await new SettingsRepository(prisma).getAll());
  await new FullResetService(prisma).reset({ logs: config.logStoragePath, thumbnails: config.thumbnailStoragePath, temporary: config.tempStoragePath, backups: config.backupStoragePath, recovery: resolve(config.backupStoragePath, "..", "reset-recovery") });
  refresh("/", "/sources", "/queue", "/downloads", "/review", "/published", "/logs", "/settings");
}

async function collectSources(sourceIds?: string[]): Promise<{ busy: boolean }> {
  const config = applyStoredSettings(loadConfig(), await new SettingsRepository(prisma).getAll());
  const logger = pino({ level: "silent" });
  const sourceRepository = new SourceAccountRepository(prisma, config.sourceAccountLimit);
  const enabled = await sourceRepository.listEnabled(config.sourceAccountLimit);
  const sources = sourceIds ? enabled.filter((source) => sourceIds.includes(source.id)) : enabled;
  if (sources.length === 0) throw new Error("No enabled sources are available to collect.");
  const runs = new CollectionRunRepository(prisma);
  await runs.recoverStale(new Date(Date.now() - Math.max(config.workerLockTimeoutMinutes, 10) * 60_000));
  const run = await runs.start(sources.map((source) => ({ id: source.id, targetNew: Math.min(source.collectLimit, config.postsPerSource) })));
  const runtime = new RuntimeStatusRepository(prisma);
  await runtime.update("dashboard-collector", "RUNNING", "collection");
  const browserLease = new DatabaseExclusiveLease(new SchedulerRepository(prisma), "x-collector-profile", Math.max(config.workerLockTimeoutMinutes, 10) * 60_000);
  const scopedAccounts = {
    listEnabled: async () => sources,
    recordCollectionSuccess: sourceRepository.recordCollectionSuccess.bind(sourceRepository),
    recordCollectionFailure: sourceRepository.recordCollectionFailure.bind(sourceRepository),
  };
  const service = new CollectionService(scopedAccounts, new SourcePostRepository(prisma), new XPlaywrightCollector(new PlaywrightTimelineBrowser({ headless: config.playwrightHeadless, browserChannel: config.playwrightBrowserChannel, repositoryRoot: config.repositoryRoot, profileDirectory: config.playwrightProfilePath, browserProfileDirectory: config.playwrightProfileDirectory, allowExternalProfile: config.playwrightAllowExternalProfile, lease: browserLease, diagnosticsDirectory: config.logStoragePath, maxScrolls: config.collectorMaxScrolls, idleScrolls: config.collectorIdleScrolls, scrollDelayMs: config.collectorScrollDelayMs, maxSourceDurationMs: config.collectorMaxSourceSeconds * 1_000 }, logger)), logger, sources.length, config.postsPerSource, {
    
    sourceStarting: (source) => runs.startSource(run.id, source.id, source.username),
    sourceProgress: (sourceId, progress) => runs.progressSource(run.id, sourceId, progress),
    sourceFinished: (source) => runs.finishSource(run.id, source.id, source),
    shouldCancel: () => runs.shouldCancel(run.id),
  });
  try {
    const result = await service.runOnce();
    await runs.finish(run.id, result.cancelled ? "CANCELLED" : result.sourcesFailed > 0 ? "FAILED" : "COMPLETED");
    await runtime.update("dashboard-collector", result.cancelled ? "CANCELLED" : result.sourcesFailed > 0 ? "FAILED" : "IDLE");
  } catch (error) {
    if (error instanceof ResourceBusyError) {
      await runs.finish(run.id, "BUSY", "The collector X browser profile is busy. Wait for the current operation to finish.");
      if (sources.length === 1) await sourceRepository.recordCollectionFailure(sources[0].id, new Date(), "Browser is busy with another collection or publish operation.");
      await runtime.update("dashboard-collector", "BUSY", undefined, "X browser profile is busy");
      return { busy: true };
    }
    await runs.finish(run.id, "FAILED", error instanceof Error ? error.message : String(error));
    await runtime.update("dashboard-collector", "FAILED", undefined, error instanceof Error ? error.message : String(error));
    throw error;
  }
  return { busy: false };
}

export async function collectSource(formData: FormData) {
  await collectSources([id.parse(formData.get("sourceId"))]);
  refresh("/", "/sources", "/queue");
}

export async function collectAllSources() {
  await collectSources();
  refresh("/", "/sources", "/queue");
}

export async function collectSelectedSources(formData: FormData) {
  const sourceIds = z.array(id).min(1, "Select at least one enabled source.").parse(formData.getAll("sourceId"));
  await collectSources(sourceIds);
  refresh("/", "/sources", "/queue");
}

export async function collectBookmarks(formData: FormData) {
  const query = new URLSearchParams();
  try {
    const target = limit.parse(formData.get("bookmarkLimit") ?? 5);
    const config = applyStoredSettings(loadConfig(), await new SettingsRepository(prisma).getAll());
    const logger = pino({ level: "silent" });
    const repository = new SourcePostRepository(prisma);
    const browserLease = new DatabaseExclusiveLease(new SchedulerRepository(prisma), "x-collector-profile", Math.max(config.workerLockTimeoutMinutes, 10) * 60_000);
    const collector = new XPlaywrightCollector(new PlaywrightTimelineBrowser({
      headless: config.playwrightHeadless,
      browserChannel: config.playwrightBrowserChannel,
      repositoryRoot: config.repositoryRoot,
      profileDirectory: config.playwrightProfilePath,
      browserProfileDirectory: config.playwrightProfileDirectory,
      allowExternalProfile: config.playwrightAllowExternalProfile,
      lease: browserLease,
      diagnosticsDirectory: config.logStoragePath,
      maxScrolls: config.collectorMaxScrolls,
      idleScrolls: config.collectorIdleScrolls,
      scrollDelayMs: config.collectorScrollDelayMs,
      maxSourceDurationMs: config.collectorMaxSourceSeconds * 1_000,
    }, logger));
    const knownPostIds = await repository.listAllPlatformPostIds();
    const posts = await collector.withSession(() => collector.collectBookmarks(target, { knownPostIds }));
    const result = await repository.persistBookmarks(posts, new Date());
    query.set("bookmarkInserted", String(result.inserted));
    query.set("bookmarkDuplicates", String(result.duplicates));
    refresh("/", "/sources", "/queue", "/downloads");
  } catch (error) {
    const message = error instanceof ResourceBusyError ? "The collector browser is busy. Wait for collection to finish." : error instanceof Error ? error.message : "Bookmark collection failed.";
    query.set("bookmarkError", message);
  }
  redirect(`/sources?${query}`);
}

export async function cancelCollection(formData: FormData) {
  await new CollectionRunRepository(prisma).requestCancel(id.parse(formData.get("runId")));
  refresh("/sources", "/");
}

export async function schedulePublish(formData: FormData) {
  const publishJobId = id.parse(formData.get("publishJobId"));
  const scheduledFor = new Date(z.string().parse(formData.get("scheduledFor")));
  if (Number.isNaN(scheduledFor.getTime())) throw new Error("Enter a valid schedule time.");
  if (scheduledFor <= new Date()) throw new Error("Choose a future schedule time.");
  await new PublishRepository(prisma).reschedule(publishJobId, scheduledFor);
  refresh("/", "/queue");
}

export async function saveReview(formData: FormData) {
  const publishJobId = id.parse(formData.get("publishJobId"));
  const job = await prisma.publishJob.findUniqueOrThrow({ where: { id: publishJobId }, include: { sourcePost: true } });
  const caption = z.string().max(280).parse(formData.get("caption"));
  await prisma.$transaction([
    prisma.publishJob.update({ where: { id: publishJobId }, data: { caption } }),
    prisma.sourcePost.update({ where: { id: job.sourcePostId }, data: { reviewNotes: z.string().max(2_000).parse(formData.get("reviewNotes") ?? ""), internalTags: z.string().max(500).parse(formData.get("internalTags") ?? "") } }),
  ]);
  refresh("/review");
}

export async function compressReviewVideo(formData: FormData) {
  const publishJobId = id.parse(formData.get("publishJobId"));
  const config = applyStoredSettings(loadConfig(), await new SettingsRepository(prisma).getAll());
  const job = await prisma.publishJob.findUniqueOrThrow({ where: { id: publishJobId }, include: { sourcePost: true, mediaAsset: true } });
  if (!["READY_FOR_REVIEW", "MANUAL_ATTENTION", "FAILED"].includes(job.status)) throw new Error("Only videos awaiting review can be compressed.");
  if (job.mediaAsset.localRemovedAt) throw new Error("The local video is unavailable.");
  if (!inside(config.videoStoragePath, job.mediaAsset.filePath)) throw new Error("Media path is outside configured video storage.");
  if (basename(job.mediaAsset.filePath).includes(".compressed-")) throw new Error("This review video has already been compressed.");

  const runner = new NodeProcessRunner();
  const token = randomUUID();
  const temporaryPath = resolve(config.tempStoragePath, `${job.sourcePost.platformPostId}.${token}.compress.part.mp4`);
  const finalPath = resolve(config.videoStoragePath, `${job.sourcePost.platformPostId}.compressed-${token}.mp4`);
  if (!inside(config.tempStoragePath, temporaryPath) || !inside(config.videoStoragePath, finalPath)) throw new Error("Invalid compression output path.");

  await Promise.all([mkdir(config.tempStoragePath, { recursive: true }), mkdir(config.videoStoragePath, { recursive: true })]);
  let moved = false;
  let databaseUpdated = false;
  let originalSize = 0;
  let compressedSize = 0;
  try {
    originalSize = (await stat(job.mediaAsset.filePath)).size;
    await new FfmpegVideoCompressor(runner, config.ffmpegBinary).compress(job.mediaAsset.filePath, temporaryPath);
    const files = new MediaFiles(config.videoStoragePath, config.tempStoragePath, config.thumbnailStoragePath);
    compressedSize = await files.fileSize(temporaryPath);
    if (compressedSize >= originalSize) {
      await rm(temporaryPath, { force: true });
      return redirect("/review?compression=not-smaller");
    }
    const probe = new FfprobeService(runner, config.ffprobeBinary);
    const metadata = await probe.inspect(temporaryPath);
    const checksum = await files.checksum(temporaryPath);
    const perceptualHash = await new FfmpegPerceptualVideoHasher(runner, config.ffmpegBinary).hash(temporaryPath);
    await rename(temporaryPath, finalPath);
    moved = true;
    const updated = await prisma.mediaAsset.updateMany({
      where: { id: job.mediaAsset.id, filePath: job.mediaAsset.filePath, localRemovedAt: null },
      data: { filePath: finalPath, fileSize: compressedSize, ...metadata, checksum, perceptualHash },
    });
    if (updated.count !== 1) throw new Error("The video changed while compression was running. Try again.");
    databaseUpdated = true;
    await rm(job.mediaAsset.filePath, { force: true }).catch(() => undefined);
  } catch (error) {
    if (!databaseUpdated) await rm(moved ? finalPath : temporaryPath, { force: true });
    throw error;
  }
  refresh("/review", "/downloads", "/videos", "/queue");
  redirect(`/review?compression=saved&before=${originalSize}&after=${compressedSize}`);
}

export async function approveReview(formData: FormData) {
  const publishJobId = id.parse(formData.get("publishJobId"));
  const rawSchedule = z.string().parse(formData.get("scheduledFor") ?? "").trim();
  const scheduledFor = rawSchedule ? new Date(rawSchedule) : null;
  if (scheduledFor && Number.isNaN(scheduledFor.getTime())) throw new Error("Enter a valid schedule time.");
  if (scheduledFor && scheduledFor <= new Date()) throw new Error("Choose a future schedule time.");
  const caption = z.string().max(280).parse(formData.get("caption"));
  await new PublishRepository(prisma).approve(publishJobId, scheduledFor, caption, { notes: z.string().max(2_000).parse(formData.get("reviewNotes") ?? ""), tags: z.string().max(500).parse(formData.get("internalTags") ?? "") });
  refresh("/review", "/queue", "/");
}

export async function resolveReviewCaption(formData: FormData) {
  const publishJobId = id.parse(formData.get("publishJobId"));
  const [job, settings] = await Promise.all([
    prisma.publishJob.findUniqueOrThrow({ where: { id: publishJobId }, include: { sourcePost: { include: { sourceAccount: true } } } }),
    new SettingsRepository(prisma).getAll(),
  ]);
  const config = applyStoredSettings(loadConfig(), settings);
  const caption = resolveCaption(job.sourcePost, config.captionTemplates);
  await prisma.publishJob.update({ where: { id: publishJobId }, data: { caption } });
  refresh("/review");
}

export async function rejectReview(formData: FormData) {
  const publishJobId = id.parse(formData.get("publishJobId"));
  await new PublishRepository(prisma).reject(publishJobId);
  refresh("/review", "/queue");
}

export async function bulkReview(formData: FormData) {
  const jobIds = z.array(id).min(1, "Select at least one review item.").parse(formData.getAll("publishJobId"));
  const decision = z.enum(["approve", "reject", "downloads"]).parse(formData.get("decision"));
  const repository = new PublishRepository(prisma);
  if (decision === "approve") {
    const scheduledFor = new Date(z.string().parse(formData.get("scheduledFor")));
    if (Number.isNaN(scheduledFor.getTime()) || scheduledFor <= new Date()) throw new Error("Choose a future schedule time.");
    for (const jobId of jobIds) await repository.approve(jobId, scheduledFor);
  } else if (decision === "reject") {
    for (const jobId of jobIds) await repository.reject(jobId);
  } else {
    for (const jobId of jobIds) await repository.returnToDownloads(jobId);
  }
  refresh("/review", "/queue", "/");
}


export async function restoreDuplicate(formData: FormData) {
  const sourcePostId = id.parse(formData.get("sourcePostId"));
  const post = await prisma.sourcePost.findUniqueOrThrow({ where: { id: sourcePostId }, include: { publishJob: true, mediaAsset: true } });
  await prisma.$transaction([
    prisma.sourcePost.update({ where: { id: sourcePostId }, data: { status: post.mediaAsset ? "READY_FOR_REVIEW" : "QUEUED_FOR_DOWNLOAD", duplicateReason: null } }),
    ...(post.publishJob ? [prisma.publishJob.update({ where: { id: post.publishJob.id }, data: { status: "READY_FOR_REVIEW" } })] : []),
    ...(!post.publishJob && post.mediaAsset ? [prisma.publishJob.create({ data: { sourcePostId, mediaAssetId: post.mediaAsset.id, caption: post.text, status: "READY_FOR_REVIEW" } })] : []),
  ]);
  refresh("/review", "/queue");
}

export async function retryJob(formData: FormData) {
  const jobId = id.parse(formData.get("jobId"));
  const jobType = z.enum(["download", "publish"]).parse(formData.get("jobType"));
  if (jobType === "download") await new DownloadRepository(prisma).requestNow(jobId);
  else await new PublishRepository(prisma).retry(jobId);
  refresh("/", "/queue", "/downloads");
}

export async function cancelJob(formData: FormData) {
  const jobId = id.parse(formData.get("jobId"));
  const jobType = z.enum(["download", "publish"]).parse(formData.get("jobType"));
  if (jobType === "download") await new DownloadRepository(prisma).cancel(jobId);
  else await new PublishRepository(prisma).cancel(jobId);
  refresh("/", "/queue", "/downloads");
}

export async function changeJobStatus(formData: FormData) {
  const jobId = id.parse(formData.get("jobId"));
  const jobType = z.enum(["download", "publish"]).parse(formData.get("jobType"));
  if (jobType === "download") {
    const status = z.enum(["PENDING", "CANCELLED"]).parse(formData.get("status"));
    const repository = new DownloadRepository(prisma);
    if (status === "PENDING") await repository.requestNow(jobId);
    else await repository.cancel(jobId);
  } else {
    const status = z.enum(["READY_FOR_REVIEW", "APPROVED", "REJECTED"]).parse(formData.get("status"));
    await new PublishRepository(prisma).setOperatorStatus(jobId, status);
  }
  refresh("/", "/review", "/queue", "/downloads");
}

export async function resolveManualAttention(formData: FormData) {
  await new PublishRepository(prisma).resolveManualAttention(id.parse(formData.get("publishJobId")));
  refresh("/queue", "/review", "/");
}

export async function recoverIncorrectPublishedPost(formData: FormData) {
  try {
    const publishJobId = id.parse(formData.get("publishJobId"));
    const job = await prisma.publishJob.findUniqueOrThrow({ where: { id: publishJobId }, include: { mediaAsset: true } });
    if (job.mediaAsset.localRemovedAt) throw new Error("A publication cannot return to Review after its local media has been removed.");
    await access(job.mediaAsset.filePath);
    await new PublishRepository(prisma).recoverIncorrectPublishedPost(publishJobId);
  } catch (error) {
    const message = error instanceof Error && "code" in error && error.code === "ENOENT" ? "A publication cannot return to Review because its local video is missing." : error instanceof Error ? error.message : "The publication could not be recovered.";
    redirect(`/published?actionError=${encodeURIComponent(message)}`);
  }
  refresh("/published", "/review", "/queue", "/");
}

async function dashboardDownloader() {
  const config = applyStoredSettings(loadConfig(), await new SettingsRepository(prisma).getAll());
  const runner = new NodeProcessRunner();
  await verifyDownloadBinaries(runner, { ytDlp: config.ytDlpBinary, ffmpeg: config.ffmpegBinary, ffprobe: config.ffprobeBinary });
  return {
    config,
    repository: new DownloadRepository(prisma),
    service: new DownloadService(
      new DownloadRepository(prisma),
      new YtDlpService(runner, config.ytDlpBinary, config.ffmpegBinary, config.playwrightProfileDirectory ? resolve(config.playwrightProfilePath, config.playwrightProfileDirectory) : undefined),
      new FfprobeService(runner, config.ffprobeBinary),
      new MediaFiles(config.videoStoragePath, config.tempStoragePath, config.thumbnailStoragePath),
      pino({ level: "silent" }),
      3,
      new FfmpegPerceptualVideoHasher(runner, config.ffmpegBinary),
    ),
  };
}

async function dashboardPublisher() {
  const config = applyStoredSettings(loadConfig(), await new SettingsRepository(prisma).getAll());
  const logger = pino({ level: "silent" });
  const repository = new PublishRepository(prisma);
  const browserLease = new DatabaseExclusiveLease(new SchedulerRepository(prisma), "x-publisher-profile", Math.max(config.workerLockTimeoutMinutes, 10) * 60_000);
  return new PublishService(
    repository,
    new XPlaywrightPublisher({ repositoryRoot: config.repositoryRoot, profileDirectory: config.publisherProfilePath, browserChannel: config.playwrightBrowserChannel, browserProfileDirectory: config.publisherProfileDirectory, allowExternalProfile: config.playwrightAllowExternalProfile, lease: browserLease, diagnosticsDirectory: config.logStoragePath, headless: config.playwrightHeadless, minUploadMbps: config.publishMinUploadMbps, maxUploadTimeoutMs: config.publishMaxUploadMinutes * 60_000 }, logger),
    new LocalPublishMediaVerifier(config.videoStoragePath),
    logger,
    config.publishAllowEmptyCaption,
  );
}

export async function publishNow(formData: FormData) {
  let actionError: string | null = null;
  try {
    const publishJobId = id.parse(formData.get("publishJobId"));
    const service = await dashboardPublisher();
    if (!await service.processJob(publishJobId)) actionError = "This publish job could not be claimed.";
    if (!actionError) {
      const result = await prisma.publishJob.findUniqueOrThrow({ where: { id: publishJobId }, select: { status: true, lastError: true } });
      if (result.status !== "COMPLETED") actionError = result.lastError ?? "Publishing did not complete.";
    }
  } catch (error) {
    actionError = error instanceof Error ? error.message : "Publishing failed.";
  }
  if (actionError) redirect(`/queue?actionError=${encodeURIComponent(actionError)}`);
  refresh("/", "/queue", "/review", "/downloads", "/published");
}

export async function downloadNow(formData: FormData) {
  const jobId = id.parse(formData.get("jobId"));
  const download = await prisma.downloadJob.findUniqueOrThrow({ where: { id: jobId }, select: { sourcePostId: true } });
  const { config, repository, service } = await dashboardDownloader();
  await repository.requestNow(jobId);
  if (!await service.processJob(jobId)) throw new Error("Download job could not be claimed");
  const scheduled = await new SchedulerRepository(prisma).scheduleDownloadedAsset(download.sourcePostId, (source) => resolveCaption(source, config.captionTemplates));
  if (!scheduled) throw new Error("This post is no longer eligible for Review.");
  refresh("/", "/queue", "/downloads");
}

export async function processPendingDownloads(formData?: FormData) {
  const { config, service } = await dashboardDownloader();
  const limit = formData?.has("limit") ? z.coerce.number().int().min(1).max(1_000).parse(formData.get("limit")) : config.downloadBatchLimit;
  const runtime = new RuntimeStatusRepository(prisma);
  await runtime.update("dashboard-downloader", "RUNNING", JSON.stringify({ processed: 0, limit }));
  try {
    const processed = await service.processPending(config.downloadConcurrency, limit, async (count) => {
      await runtime.update("dashboard-downloader", "RUNNING", JSON.stringify({ processed: count, limit }));
    });
    await runtime.update("dashboard-downloader", "IDLE", JSON.stringify({ processed, limit }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await runtime.update("dashboard-downloader", "ERROR", JSON.stringify({ processed: 0, limit }), message);
    throw error;
  }
  await new SchedulerRepository(prisma).scheduleDownloadedAssets(new Date(), 0, (source) => resolveCaption(source, config.captionTemplates));
  refresh("/", "/queue", "/downloads");
}

export async function bulkRetryDownloads(formData: FormData) {
  const jobIds = z.array(id).min(1).parse(formData.getAll("jobId"));
  const repository = new DownloadRepository(prisma);
  await Promise.all(jobIds.map((jobId) => repository.requestNow(jobId)));
  refresh("/queue", "/downloads");
}

export async function bulkDownloadNow(formData: FormData) {
  await bulkRetryDownloads(formData);
  const { config, service } = await dashboardDownloader();
  await service.processPending(config.downloadConcurrency, config.downloadBatchLimit);
  await new SchedulerRepository(prisma).scheduleDownloadedAssets(new Date(), 0, (source) => resolveCaption(source, config.captionTemplates));
  refresh("/", "/queue", "/downloads");
}

export async function removeMedia(formData: FormData) {
  const returnPath = formData.get("returnPath") === "/videos" ? "/videos" : "/downloads";
  try {
    const sourcePostId = id.parse(formData.get("sourcePostId"));
    const config = applyStoredSettings(loadConfig(), await new SettingsRepository(prisma).getAll());
    await new MediaRemovalService(prisma).remove(sourcePostId, { videos: config.videoStoragePath, thumbnails: config.thumbnailStoragePath });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Local media could not be deleted.";
    redirect(`${returnPath}?actionError=${encodeURIComponent(message)}`);
  }
  refresh("/downloads", "/review", "/queue", "/published", "/videos", "/");
}

export async function confirmPublishedAndRemoveMedia(formData: FormData) {
  try {
    const sourcePostId = id.parse(formData.get("sourcePostId"));
    const config = applyStoredSettings(loadConfig(), await new SettingsRepository(prisma).getAll());
    await new MediaRemovalService(prisma).removePublished(sourcePostId, { videos: config.videoStoragePath, thumbnails: config.thumbnailStoragePath });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Local media could not be deleted.";
    redirect(`/published?actionError=${encodeURIComponent(message)}`);
  }
  refresh("/published", "/downloads", "/videos", "/");
}

export async function fetchPostPerformance(formData: FormData) {
  const publishedPostId = id.parse(formData.get("publishedPostId"));
  const query = new URLSearchParams({ performance: publishedPostId });
  try {
    const record = await prisma.publishedPost.findUniqueOrThrow({ where: { id: publishedPostId }, select: { platformUrl: true } });
    if (!record.platformUrl) throw new Error("This publication does not have an X post URL.");
    const config = applyStoredSettings(loadConfig(), await new SettingsRepository(prisma).getAll());
    const lease = new DatabaseExclusiveLease(new SchedulerRepository(prisma), "x-publisher-profile", Math.max(config.workerLockTimeoutMinutes, 10) * 60_000);
    const browser = new PlaywrightTimelineBrowser({
      headless: config.playwrightHeadless,
      browserChannel: config.playwrightBrowserChannel,
      repositoryRoot: config.repositoryRoot,
      profileDirectory: config.publisherProfilePath,
      browserProfileDirectory: config.publisherProfileDirectory,
      allowExternalProfile: config.playwrightAllowExternalProfile,
      lease,
      diagnosticsDirectory: config.logStoragePath,
    }, pino({ level: "silent" }));
    const metrics = await browser.readPostMetrics(record.platformUrl);
    query.set("fetchedAt", new Date().toISOString());
    for (const [key, value] of Object.entries(metrics)) query.set(key, value === null ? "" : String(value));
  } catch (error) {
    const message = error instanceof ResourceBusyError ? "The X browser is busy. Wait for the active operation to finish." : error instanceof Error ? error.message : "Could not fetch post performance.";
    query.set("performanceError", message);
  }
  redirect(`/published?${query}`);
}

export async function downloadAgain(formData: FormData) {
  const sourcePostId = id.parse(formData.get("sourcePostId"));
  const job = await prisma.downloadJob.findUniqueOrThrow({ where: { sourcePostId }, select: { id: true } });
  await new DownloadRepository(prisma).requestNow(job.id);
  refresh("/downloads", "/queue", "/");
}

export async function sendToReview(formData: FormData) {
  const sourcePostId = id.parse(formData.get("sourcePostId"));
  const post = await prisma.sourcePost.findUniqueOrThrow({ where: { id: sourcePostId }, include: { mediaAsset: true, publishJob: true } });
  if (!post.mediaAsset || post.mediaAsset.localRemovedAt) throw new Error("This post has no available local media.");
  if (post.publishJob) throw new Error("This post already has a review or publish job.");
  if (post.status !== "DOWNLOADED") throw new Error("Only downloaded posts can enter review.");
  const config = applyStoredSettings(loadConfig(), await new SettingsRepository(prisma).getAll());
  const scheduled = await new SchedulerRepository(prisma).scheduleDownloadedAsset(sourcePostId, (source) => resolveCaption(source, config.captionTemplates));
  if (!scheduled) throw new Error("This post is no longer eligible for Review.");
  refresh("/downloads", "/review", "/queue", "/");
}

export async function sendAllToReview() {
  const config = applyStoredSettings(loadConfig(), await new SettingsRepository(prisma).getAll());
  await new SchedulerRepository(prisma).scheduleDownloadedAssets(new Date(), 0, (source) => resolveCaption(source, config.captionTemplates));
  refresh("/downloads", "/review", "/queue", "/");
}

export async function returnToDownloads(formData: FormData) {
  const publishJobId = id.parse(formData.get("publishJobId"));
  await new PublishRepository(prisma).returnToDownloads(publishJobId);
  refresh("/downloads", "/review", "/queue", "/");
}

export async function bulkDownloadAction(formData: FormData) {
  const operation = z.enum(["retry", "download"]).parse(formData.get("operation"));
  if (operation === "retry") await bulkRetryDownloads(formData);
  else await bulkDownloadNow(formData);
}

export async function saveSettings(formData: FormData) {
  const values = {
    COLLECTION_INTERVAL_MINUTES: String(z.coerce.number().int().min(1).max(59).parse(formData.get("collectionIntervalMinutes"))),
    POSTS_PER_SOURCE: String(z.coerce.number().int().min(1).max(100).parse(formData.get("postsPerSource"))),
    PUBLISH_INTERVAL_MINUTES: String(z.coerce.number().int().min(1).parse(formData.get("publishIntervalMinutes"))),
    PLAYWRIGHT_HEADLESS: z.enum(["true", "false"]).parse(formData.get("headless")),
    PUBLISH_MODE: z.enum(["ASSISTED", "AUTOMATIC"]).parse(formData.get("publishMode")),
    PUBLISH_MIN_UPLOAD_MBPS: String(z.coerce.number().min(0.25).max(1_000).parse(formData.get("publishMinUploadMbps"))),
    PUBLISH_MAX_UPLOAD_MINUTES: String(z.coerce.number().int().min(5).max(120).parse(formData.get("publishMaxUploadMinutes"))),
    DOWNLOAD_CONCURRENCY: String(z.coerce.number().int().min(1).max(3).parse(formData.get("downloadConcurrency"))),
    DOWNLOAD_BATCH_LIMIT: String(z.coerce.number().int().min(1).max(1_000).parse(formData.get("downloadBatchLimit"))),
    SOURCE_ACCOUNT_LIMIT: String(z.coerce.number().int().min(1).max(100).parse(formData.get("sourceAccountLimit"))),
    DAILY_POST_MINIMUM: String(z.coerce.number().int().min(0).max(20).parse(formData.get("dailyMinimum"))),
    DAILY_POST_PREFERRED: String(z.coerce.number().int().min(0).max(20).parse(formData.get("dailyPreferred"))),
  };
  await new SettingsRepository(prisma).setMany(values);
  refresh("/settings", "/");
}

export async function saveCaptionSettings(formData: FormData) {
  const templates = z.string().max(10_000).parse(formData.get("captionTemplates"));
  await new SettingsRepository(prisma).setMany({ CAPTION_TEMPLATES: templates });
  const jobs = await prisma.publishJob.findMany({ where: { status: "READY_FOR_REVIEW" }, include: { sourcePost: { include: { sourceAccount: true } } } });
  if (jobs.length > 0) await prisma.$transaction(jobs.map((job) => prisma.publishJob.update({ where: { id: job.id }, data: { caption: resolveCaption(job.sourcePost, templates) } })));
  refresh("/settings", "/review");
  redirect("/settings?captionSaved=1");
}

export async function publishManualPost(formData: FormData) {
  const image = formData.get("image");
  const hasImage = image instanceof File && image.size > 0;
  let imagePath: string | null = null;
  let publishedUrl: string | null = null;
  let errorMessage: string | null = null;
  try {
    const caption = validateCaption(z.string().parse(formData.get("text")), false);
    const config = applyStoredSettings(loadConfig(), await new SettingsRepository(prisma).getAll());
    if (hasImage) {
      if (image.size > 10 * 1024 * 1024) throw new Error("The image must be 10 MB or smaller.");
      if (!(image.type in manualImageTypes)) throw new Error("Use a JPEG, PNG, WebP, or GIF image.");
      const type = image.type as keyof typeof manualImageTypes;
      const bytes = new Uint8Array(await image.arrayBuffer());
      if (!validImageSignature(type, bytes)) throw new Error("The uploaded file does not match its image type.");
      await mkdir(config.tempStoragePath, { recursive: true });
      imagePath = resolve(config.tempStoragePath, `manual-post-${randomUUID()}.${manualImageTypes[type]}`);
      await writeFile(imagePath, bytes);
    }
    const logger = pino({ level: "silent" });
    const browserLease = new DatabaseExclusiveLease(new SchedulerRepository(prisma), "x-publisher-profile", Math.max(config.workerLockTimeoutMinutes, 10) * 60_000);
    const publisher = new XPlaywrightPublisher({ repositoryRoot: config.repositoryRoot, profileDirectory: config.publisherProfilePath, browserChannel: config.playwrightBrowserChannel, browserProfileDirectory: config.publisherProfileDirectory, allowExternalProfile: config.playwrightAllowExternalProfile, lease: browserLease, diagnosticsDirectory: config.logStoragePath, headless: config.playwrightHeadless, minUploadMbps: config.publishMinUploadMbps, maxUploadTimeoutMs: config.publishMaxUploadMinutes * 60_000 }, logger);
    const manualId = `manual-${Date.now()}`;
    const result = await publisher.publish({ jobId: manualId, platformPostId: manualId, mediaPath: imagePath, mediaKind: hasImage ? "image" : null, caption, fileSize: hasImage ? image.size : 0, durationSeconds: 0, width: 0, height: 0, codec: null });
    publishedUrl = result.platformUrl;
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  } finally {
    if (imagePath) await rm(imagePath, { force: true }).catch(() => undefined);
  }
  if (errorMessage) redirect(`/compose?error=${encodeURIComponent(errorMessage)}`);
  redirect(`/compose?published=1${publishedUrl ? `&url=${encodeURIComponent(publishedUrl)}` : ""}`);
}
