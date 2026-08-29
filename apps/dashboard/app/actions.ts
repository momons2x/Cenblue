"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { access, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, relative, resolve } from "node:path";
import { z } from "zod";
import { CollectionService, PlaywrightTimelineBrowser, XPlaywrightCollector } from "@cenblu/collector";
import { applyStoredSettings, browserBindingFingerprint, browserIds, loadConfig } from "@cenblu/config";
import { BrowserIdentityRepository, CollectionRunRepository, DatabaseExclusiveLease, identityFingerprint, identityLeaseName, NotificationOutboxRepository, OperationalEventRepository, prisma, PublishRepository, RuntimeStatusRepository, SchedulerRepository, SettingsRepository, SourceAccountRepository, SourcePostRepository } from "@cenblu/database";
import { DownloadRepository } from "@cenblu/database";
import { FfmpegVideoCompressor, FfprobeService, MediaFiles, NodeProcessRunner, FfmpegPerceptualVideoHasher } from "@cenblu/downloader";
import { createPublishNotifier, NotificationEmitter, TelegramTransport, type NotificationChannel } from "@cenblu/notifications";
import { DiscordDmTransport } from "@cenblu/discord-bot";
import { buildBatchSchedule } from "@cenblu/scheduler";
import { BrowserProfileRemovalService, FullResetService, MediaRemovalService, SourcePurgeService } from "@cenblu/operations";
import { discoverInstalledChromiumBrowsers, LocalPublishMediaVerifier, openChromiumProfile, PublishService, resolveCaption, validateCaption, validateChromiumExecutable, XPlaywrightPublisher } from "@cenblu/publisher";
import { combineExclusiveLeases, ResourceBusyError } from "@cenblu/shared/lease";
import pino from "pino";
import { scheduleFromFields } from "./lib/schedule";
import { triggerPendingDownloads } from "./lib/download-runner";

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
  const collectorIdentityId = id.parse(formData.get("collectorIdentityId"));
  const collector = await prisma.browserIdentity.findFirst({ where: { id: collectorIdentityId, role: "COLLECTOR", enabled: true } });
  if (!collector) throw new Error("Choose an enabled Collector identity.");
  const config = applyStoredSettings(loadConfig(), await new SettingsRepository(prisma).getAll());
  await new SourceAccountRepository(prisma, config.sourceAccountLimit).create({ username: parsed.data, collectLimit: limit.parse(formData.get("collectLimit") ?? 5), collectorIdentityId });
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
  const identities = await prisma.browserIdentity.findMany({ where: { role: "COLLECTOR", enabled: true } });
  const identityMap = new Map(identities.map((identity) => [identity.id, identity]));
  const grouped = new Map<string, typeof sources>();
  for (const source of sources) {
    const identityId = source.collectorIdentityId ?? "legacy-collector";
    grouped.set(identityId, [...(grouped.get(identityId) ?? []), source]);
  }
  let busy = false;
  const groups = [...grouped.entries()];
  for (let index = 0; index < groups.length; index += 2) {
    const batch = groups.slice(index, index + 2);
    const results = await Promise.all(batch.map(async ([identityId, identitySources]) => {
      const identity = identityMap.get(identityId);
      const runs = new CollectionRunRepository(prisma);
      if (!identity) {
        const run = await runs.start(identitySources.map((source) => ({ id: source.id, targetNew: Math.min(source.collectLimit, config.postsPerSource) })));
        await runs.finish(run.id, "FAILED", "The assigned Collector identity no longer exists. Reassign these sources to a verified Collector.");
        for (const source of identitySources) await runs.finishSource(run.id, source.id, { failed: true, cancelled: false, inserted: 0, error: "The assigned Collector identity no longer exists." });
        return false;
      }
      if (!identity.verifiedAt || identity.verifiedUsername !== identity.expectedUsername) {
        const run = await runs.start(identitySources.map((source) => ({ id: source.id, targetNew: Math.min(source.collectLimit, config.postsPerSource) })));
        await runs.finish(run.id, "FAILED", `${identity.label} must be verified before collection. Reassign these sources to a verified Collector or verify ${identity.label}.`);
        for (const source of identitySources) await runs.finishSource(run.id, source.id, { failed: true, cancelled: false, inserted: 0, error: `${identity.label} is not verified for collection.` });
        return false;
      }
      await runs.recoverStale(new Date(Date.now() - Math.max(config.workerLockTimeoutMinutes, 10) * 60_000));
      const run = await runs.start(identitySources.map((source) => ({ id: source.id, targetNew: Math.min(source.collectLimit, config.postsPerSource) })), identity.id);
      const runtime = new RuntimeStatusRepository(prisma);
      await runtime.update(`collector:${identity.id}`, "RUNNING", "collection");
      const browserLease = new DatabaseExclusiveLease(new SchedulerRepository(prisma), identityLeaseName(identity.id), Math.max(config.workerLockTimeoutMinutes, 10) * 60_000);
      const sourcePosts = new SourcePostRepository(prisma);
      const service = new CollectionService({ listEnabled: async () => identitySources, recordCollectionSuccess: sourceRepository.recordCollectionSuccess.bind(sourceRepository), recordCollectionFailure: sourceRepository.recordCollectionFailure.bind(sourceRepository) }, {
        listPlatformPostIds: sourcePosts.listPlatformPostIds.bind(sourcePosts),
        persistNew: (sourceAccountId, posts, collectedAt) => sourcePosts.persistNew(sourceAccountId, posts, collectedAt, identity.id),
      }, new XPlaywrightCollector(new PlaywrightTimelineBrowser({ headless: config.playwrightHeadless, browserId: identity.browserId as typeof config.collectorBrowserId, browserExecutablePath: identity.executablePath ?? undefined, repositoryRoot: config.repositoryRoot, profileDirectory: resolve(config.repositoryRoot, identity.profilePath), browserProfileDirectory: identity.profileDirectory ?? undefined, lease: browserLease, diagnosticsDirectory: config.logStoragePath, maxScrolls: config.collectorMaxScrolls, idleScrolls: config.collectorIdleScrolls, scrollDelayMs: config.collectorScrollDelayMs, maxSourceDurationMs: config.collectorMaxSourceSeconds * 1_000, expectedUsername: identity.expectedUsername ?? undefined }, logger)), logger, identitySources.length, config.postsPerSource, {
        sourceStarting: (source) => runs.startSource(run.id, source.id, source.username), sourceProgress: (sourceId, progress) => runs.progressSource(run.id, sourceId, progress), sourceFinished: (source) => runs.finishSource(run.id, source.id, source), shouldCancel: () => runs.shouldCancel(run.id),
      });
      try {
        const result = await service.runOnce();
        await runs.finish(run.id, result.cancelled ? "CANCELLED" : result.sourcesFailed > 0 ? "FAILED" : "COMPLETED");
        await runtime.update(`collector:${identity.id}`, result.cancelled ? "CANCELLED" : result.sourcesFailed > 0 ? "FAILED" : "IDLE");
        return false;
      } catch (error) {
        await runs.finish(run.id, error instanceof ResourceBusyError ? "BUSY" : "FAILED", error instanceof Error ? error.message : String(error));
        await runtime.update(`collector:${identity.id}`, error instanceof ResourceBusyError ? "BUSY" : "FAILED", undefined, error instanceof Error ? error.message : String(error));
        if (error instanceof ResourceBusyError) return true;
        throw error;
      }
    }));
    busy ||= results.some(Boolean);
  }
  return { busy };
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
    const collectorIdentityId = id.parse(formData.get("collectorIdentityId"));
    const config = applyStoredSettings(loadConfig(), await new SettingsRepository(prisma).getAll());
    const identity = await prisma.browserIdentity.findFirst({ where: { id: collectorIdentityId, role: "COLLECTOR", enabled: true } });
    if (!identity || !identity.verifiedAt || identity.verifiedUsername !== identity.expectedUsername) throw new Error("Choose a verified Collector identity.");
    const logger = pino({ level: "silent" });
    const repository = new SourcePostRepository(prisma);
    const browserLease = new DatabaseExclusiveLease(new SchedulerRepository(prisma), identityLeaseName(identity.id), Math.max(config.workerLockTimeoutMinutes, 10) * 60_000);
    const collector = new XPlaywrightCollector(new PlaywrightTimelineBrowser({
      headless: config.playwrightHeadless,
      browserId: identity.browserId as typeof config.collectorBrowserId,
      browserExecutablePath: identity.executablePath ?? undefined,
      repositoryRoot: config.repositoryRoot,
      profileDirectory: resolve(config.repositoryRoot, identity.profilePath),
      browserProfileDirectory: identity.profileDirectory ?? undefined,
      lease: browserLease,
      diagnosticsDirectory: config.logStoragePath,
      maxScrolls: config.collectorMaxScrolls,
      idleScrolls: config.collectorIdleScrolls,
      scrollDelayMs: config.collectorScrollDelayMs,
      maxSourceDurationMs: config.collectorMaxSourceSeconds * 1_000,
      expectedUsername: identity.expectedUsername ?? undefined,
    }, logger));
    const knownPostIds = await repository.listAllPlatformPostIds();
    const posts = await collector.withSession(() => collector.collectBookmarks(target, { knownPostIds }));
    const result = await repository.persistBookmarks(posts, new Date(), identity.id);
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
  const config = applyStoredSettings(loadConfig(), await new SettingsRepository(prisma).getAll());
  const scheduledFor = scheduleFromFields(formData, config.timezone, false);
  if (!scheduledFor) throw new Error("Choose a schedule date.");
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
  const config = applyStoredSettings(loadConfig(), await new SettingsRepository(prisma).getAll());
  const scheduledFor = scheduleFromFields(formData, config.timezone, true);
  if (scheduledFor && scheduledFor <= new Date()) throw new Error("Choose a future schedule time.");
  const caption = z.string().max(280).parse(formData.get("caption"));
  const publisherIdentityIds = z.array(id).min(1, "Select at least one Publisher identity.").parse(formData.getAll("publisherIdentityId"));
  await new PublishRepository(prisma).approveTargets(publishJobId, publisherIdentityIds, scheduledFor, caption, { notes: z.string().max(2_000).parse(formData.get("reviewNotes") ?? ""), tags: z.string().max(500).parse(formData.get("internalTags") ?? "") });
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
    const config = applyStoredSettings(loadConfig(), await new SettingsRepository(prisma).getAll());
    const scheduledFor = scheduleFromFields(formData, config.timezone, true);
    if (scheduledFor && scheduledFor <= new Date()) throw new Error("Choose a future schedule time.");
    const publisherIdentityIds = z.array(id).min(1, "Select at least one Publisher identity.").parse(formData.getAll("publisherIdentityId"));
    for (const jobId of jobIds) {
      const job = await prisma.publishJob.findUniqueOrThrow({ where: { id: jobId } });
      await repository.approveTargets(jobId, publisherIdentityIds, scheduledFor, job.caption);
    }
  } else if (decision === "reject") {
    for (const jobId of jobIds) await repository.reject(jobId);
  } else {
    for (const jobId of jobIds) await repository.returnToDownloads(jobId);
  }
  refresh("/review", "/queue", "/");
}

export async function scheduleBatchReview(formData: FormData) {
  const jobIds = z.array(id).min(1, "Select at least one review item.").parse(formData.getAll("publishJobId"));
  const config = applyStoredSettings(loadConfig(), await new SettingsRepository(prisma).getAll());
  const jobs = await prisma.publishJob.findMany({ where: { id: { in: jobIds } }, select: { id: true, sourcePost: { select: { postedAt: true } } } });
  if (jobs.length !== jobIds.length) throw new Error("One or more selected review items no longer exist.");
  const rawDay = String(formData.get("scheduleDay") ?? "").trim();
  const targetDay = rawDay || new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone }).format(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDay)) throw new Error("Choose a valid schedule day.");
  const rawCount = String(formData.get("postsPerDay") ?? "").trim();
  const countOverride = rawCount === "" ? undefined : z.coerce.number().int().min(1).max(50).parse(rawCount);
  const publisherIdentityIds = z.array(id).min(1, "Select at least one Publisher identity.").parse(formData.getAll("publisherIdentityId"));
  const publishers = await prisma.browserIdentity.findMany({ where: { id: { in: publisherIdentityIds }, role: "PUBLISHER", enabled: true } });
  if (publishers.length !== new Set(publisherIdentityIds).size) throw new Error("One or more selected Publisher identities are unavailable.");

  const repository = new PublishRepository(prisma);
  const allScheduled: Array<{ jobId: string; scheduledFor: Date }> = [];
  for (const publisherId of publisherIdentityIds) {
    const schedule = buildBatchSchedule({
      jobs: jobs.map((job) => ({ id: job.id })),
      timeZone: config.timezone,
      activeWindows: config.scheduleActiveWindows,
      jitterMinutes: config.scheduleJitterMinutes,
      minGapMinutes: config.scheduleMinGapMinutes,
      postsPerDay: countOverride,
      targetDay,
    });
    allScheduled.push(...schedule);
    for (const entry of schedule) {
      const job = await prisma.publishJob.findUniqueOrThrow({ where: { id: entry.jobId } });
      await repository.approveTargets(entry.jobId, [publisherId], entry.scheduledFor, job.caption);
    }
  }
  refresh("/review", "/queue", "/");
  const first = allScheduled[0]?.scheduledFor;
  const last = allScheduled[allScheduled.length - 1]?.scheduledFor;
  const intervalMinutes = allScheduled.length > 1 && first && last ? Math.round((last.getTime() - first.getTime()) / (allScheduled.length - 1) / 60_000) : 0;
  const formatDay = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone }).format(date);
  redirect(`/review?batchScheduled=${allScheduled.length}&batchDay=${formatDay(first ?? new Date())}&batchEndDay=${last ? formatDay(last) : formatDay(first ?? new Date())}&batchInterval=${intervalMinutes}&batchFirst=${first ? first.toISOString() : ""}`);
}


export async function restoreDuplicate(formData: FormData) {
  const sourcePostId = id.parse(formData.get("sourcePostId"));
  const post = await prisma.sourcePost.findUniqueOrThrow({ where: { id: sourcePostId }, include: { publishJobs: true, mediaAsset: true } });
  const reviewJob = post.publishJobs.find((job) => job.publisherIdentityId === null) ?? post.publishJobs[0];
  await prisma.$transaction([
    prisma.sourcePost.update({ where: { id: sourcePostId }, data: { status: post.mediaAsset ? "READY_FOR_REVIEW" : "QUEUED_FOR_DOWNLOAD", duplicateReason: null } }),
    ...(reviewJob ? [prisma.publishJob.update({ where: { id: reviewJob.id }, data: { status: "READY_FOR_REVIEW" } })] : []),
    ...(!reviewJob && post.mediaAsset ? [prisma.publishJob.create({ data: { sourcePostId, mediaAssetId: post.mediaAsset.id, caption: post.text, status: "READY_FOR_REVIEW" } })] : []),
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

async function buildNotificationEmitter(config: ReturnType<typeof applyStoredSettings>) {
  const settings = await new SettingsRepository(prisma).getAll();
  const hasAnyChannel = (config.telegramBotToken && settings.TELEGRAM_CHAT_ID) || (config.discordBotToken && config.discordOwnerId && settings.NOTIFICATIONS_DISCORD_ENABLED === "true");
  if (settings.NOTIFICATIONS_ENABLED === "true" && hasAnyChannel) {
    return new NotificationEmitter(
      new OperationalEventRepository(prisma),
      new NotificationOutboxRepository(prisma),
      undefined,
      async (identityId) => (await prisma.browserIdentity.findUnique({ where: { id: identityId }, select: { label: true } }))?.label ?? null,
    );
  }
  return null;
}

async function notificationChannelMap(config: ReturnType<typeof applyStoredSettings>): Promise<Partial<Record<NotificationChannel, string>>> {
  const stored = await new SettingsRepository(prisma).getAll();
  const channels: Partial<Record<NotificationChannel, string>> = {};
  if (config.telegramBotToken && stored.TELEGRAM_CHAT_ID) channels.telegram = stored.TELEGRAM_CHAT_ID;
  if (config.discordBotToken && config.discordOwnerId && stored.NOTIFICATIONS_DISCORD_ENABLED === "true") channels.discord = config.discordOwnerId;
  return channels;
}

async function notificationSettings(config: ReturnType<typeof applyStoredSettings>): Promise<{ enabled: boolean; channels: Partial<Record<NotificationChannel, string>> }> {
  const stored = await new SettingsRepository(prisma).getAll();
  return { enabled: stored.NOTIFICATIONS_ENABLED === "true", channels: await notificationChannelMap(config) };
}

async function dashboardPublisher(publisherIdentityId: string) {
  const config = applyStoredSettings(loadConfig(), await new SettingsRepository(prisma).getAll());
  const identity = await prisma.browserIdentity.findFirst({ where: { id: publisherIdentityId, role: "PUBLISHER", enabled: true } });
  if (!identity || !identity.verifiedAt || identity.verifiedUsername !== identity.expectedUsername || identity.verifiedFingerprint !== identityFingerprint(identity)) throw new Error("The selected Publisher identity must be verified again.");
  const logger = pino({ level: "silent" });
  const repository = new PublishRepository(prisma);
  const browserLease = new DatabaseExclusiveLease(new SchedulerRepository(prisma), identityLeaseName(identity.id), Math.max(config.workerLockTimeoutMinutes, 10) * 60_000);
  const capacityLease = new DatabaseExclusiveLease(new SchedulerRepository(prisma), "publisher-capacity:1", Math.max(config.workerLockTimeoutMinutes, 10) * 60_000);
  const notifier = await createPublishNotifier(prisma, {
    telegramBotToken: config.telegramBotToken,
    discordBotToken: config.discordBotToken,
    discordOwnerId: config.discordOwnerId,
  }, async (identityId) => (await prisma.browserIdentity.findUnique({ where: { id: identityId }, select: { label: true } }))?.label ?? null);
  return new PublishService(
    repository,
    new XPlaywrightPublisher({ repositoryRoot: config.repositoryRoot, profileDirectory: resolve(config.repositoryRoot, identity.profilePath), browserId: identity.browserId as typeof config.publisherBrowserId, browserExecutablePath: identity.executablePath ?? undefined, browserProfileDirectory: identity.profileDirectory ?? undefined, lease: combineExclusiveLeases(capacityLease, browserLease), diagnosticsDirectory: config.logStoragePath, headless: config.playwrightHeadless, minUploadMbps: config.publishMinUploadMbps, maxUploadTimeoutMs: config.publishMaxUploadMinutes * 60_000, expectedUsername: identity.expectedUsername ?? undefined }, logger),
    new LocalPublishMediaVerifier(config.videoStoragePath),
    logger,
    config.publishAllowEmptyCaption,
    3,
    identity.id,
    notifier?.onPublishFailure,
    notifier?.onPublishSuccess,
  );
}

export async function publishNow(formData: FormData) {
  let actionError: string | null = null;
  try {
    const publishJobId = id.parse(formData.get("publishJobId"));
    const job = await prisma.publishJob.findUniqueOrThrow({ where: { id: publishJobId }, select: { publisherIdentityId: true } });
    if (!job.publisherIdentityId) throw new Error("Choose a Publisher identity before publishing.");
    const service = await dashboardPublisher(job.publisherIdentityId);
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
  const repository = new DownloadRepository(prisma);
  await repository.requestNow(jobId);
  await triggerPendingDownloads(1);
  refresh("/", "/queue", "/downloads");
}

export async function processPendingDownloads(formData?: FormData) {
  const limit = formData?.has("limit") ? z.coerce.number().int().min(1).max(1_000).parse(formData.get("limit")) : undefined;
  const started = await triggerPendingDownloads(limit);
  refresh("/", "/queue", "/downloads");
  redirect(`/queue?${started ? "downloadStarted=1" : "downloadBusy=1"}`);
}

export async function bulkRetryDownloads(formData: FormData) {
  const jobIds = z.array(id).min(1).parse(formData.getAll("jobId"));
  const repository = new DownloadRepository(prisma);
  await Promise.all(jobIds.map((jobId) => repository.requestNow(jobId)));
  refresh("/queue", "/downloads");
}

export async function bulkDownloadNow(formData: FormData) {
  await bulkRetryDownloads(formData);
  await triggerPendingDownloads();
  refresh("/", "/queue", "/downloads");
  redirect("/queue?downloadStarted=1");
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
    const record = await prisma.publishedPost.findUniqueOrThrow({ where: { id: publishedPostId }, select: { platformUrl: true, publishJob: { select: { publisherIdentity: true } } } });
    if (!record.platformUrl) throw new Error("This publication does not have an X post URL.");
    const config = applyStoredSettings(loadConfig(), await new SettingsRepository(prisma).getAll());
    const identity = record.publishJob.publisherIdentity;
    if (!identity) throw new Error("This publication has no Publisher identity.");
    const lease = new DatabaseExclusiveLease(new SchedulerRepository(prisma), identityLeaseName(identity.id), Math.max(config.workerLockTimeoutMinutes, 10) * 60_000);
    const browser = new PlaywrightTimelineBrowser({
      headless: config.playwrightHeadless,
      browserId: identity.browserId as typeof config.publisherBrowserId,
      browserExecutablePath: identity.executablePath ?? undefined,
      repositoryRoot: config.repositoryRoot,
      profileDirectory: resolve(config.repositoryRoot, identity.profilePath),
      browserProfileDirectory: identity.profileDirectory ?? undefined,
      lease,
      diagnosticsDirectory: config.logStoragePath,
      profileRole: "publisher",
      expectedUsername: identity.expectedUsername ?? undefined,
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
  const post = await prisma.sourcePost.findUniqueOrThrow({ where: { id: sourcePostId }, include: { mediaAsset: true, publishJobs: true } });
  if (!post.mediaAsset || post.mediaAsset.localRemovedAt) throw new Error("This post has no available local media.");
  if (post.publishJobs.length > 0) throw new Error("This post already has a review or publish job.");
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

const browserRole = z.enum(["collector", "publisher"]);
const browserId = z.enum(browserIds);

function browserSessionKeys(role: "collector" | "publisher"): string[] {
  const prefix = role.toUpperCase();
  return [`${prefix}_BROWSER_SESSION_VERIFIED_AT`, `${prefix}_BROWSER_SESSION_ACCOUNT`, `${prefix}_BROWSER_SESSION_BINDING`, `${prefix}_BROWSER_SESSION_ERROR`];
}

export async function saveBrowserBinding(formData: FormData) {
  const role = browserRole.parse(formData.get("role"));
  const selectedId = browserId.parse(formData.get("browserId"));
  const lock = await prisma.schedulerLock.findUnique({ where: { name: `x-${role}-profile` } });
  if (lock && lock.lockedUntil > new Date()) throw new Error(`The ${role} browser is busy. Wait for it to finish before changing browsers.`);
  let executablePath: string;
  if (selectedId === "custom") executablePath = z.string().trim().min(1, "Enter the custom browser executable path.").parse(formData.get("customExecutablePath"));
  else {
    const installation = (await discoverInstalledChromiumBrowsers()).find((browser) => browser.id === selectedId);
    if (!installation) throw new Error("That browser is not currently detected on this device.");
    executablePath = installation.executablePath;
  }
  executablePath = await validateChromiumExecutable(executablePath);
  const prefix = role === "collector" ? "DEVICE_COLLECTOR" : "DEVICE_PUBLISHER";
  const settings = new SettingsRepository(prisma);
  await settings.setMany({ [`${prefix}_BROWSER_ID`]: selectedId, [`${prefix}_BROWSER_EXECUTABLE`]: executablePath });
  await settings.deleteMany(browserSessionKeys(role));
  refresh("/settings", "/");
}

export async function openBrowserLogin(formData: FormData) {
  const role = browserRole.parse(formData.get("role"));
  const settings = new SettingsRepository(prisma);
  const stored = await settings.getAll();
  const config = applyStoredSettings(loadConfig(), stored);
  const selectedBrowserId = role === "collector" ? config.collectorBrowserId : config.publisherBrowserId;
  const executablePath = (role === "collector" ? config.collectorBrowserExecutablePath : config.publisherBrowserExecutablePath)
    ?? (await discoverInstalledChromiumBrowsers()).find((browser) => browser.id === selectedBrowserId)?.executablePath;
  const profilePath = role === "collector" ? config.playwrightProfilePath : config.publisherProfilePath;
  const profileDirectory = role === "collector" ? config.playwrightProfileDirectory : config.publisherProfileDirectory;
  if (!executablePath) throw new Error(`Select the ${role} browser before opening its login profile.`);
  await settings.deleteMany(browserSessionKeys(role));
  await mkdir(profilePath, { recursive: true });
  await openChromiumProfile(executablePath, profilePath, profileDirectory);
  refresh("/settings", "/");
}

export async function checkBrowserSession(formData: FormData) {
  const role = browserRole.parse(formData.get("role"));
  const settings = new SettingsRepository(prisma);
  await settings.deleteMany(browserSessionKeys(role));
  const stored = await settings.getAll();
  const config = applyStoredSettings(loadConfig(), stored);
  const lease = new DatabaseExclusiveLease(new SchedulerRepository(prisma), `x-${role}-profile`, Math.max(config.workerLockTimeoutMinutes, 10) * 60_000);
  const logger = pino({ level: "silent" });
  try {
    const account = role === "collector"
      ? await new PlaywrightTimelineBrowser({ headless: false, browserId: config.collectorBrowserId, browserExecutablePath: config.collectorBrowserExecutablePath, repositoryRoot: config.repositoryRoot, profileDirectory: config.playwrightProfilePath, browserProfileDirectory: config.playwrightProfileDirectory, allowExternalProfile: config.playwrightAllowExternalProfile, lease, diagnosticsDirectory: config.logStoragePath }, logger).checkSession()
      : await new XPlaywrightPublisher({ repositoryRoot: config.repositoryRoot, profileDirectory: config.publisherProfilePath, browserId: config.publisherBrowserId, browserExecutablePath: config.publisherBrowserExecutablePath, browserProfileDirectory: config.publisherProfileDirectory, allowExternalProfile: config.playwrightAllowExternalProfile, lease, diagnosticsDirectory: config.logStoragePath, headless: false }, logger).checkSession();
    const prefix = role.toUpperCase();
    await settings.setMany({
      [`${prefix}_BROWSER_SESSION_VERIFIED_AT`]: new Date().toISOString(),
      [`${prefix}_BROWSER_SESSION_ACCOUNT`]: account ?? "Authenticated X account",
      [`${prefix}_BROWSER_SESSION_BINDING`]: browserBindingFingerprint(config, role),
    });
  } catch (error) {
    await settings.setMany({ [`${role.toUpperCase()}_BROWSER_SESSION_ERROR`]: error instanceof ResourceBusyError ? "Close the Cenblue browser profile window, then check again." : error instanceof Error ? error.message.split("\n")[0] : "Session verification failed." });
  }
  refresh("/settings", "/");
}

export async function resetBrowserProfile(formData: FormData) {
  const role = browserRole.parse(formData.get("role"));
  const settings = new SettingsRepository(prisma);
  const config = applyStoredSettings(loadConfig(), await settings.getAll());
  const profilePath = role === "collector" ? config.playwrightProfilePath : config.publisherProfilePath;
  if (!inside(resolve(config.repositoryRoot, "storage", "browser-profiles"), profilePath)) throw new Error("Only dashboard-managed browser profiles can be reset.");
  const lock = await prisma.schedulerLock.findUnique({ where: { name: `x-${role}-profile` } });
  if (lock && lock.lockedUntil > new Date()) throw new Error(`The ${role} browser is busy.`);
  await rm(profilePath, { recursive: true, force: true });
  await settings.deleteMany(browserSessionKeys(role));
  refresh("/settings", "/");
}

export async function createBrowserIdentity(formData: FormData) {
  const role = z.enum(["COLLECTOR", "PUBLISHER"]).parse(formData.get("role"));
  const selectedId = browserId.parse(formData.get("browserId"));
  let executablePath: string;
  if (selectedId === "custom") executablePath = z.string().trim().min(1, "Enter the custom browser executable path.").parse(formData.get("customExecutablePath"));
  else {
    const installation = (await discoverInstalledChromiumBrowsers()).find((browser) => browser.id === selectedId);
    if (!installation) throw new Error("That browser is not currently detected on this device.");
    executablePath = installation.executablePath;
  }
  executablePath = await validateChromiumExecutable(executablePath);
  const config = loadConfig();
  const identityRepository = new BrowserIdentityRepository(prisma);
  const identityCount = await prisma.browserIdentity.count({ where: { role } });
  const identity = await identityRepository.create({
    role,
    label: `${role === "COLLECTOR" ? "Collector" : "Publisher"} ${identityCount + 1}`,
    browserId: selectedId,
    executablePath,
    profileRoot: resolve(config.repositoryRoot, "storage", "browser-profiles"),
  });
  const profilePath = resolve(config.repositoryRoot, identity.profilePath);
  await mkdir(profilePath, { recursive: true });
  await openChromiumProfile(executablePath, profilePath, identity.profileDirectory ?? undefined);
  refresh("/settings", "/sources", "/review", "/");
  redirect(`/settings?profileOpened=${encodeURIComponent(identity.id)}`);
}

export async function openIdentityLogin(formData: FormData) {
  const identityId = id.parse(formData.get("identityId"));
  const repository = new BrowserIdentityRepository(prisma);
  const identity = await repository.find(identityId);
  if (!identity || !identity.enabled) throw new Error("This browser identity is unavailable.");
  const activeLock = await prisma.schedulerLock.findUnique({ where: { name: identityLeaseName(identity.id) } });
  if (activeLock && activeLock.lockedUntil > new Date()) throw new Error("This identity is busy with another browser operation.");
  const executablePath = identity.executablePath ?? (await discoverInstalledChromiumBrowsers()).find((browser) => browser.id === identity.browserId)?.executablePath;
  if (!executablePath) throw new Error("The configured browser executable was not found.");
  await repository.clearVerification(identity.id);
  const profilePath = resolve(loadConfig().repositoryRoot, identity.profilePath);
  await mkdir(profilePath, { recursive: true });
  await openChromiumProfile(executablePath, profilePath, identity.profileDirectory ?? undefined);
  refresh("/settings", "/");
  redirect(`/settings?profileOpened=${encodeURIComponent(identity.id)}`);
}

export async function addIdentityProfile(formData: FormData) {
  const identityId = id.parse(formData.get("identityId"));
  const expectedUsername = username.parse(formData.get("expectedUsername"));
  const repository = new BrowserIdentityRepository(prisma);
  const identity = await repository.find(identityId);
  if (!identity || !identity.enabled) throw new Error("This browser identity is unavailable.");
  const activeLock = await prisma.schedulerLock.findUnique({ where: { name: identityLeaseName(identity.id) } });
  if (activeLock && activeLock.lockedUntil > new Date()) throw new Error("This identity is busy with another browser operation.");
  const executablePath = identity.executablePath ?? (await discoverInstalledChromiumBrowsers()).find((browser) => browser.id === identity.browserId)?.executablePath;
  if (!executablePath) throw new Error("The configured browser executable was not found. Choose another browser in technical settings.");
  await prisma.browserIdentity.update({ where: { id: identity.id }, data: { expectedUsername: expectedUsername.toLowerCase(), verifiedAt: null, verifiedUsername: null, verifiedFingerprint: null, verificationError: null, profileDeletedAt: null } });
  const profilePath = resolve(loadConfig().repositoryRoot, identity.profilePath);
  await mkdir(profilePath, { recursive: true });
  await openChromiumProfile(executablePath, profilePath, identity.profileDirectory ?? undefined);
  refresh("/settings", "/");
  redirect(`/settings?profileOpened=${encodeURIComponent(identity.id)}`);
}

export async function updateIdentityBrowser(formData: FormData) {
  const identityId = id.parse(formData.get("identityId"));
  const selectedId = browserId.parse(formData.get("browserId"));
  let executablePath: string;
  if (selectedId === "custom") executablePath = z.string().trim().min(1, "Enter the custom browser executable path.").parse(formData.get("customExecutablePath"));
  else {
    const installation = (await discoverInstalledChromiumBrowsers()).find((browser) => browser.id === selectedId);
    if (!installation) throw new Error("That browser is not currently detected on this device.");
    executablePath = installation.executablePath;
  }
  executablePath = await validateChromiumExecutable(executablePath);
  const config = loadConfig();
  const lease = new DatabaseExclusiveLease(new SchedulerRepository(prisma), identityLeaseName(identityId), Math.max(config.workerLockTimeoutMinutes, 10) * 60_000);
  await lease.run(() => new BrowserIdentityRepository(prisma).updateBinding(identityId, selectedId, executablePath));
  refresh("/settings", "/");
}

export async function checkIdentitySession(formData: FormData) {
  const identityId = id.parse(formData.get("identityId"));
  const repository = new BrowserIdentityRepository(prisma);
  const identity = await repository.find(identityId);
  if (!identity) throw new Error("This browser identity is not configured.");
  const config = applyStoredSettings(loadConfig(), await new SettingsRepository(prisma).getAll());
  const lease = new DatabaseExclusiveLease(new SchedulerRepository(prisma), identityLeaseName(identity.id), Math.max(config.workerLockTimeoutMinutes, 10) * 60_000);
  const profilePath = resolve(config.repositoryRoot, identity.profilePath);
  const logger = pino({ level: "silent" });
  try {
    const account = identity.role === "COLLECTOR"
      ? await new PlaywrightTimelineBrowser({ headless: false, browserId: identity.browserId as typeof config.collectorBrowserId, browserExecutablePath: identity.executablePath ?? undefined, repositoryRoot: config.repositoryRoot, profileDirectory: profilePath, browserProfileDirectory: identity.profileDirectory ?? undefined, lease, diagnosticsDirectory: config.logStoragePath }, logger).checkSession()
      : await new XPlaywrightPublisher({ repositoryRoot: config.repositoryRoot, profileDirectory: profilePath, browserId: identity.browserId as typeof config.publisherBrowserId, browserExecutablePath: identity.executablePath ?? undefined, browserProfileDirectory: identity.profileDirectory ?? undefined, lease, diagnosticsDirectory: config.logStoragePath, headless: false }, logger).checkSession();
    const normalizedAccount = account?.replace(/^@/, "").toLowerCase();
    if (!normalizedAccount) throw new Error("The active X username could not be detected.");
    if (identity.expectedUsername && normalizedAccount !== identity.expectedUsername) throw new Error(`This profile is signed into @${normalizedAccount}, not @${identity.expectedUsername}.`);
    await repository.setVerification(identity.id, normalizedAccount, identityFingerprint(identity));
  } catch (error) {
    const detail = error instanceof Error ? error.message.split("\n").find((line) => line.trim())?.trim() : null;
    await repository.setVerificationError(identity.id, error instanceof ResourceBusyError ? "Close this identity's browser window, then verify again." : detail || "Session verification failed.");
  }
  refresh("/settings", "/");
}

export async function toggleBrowserIdentity(formData: FormData) {
  const identityId = id.parse(formData.get("identityId"));
  const enabled = z.enum(["true", "false"]).transform((value) => value === "true").parse(formData.get("enabled"));
  await new BrowserIdentityRepository(prisma).setEnabled(identityId, enabled);
  refresh("/settings", "/sources", "/review", "/");
}

export async function toggleIdentityAutomatic(formData: FormData) {
  const identityId = id.parse(formData.get("identityId"));
  const automatic = z.enum(["true", "false"]).transform((value) => value === "true").parse(formData.get("automatic"));
  await new BrowserIdentityRepository(prisma).setAutomatic(identityId, automatic);
  refresh("/settings", "/");
}

export async function updateIdentityDailyLimit(formData: FormData) {
  const identityId = id.parse(formData.get("identityId"));
  const rawLimit = String(formData.get("dailyPostLimit") ?? "").trim();
  const dailyPostLimit = rawLimit === "" ? null : z.coerce.number().int().min(1).max(200).parse(rawLimit);
  await prisma.browserIdentity.update({ where: { id: identityId }, data: { dailyPostLimit } });
  refresh("/settings", "/");
}

export async function deleteIdentityProfile(formData: FormData) {
  const identityId = id.parse(formData.get("identityId"));
  const repository = new BrowserIdentityRepository(prisma);
  const identity = await repository.find(identityId);
  if (!identity) throw new Error("Browser identity no longer exists.");
  const config = loadConfig();
  const lease = new DatabaseExclusiveLease(new SchedulerRepository(prisma), identityLeaseName(identity.id), Math.max(config.workerLockTimeoutMinutes, 10) * 60_000);
  const managedRoleRoot = resolve(config.repositoryRoot, "storage", "browser-profiles", identity.role === "COLLECTOR" ? "collector" : "publisher");
  if (!inside(managedRoleRoot, resolve(config.repositoryRoot, identity.profilePath))) throw new Error("Legacy browser profiles are preserved and cannot be deleted from this action. Create a managed identity or remove the legacy profile manually.");
  const result = await lease.run(() => new BrowserProfileRemovalService(config.repositoryRoot).removeIdentity(identity.role === "COLLECTOR" ? "collector" : "publisher", basename(identity.profilePath)));
  if (result.status === "failed" || result.status === "residual") throw new Error(result.error ?? "The browser profile could not be fully deleted.");
  await repository.clearVerification(identity.id, new Date());
  await prisma.browserIdentity.update({ where: { id: identity.id }, data: { expectedUsername: null, enabled: false, automaticEnabled: false } });
  refresh("/settings", "/");
  redirect(`/settings?profileDeleted=${encodeURIComponent(identity.id)}`);
}

export async function deleteIdentityPermanently(formData: FormData) {
  const identityId = id.parse(formData.get("identityId"));
  const confirmation = z.string().parse(formData.get("confirmation")).trim();
  const repository = new BrowserIdentityRepository(prisma);
  const identity = await repository.find(identityId);
  if (!identity) throw new Error("Browser identity no longer exists.");
  if (confirmation !== `DELETE ${identity.label}`) throw new Error(`Type DELETE ${identity.label} to confirm.`);
  const config = loadConfig();
  const activeWork = await prisma.publishJob.count({ where: { publisherIdentityId: identityId, status: "RUNNING" } });
  if (activeWork > 0) throw new Error("This identity has running publication work. Stop it before deleting.");
  const lease = new DatabaseExclusiveLease(new SchedulerRepository(prisma), identityLeaseName(identity.id), Math.max(config.workerLockTimeoutMinutes, 10) * 60_000);
  const removal = await lease.run(() => new BrowserProfileRemovalService(config.repositoryRoot).removeIdentity(identity.role === "COLLECTOR" ? "collector" : "publisher", basename(identity.profilePath)));
  if (removal.status === "failed" || removal.status === "residual") throw new Error(removal.error ?? "The browser profile could not be fully deleted.");
  await prisma.$transaction([
    prisma.publishJob.updateMany({ where: { publisherIdentityId: identityId }, data: { publisherIdentityId: null } }),
    prisma.schedulerLock.deleteMany({ where: { name: identityLeaseName(identityId) } }),
    prisma.browserIdentity.delete({ where: { id: identityId } }),
  ]);
  refresh("/settings", "/", "/queue", "/review", "/published");
  redirect(`/settings?identityDeleted=${encodeURIComponent(identity.id)}`);
}

async function withIdentityLeases<T>(identityIds: string[], operation: () => Promise<T>): Promise<T> {
  const config = loadConfig();
  const leases = identityIds.sort().map((identityId) => new DatabaseExclusiveLease(new SchedulerRepository(prisma), identityLeaseName(identityId), Math.max(config.workerLockTimeoutMinutes, 10) * 60_000));
  const run = (index: number): Promise<T> => index >= leases.length ? operation() : leases[index].run(() => run(index + 1));
  return run(0);
}

export async function clearAllBrowserProfiles(formData: FormData) {
  if (z.string().parse(formData.get("confirmation")).trim() !== "DELETE ALL PROFILES") throw new Error('Type "DELETE ALL PROFILES" to confirm.');
  const identities = await prisma.browserIdentity.findMany({ select: { id: true } });
  const outcomes = await withIdentityLeases(identities.map((identity) => identity.id), () => new BrowserProfileRemovalService(loadConfig().repositoryRoot).clearAll());
  const failed = outcomes.filter((outcome) => outcome.status === "failed" || outcome.status === "residual");
  if (failed.length > 0) throw new Error(`Some browser profiles could not be deleted: ${failed.map((outcome) => outcome.role).join(", ")}`);
  await prisma.browserIdentity.updateMany({ data: { expectedUsername: null, verifiedUsername: null, verifiedAt: null, verifiedFingerprint: null, verificationError: null, profileDeletedAt: new Date(), enabled: false, automaticEnabled: false } });
  await new SettingsRepository(prisma).deleteMany([...browserSessionKeys("collector"), ...browserSessionKeys("publisher")]);
  refresh("/settings", "/");
  redirect(`/settings?allProfilesDeleted=${identities.length}`);
}

export async function assignSourceCollector(formData: FormData) {
  const sourceId = id.parse(formData.get("sourceId"));
  const raw = formData.get("collectorIdentityId");
  const collectorIdentityId = raw === null || String(raw).trim() === "" ? null : id.parse(raw);
  if (collectorIdentityId) {
    const collector = await prisma.browserIdentity.findFirst({ where: { id: collectorIdentityId, role: "COLLECTOR" } });
    if (!collector) throw new Error("Choose an existing Collector identity.");
  }
  await prisma.sourceAccount.update({ where: { id: sourceId }, data: { collectorIdentityId } });
  refresh("/sources");
}

export async function saveSettings(formData: FormData) {
  const timezone = z.string().min(1).parse(formData.get("timezone"));
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }); } catch { throw new Error("Enter a valid IANA timezone such as Asia/Jakarta."); }
  const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
  const starts = formData.getAll("scheduleActiveStart").map(String).filter(Boolean);
  const ends = formData.getAll("scheduleActiveEnd").map(String).filter(Boolean);
  if (starts.length === 0 || starts.length !== ends.length) throw new Error("Each active window needs a start and end time.");
  if (starts.length > 2) throw new Error("At most 2 active windows are supported.");
  const windows: Array<{ start: string; end: string }> = [];
  for (let i = 0; i < starts.length; i += 1) {
    if (!timeRe.test(starts[i])) throw new Error(`Window ${i + 1} start must be HH:MM.`);
    if (!timeRe.test(ends[i])) throw new Error(`Window ${i + 1} end must be HH:MM.`);
    if (starts[i] === ends[i]) throw new Error(`Window ${i + 1} start and end must be different times.`);
    windows.push({ start: starts[i], end: ends[i] });
  }
  if (windows.length === 2) {
    const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    const aStart = toMin(windows[0].start);
    const aEnd = toMin(windows[0].end) <= aStart ? toMin(windows[0].end) + 1440 : toMin(windows[0].end);
    const bStart = toMin(windows[1].start);
    const bEnd = toMin(windows[1].end) <= bStart ? toMin(windows[1].end) + 1440 : toMin(windows[1].end);
    if (aStart < bEnd && bStart < aEnd) throw new Error("Active windows must not overlap.");
  }
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
    SCHEDULE_ACTIVE_START: windows[0].start,
    SCHEDULE_ACTIVE_END: windows[0].end,
    SCHEDULE_ACTIVE_WINDOWS: JSON.stringify(windows),
    SCHEDULE_JITTER_MINUTES: String(z.coerce.number().int().min(0).max(120).parse(formData.get("scheduleJitterMinutes"))),
    SCHEDULE_MIN_GAP_MINUTES: String(z.coerce.number().int().min(0).max(180).parse(formData.get("scheduleMinGapMinutes"))),
    APP_TIMEZONE: timezone,
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

export async function saveReviewSettings(formData: FormData) {
  await new SettingsRepository(prisma).setMany({ REVIEW_VIDEO_PREVIEW_ENABLED: z.enum(["true", "false"]).parse(formData.get("videoPreviewEnabled")) });
  refresh("/settings", "/review");
  redirect("/settings?reviewSaved=1");
}

export async function saveNotificationSettings(formData: FormData) {
  const config = applyStoredSettings(loadConfig(), await new SettingsRepository(prisma).getAll());
  const enabled = z.enum(["true", "false"]).parse(formData.get("notificationsEnabled"));
  const chatId = z.string().trim().parse(formData.get("telegramChatId") ?? "");
  if (enabled === "true" && !config.telegramBotToken && !config.discordBotToken) throw new Error("Add a Telegram or Discord bot token to .env before enabling notifications.");
  await new SettingsRepository(prisma).setMany({ NOTIFICATIONS_ENABLED: enabled, TELEGRAM_CHAT_ID: chatId });
  refresh("/settings");
  redirect("/settings?notificationsSaved=1");
}

export async function saveDiscordNotificationSettings(formData: FormData) {
  const config = applyStoredSettings(loadConfig(), await new SettingsRepository(prisma).getAll());
  const enabled = z.enum(["true", "false"]).parse(formData.get("discordNotificationsEnabled"));
  if (enabled === "true" && (!config.discordBotToken || !config.discordOwnerId)) throw new Error("Set DISCORD_BOT_TOKEN and DISCORD_OWNER_ID in .env before enabling Discord notifications.");
  await new SettingsRepository(prisma).setMany({ NOTIFICATIONS_DISCORD_ENABLED: enabled });
  refresh("/settings");
  redirect("/settings?discordNotificationsSaved=1");
}

export async function sendTestNotification() {
  const config = applyStoredSettings(loadConfig(), await new SettingsRepository(prisma).getAll());
  const stored = await new SettingsRepository(prisma).getAll();
  if (!config.telegramBotToken) throw new Error("Add TELEGRAM_BOT_TOKEN to .env to send a test message.");
  const chatId = stored.TELEGRAM_CHAT_ID;
  if (!chatId) throw new Error("Set the Telegram chat ID before sending a test message.");
  const transport = new TelegramTransport(config.telegramBotToken);
  const result = await transport.send(chatId, "Cenblue test message — notifications are working.");
  refresh("/settings");
  if (result.ok) redirect("/settings?notificationTest=delivered");
  redirect(`/settings?notificationTest=error&notificationTestError=${encodeURIComponent(result.error ?? "The test message could not be delivered.")}`);
}

export async function sendDiscordTestNotification() {
  const config = applyStoredSettings(loadConfig(), await new SettingsRepository(prisma).getAll());
  if (!config.discordBotToken || !config.discordOwnerId) throw new Error("Set DISCORD_BOT_TOKEN and DISCORD_OWNER_ID in .env to send a test message.");
  const result = await new DiscordDmTransport().send(config.discordOwnerId, "Cenblue test message — notifications are working.");
  refresh("/settings");
  if (result.ok) redirect("/settings?discordNotificationTest=delivered");
  redirect(`/settings?discordNotificationTest=error&discordNotificationTestError=${encodeURIComponent(result.error ?? "The test message could not be delivered.")}`);
}

export async function verifyNotificationConnection() {
  const config = applyStoredSettings(loadConfig(), await new SettingsRepository(prisma).getAll());
  const stored = await new SettingsRepository(prisma).getAll();
  if (!config.telegramBotToken) throw new Error("Add TELEGRAM_BOT_TOKEN to .env before verifying the connection.");
  const transport = new TelegramTransport(config.telegramBotToken);
  const bot = await transport.getMe();
  if (!bot.ok) {
    refresh("/settings");
    redirect(`/settings?notificationVerify=tokenError&notificationVerifyError=${encodeURIComponent(bot.error ?? "The bot token could not be validated.")}`);
  }
  const query = new URLSearchParams({ notificationVerify: "ok", botUsername: bot.username ?? "", botName: bot.name ?? "" });
  const chatId = stored.TELEGRAM_CHAT_ID;
  if (chatId) {
    const chat = await transport.getChat(chatId);
    if (chat.ok) {
      query.set("chatTitle", chat.title ?? "");
      query.set("notificationVerify", "all");
    } else {
      query.set("chatError", encodeURIComponent(chat.error ?? "The chat ID could not be validated."));
      query.set("notificationVerify", "chatError");
    }
  } else {
    query.set("notificationVerify", "noChat");
  }
  refresh("/settings");
  redirect(`/settings?${query}`);
}

export async function simulatePublishedPost() {
  const config = applyStoredSettings(loadConfig(), await new SettingsRepository(prisma).getAll());
  const emitter = await buildNotificationEmitter(config);
  const settings = await notificationSettings(config);
  const emitted = emitter ? await emitter.emitPublishedPost({
    jobId: `simulated-${Date.now()}`,
    platformPostId: `SIMULATED-${Date.now()}`,
    publisherIdentityId: null,
    platformUrl: null,
  }, settings) : false;
  refresh("/published");
  if (emitted) redirect("/published?publishTest=queued");
  redirect("/published?publishTest=error");
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
    const publisherIdentityIds = z.array(id).min(1, "Select at least one Publisher identity.").parse(formData.getAll("publisherIdentityId"));
    const identities = await prisma.browserIdentity.findMany({ where: { id: { in: publisherIdentityIds }, role: "PUBLISHER", enabled: true } });
    if (identities.length !== new Set(publisherIdentityIds).size) throw new Error("One or more Publisher identities are unavailable.");
    const logger = pino({ level: "silent" });
    for (const identity of identities) {
      if (!identity.expectedUsername || !identity.verifiedAt || identity.verifiedUsername !== identity.expectedUsername || identity.verifiedFingerprint !== identityFingerprint(identity)) throw new Error(`${identity.label} must be verified before publishing.`);
      const browserLease = new DatabaseExclusiveLease(new SchedulerRepository(prisma), identityLeaseName(identity.id), Math.max(config.workerLockTimeoutMinutes, 10) * 60_000);
      const capacityLease = new DatabaseExclusiveLease(new SchedulerRepository(prisma), "publisher-capacity:1", Math.max(config.workerLockTimeoutMinutes, 10) * 60_000);
      const publisher = new XPlaywrightPublisher({ repositoryRoot: config.repositoryRoot, profileDirectory: resolve(config.repositoryRoot, identity.profilePath), browserId: identity.browserId as typeof config.publisherBrowserId, browserExecutablePath: identity.executablePath ?? undefined, browserProfileDirectory: identity.profileDirectory ?? undefined, lease: combineExclusiveLeases(capacityLease, browserLease), diagnosticsDirectory: config.logStoragePath, headless: config.playwrightHeadless, minUploadMbps: config.publishMinUploadMbps, maxUploadTimeoutMs: config.publishMaxUploadMinutes * 60_000, expectedUsername: identity.expectedUsername }, logger);
      const manualId = `manual-${identity.id}-${Date.now()}`;
      const result = await publisher.publish({ jobId: manualId, platformPostId: manualId, mediaPath: imagePath, mediaKind: hasImage ? "image" : null, caption, fileSize: hasImage ? image.size : 0, durationSeconds: 0, width: 0, height: 0, codec: null });
      publishedUrl ??= result.platformUrl;
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  } finally {
    if (imagePath) await rm(imagePath, { force: true }).catch(() => undefined);
  }
  if (errorMessage) redirect(`/compose?error=${encodeURIComponent(errorMessage)}`);
  redirect(`/compose?published=1${publishedUrl ? `&url=${encodeURIComponent(publishedUrl)}` : ""}`);
}
