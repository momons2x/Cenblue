import "server-only";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { loadConfig } from "@cenblu/config";
import { prisma, SettingsRepository } from "@cenblu/database";

export async function getOverview() {
  const [enabledSources, recentlyCollected, pendingDownloads, failedDownloads, scheduledPublishes, failedPublishes, recentPublished, lastSource, collectionRun, collectorBrowserLock, publisherBrowserLock, runtime, settings, publishedForGoal] = await Promise.all([
    prisma.sourceAccount.count({ where: { enabled: true } }),
    prisma.sourcePost.count({ where: { collectedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
    prisma.downloadJob.count({ where: { status: { in: ["PENDING", "RUNNING", "RETRY_WAIT"] } } }),
    prisma.downloadJob.count({ where: { status: "FAILED" } }),
    prisma.publishJob.count({ where: { status: { in: ["APPROVED", "RETRY_WAIT", "RUNNING"] } } }),
    prisma.publishJob.count({ where: { status: { in: ["FAILED", "MANUAL_ATTENTION"] } } }),
    prisma.publishedPost.findMany({ take: 5, orderBy: { publishedAt: "desc" }, include: { publishJob: { include: { sourcePost: true } } } }),
    prisma.sourceAccount.findFirst({ orderBy: { lastCollectedAt: "desc" }, select: { lastCollectedAt: true } }),
    prisma.collectionRun.findFirst({ orderBy: { startedAt: "desc" } }),
    prisma.schedulerLock.findUnique({ where: { name: "x-collector-profile" } }),
    prisma.schedulerLock.findUnique({ where: { name: "x-publisher-profile" } }),
    prisma.runtimeStatus.findMany({ orderBy: { updatedAt: "desc" } }),
    new SettingsRepository(prisma).getAll(),
    prisma.publishedPost.findMany({ where: { publishedAt: { gte: new Date(Date.now() - 48 * 60 * 60_000) } }, select: { publishedAt: true } }),
  ]);
  const config = loadConfig();
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone }).format(new Date());
  const todayPosts = publishedForGoal.filter((post) => new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone }).format(post.publishedAt) === day).length;
  const dailyMinimum = Number(settings.DAILY_POST_MINIMUM ?? 2);
  const dailyPreferred = Number(settings.DAILY_POST_PREFERRED ?? 3);
  const collectorBrowserBusy = Boolean(collectorBrowserLock && collectorBrowserLock.lockedUntil > new Date());
  const publisherBrowserBusy = Boolean(publisherBrowserLock && publisherBrowserLock.lockedUntil > new Date());
  return { enabledSources, recentlyCollected, pendingDownloads, failedDownloads, scheduledPublishes, failedPublishes, recentPublished, lastCollectedAt: lastSource?.lastCollectedAt ?? null, collectionRun, browserBusy: collectorBrowserBusy || publisherBrowserBusy, collectorBrowserBusy, publisherBrowserBusy, runtime, todayPosts, dailyMinimum, dailyPreferred };
}

export async function getSources() {
  return prisma.sourceAccount.findMany({ where: { managedSource: true }, orderBy: { createdAt: "asc" }, include: { _count: { select: { posts: true } } } });
}

export async function getQueue(filters: { status?: string; source?: string; page?: number } = {}) {
  const status = filters.status?.trim() || undefined;
  const source = filters.source?.trim().toLowerCase() || undefined;
  const page = Math.max(filters.page ?? 1, 1);
  const take = 50;
  const sourcePost = source ? { sourceAccount: { username: source } } : undefined;
  const [downloads, publishes, sources, downloadStatuses, publishStatuses] = await Promise.all([
    prisma.downloadJob.findMany({ where: { ...(status ? { status } : {}), ...(sourcePost ? { sourcePost } : {}) }, take, skip: (page - 1) * take, orderBy: { updatedAt: "desc" }, include: { sourcePost: { include: { sourceAccount: true, mediaAsset: true } } } }),
    prisma.publishJob.findMany({ where: { ...(status ? { status } : {}), ...(sourcePost ? { sourcePost } : {}) }, take, skip: (page - 1) * take, orderBy: [{ scheduledFor: "asc" }, { updatedAt: "desc" }], include: { sourcePost: { include: { sourceAccount: true } }, mediaAsset: true } }),
    prisma.sourceAccount.findMany({ where: { archivedAt: null }, orderBy: { username: "asc" }, select: { username: true } }),
    prisma.downloadJob.findMany({ distinct: ["status"], select: { status: true } }),
    prisma.publishJob.findMany({ distinct: ["status"], select: { status: true } }),
  ]);
  const canonicalStatuses = ["PENDING", "READY_FOR_REVIEW", "APPROVED", "RUNNING", "RETRY_WAIT", "MANUAL_ATTENTION", "COMPLETED", "FAILED", "CANCELLED", "REJECTED"];
  const persistedStatuses = [...downloadStatuses, ...publishStatuses].map((item) => item.status);
  const statuses = [...new Set([...canonicalStatuses, ...persistedStatuses])];
  return { downloads, publishes, sources, statuses, page };
}

export async function getDownloads(source?: string) {
  const username = source?.trim().toLowerCase();
  return prisma.mediaAsset.findMany({ where: username ? { sourcePost: { sourceAccount: { username } } } : undefined, orderBy: { createdAt: "desc" }, include: { sourcePost: { include: { sourceAccount: true, downloadJob: true, publishJob: { include: { publishedPost: true } } } } } });
}

export async function getDownloadSources() {
  return prisma.sourceAccount.findMany({ where: { posts: { some: { mediaAsset: { isNot: null } } } }, orderBy: { username: "asc" }, select: { username: true } });
}

export async function getPublished() {
  return prisma.publishedPost.findMany({ orderBy: { publishedAt: "desc" }, include: { publishJob: { include: { sourcePost: true, mediaAsset: true } } } });
}

export async function getSettings() {
  const [stored, collectorBrowserLock, publisherBrowserLock] = await Promise.all([
    new SettingsRepository(prisma).getAll(),
    prisma.schedulerLock.findUnique({ where: { name: "x-collector-profile" } }),
    prisma.schedulerLock.findUnique({ where: { name: "x-publisher-profile" } }),
  ]);
  const config = loadConfig();
  return {
    collectionIntervalMinutes: stored.COLLECTION_INTERVAL_MINUTES ?? String(config.collectionIntervalMinutes),
    postsPerSource: stored.POSTS_PER_SOURCE ?? String(config.postsPerSource),
    publishIntervalMinutes: stored.PUBLISH_INTERVAL_MINUTES ?? String(config.publishIntervalMinutes),
    headless: stored.PLAYWRIGHT_HEADLESS ?? String(config.playwrightHeadless),
    publishMode: stored.PUBLISH_MODE ?? config.publishMode,
    publishMinUploadMbps: stored.PUBLISH_MIN_UPLOAD_MBPS ?? String(config.publishMinUploadMbps),
    publishMaxUploadMinutes: stored.PUBLISH_MAX_UPLOAD_MINUTES ?? String(config.publishMaxUploadMinutes),
    downloadConcurrency: stored.DOWNLOAD_CONCURRENCY ?? String(config.downloadConcurrency),
    downloadBatchLimit: stored.DOWNLOAD_BATCH_LIMIT ?? String(config.downloadBatchLimit),
    sourceAccountLimit: stored.SOURCE_ACCOUNT_LIMIT ?? String(config.sourceAccountLimit),
    captionTemplates: stored.CAPTION_TEMPLATES ?? config.captionTemplates,
    dailyMinimum: stored.DAILY_POST_MINIMUM ?? "2",
    dailyPreferred: stored.DAILY_POST_PREFERRED ?? "3",
    repositoryRoot: config.repositoryRoot,
    browserChannel: config.playwrightBrowserChannel,
    collectorProfilePath: config.playwrightProfilePath,
    collectorProfileDirectory: config.playwrightProfileDirectory ?? "Profile root",
    collectorSessionVerifiedAt: stored.COLLECTOR_BROWSER_SESSION_VERIFIED_AT ?? null,
    collectorBrowserBusy: Boolean(collectorBrowserLock && collectorBrowserLock.lockedUntil > new Date()),
    publisherProfilePath: config.publisherProfilePath,
    publisherProfileDirectory: config.publisherProfileDirectory ?? "Profile root",
    publisherSessionVerifiedAt: stored.PUBLISHER_BROWSER_SESSION_VERIFIED_AT ?? null,
    publisherBrowserBusy: Boolean(publisherBrowserLock && publisherBrowserLock.lockedUntil > new Date()),
  };
}

export async function getResetPreview() {
  const [sources, posts, downloads, publishes, media, activeDownloads, activePublishes, activeCollections] = await Promise.all([
    prisma.sourceAccount.count(), prisma.sourcePost.count(), prisma.downloadJob.count(), prisma.publishJob.count(), prisma.mediaAsset.count(),
    prisma.downloadJob.count({ where: { status: "RUNNING" } }), prisma.publishJob.count({ where: { status: "RUNNING" } }), prisma.collectionRun.count({ where: { status: "RUNNING" } }),
  ]);
  return { sources, posts, downloads, publishes, media, active: activeDownloads + activePublishes + activeCollections };
}

export async function getReviewQueue(source?: string, sort = "oldest") {
  const username = source?.trim().toLowerCase();
  const [jobs, duplicates] = await Promise.all([prisma.publishJob.findMany({
    where: { status: { in: ["READY_FOR_REVIEW", "MANUAL_ATTENTION", "FAILED"] }, ...(username ? { sourcePost: { sourceAccount: { username } } } : {}) },
    orderBy: { updatedAt: "asc" },
    include: { sourcePost: { include: { sourceAccount: true, duplicateGroup: true } }, mediaAsset: true },
  }), prisma.sourcePost.findMany({
    where: { status: "SKIPPED", duplicateGroupId: { not: null }, publishJob: null, ...(username ? { sourceAccount: { username } } : {}) },
    orderBy: { updatedAt: "asc" },
    include: { sourceAccount: true, duplicateGroup: true, mediaAsset: true },
  })]);
  const tieBreak = (left: (typeof jobs)[number], right: (typeof jobs)[number]) => left.updatedAt.getTime() - right.updatedAt.getTime();
  jobs.sort((left, right) => {
    let difference = 0;
    if (sort === "newest") difference = right.updatedAt.getTime() - left.updatedAt.getTime();
    else if (sort === "largest") difference = right.mediaAsset.fileSize - left.mediaAsset.fileSize;
    else if (sort === "smallest") difference = left.mediaAsset.fileSize - right.mediaAsset.fileSize;
    else if (sort === "longest") difference = right.mediaAsset.durationSeconds - left.mediaAsset.durationSeconds;
    else if (sort === "shortest") difference = left.mediaAsset.durationSeconds - right.mediaAsset.durationSeconds;
    else if (sort === "caption-longest") difference = Array.from(right.caption).length - Array.from(left.caption).length;
    else if (sort === "caption-shortest") difference = Array.from(left.caption).length - Array.from(right.caption).length;
    else if (sort === "source-az") difference = left.sourcePost.sourceAccount.username.localeCompare(right.sourcePost.sourceAccount.username);
    else if (sort === "source-za") difference = right.sourcePost.sourceAccount.username.localeCompare(left.sourcePost.sourceAccount.username);
    else difference = tieBreak(left, right);
    return difference || tieBreak(left, right);
  });
  const sources = await prisma.sourceAccount.findMany({ where: { posts: { some: { OR: [{ publishJob: { is: { status: { in: ["READY_FOR_REVIEW", "MANUAL_ATTENTION", "FAILED"] } } } }, { duplicateGroupId: { not: null }, status: "SKIPPED" }] } } }, orderBy: { username: "asc" }, select: { username: true } });
  return { jobs, duplicates, sources };
}

function levelName(value: unknown): string {
  if (typeof value === "string") return value.toUpperCase();
  if (typeof value !== "number") return "INFO";
  if (value >= 50) return "ERROR";
  if (value >= 40) return "WARN";
  if (value >= 30) return "INFO";
  return "DEBUG";
}

export async function getLogs(filters: { level?: string; component?: string } = {}) {
  const directory = resolve(loadConfig().logStoragePath);
  try {
    const names = await readdir(directory);
    const ordered = await Promise.all(names.map(async (name) => ({ name, modified: (await stat(resolve(directory, name))).mtimeMs })));
    ordered.sort((left, right) => right.modified - left.modified);
    const logNames = ordered.map((entry) => entry.name).filter((name) => /\.(log|json)(\.\d+)?$/i.test(name));
    const images = ordered.map((entry) => entry.name).filter((name) => /\.(png|jpe?g|webp)$/i.test(name)).slice(0, 20);
    const entries: { file: string; level: string; component: string; operation: string | null; message: string; timestamp: string | null }[] = [];
    for (const name of logNames.slice(0, 5)) {
      const content = await readFile(resolve(directory, name), "utf8");
      for (const line of content.slice(-20_000).split("\n")) {
        if (!line.trim()) continue;
        try {
          const parsed: Record<string, unknown> = JSON.parse(line);
          const level = levelName(parsed.level);
          const component = typeof parsed.component === "string" ? parsed.component : name.replace(/\.log.*$/i, "");
          if (filters.level && filters.level !== level) continue;
          if (filters.component && filters.component !== component) continue;
          entries.push({ file: name, level, component, operation: typeof parsed.operation === "string" ? parsed.operation : null, message: typeof parsed.msg === "string" ? parsed.msg : line, timestamp: typeof parsed.time === "string" ? parsed.time : null });
        } catch { entries.push({ file: name, level: "INFO", component: name, operation: null, message: line, timestamp: null }); }
      }
    }
    return { entries: entries.slice(-250).reverse(), images, components: [...new Set(entries.map((entry) => entry.component))].sort() };
  } catch { return { entries: [], images: [], components: [] }; }
}

export type VideoFileEntry = { sourcePostId: string; platformPostId: string; fileName: string; fileSize: number; sourceUsername: string | null; sourceUrl: string | null; caption: string | null; status: string; running: boolean };
export async function getVideoFiles(): Promise<VideoFileEntry[]> {
  const storage = loadConfig().videoStoragePath;
  let names: string[];
  try { names = await readdir(storage); } catch { return []; }
  const mp4Files = names.filter((name) => extname(name).toLowerCase() === ".mp4").sort().reverse();
  const postIds = mp4Files.map((name) => name.slice(0, -4));
  const assets = await prisma.mediaAsset.findMany({
    where: { sourcePost: { platformPostId: { in: postIds } }, localRemovedAt: null },
    include: { sourcePost: { select: { id: true, platformPostId: true, sourceUrl: true, text: true, status: true, downloadJob: { select: { status: true } }, publishJob: { select: { status: true, publishedPost: { select: { id: true } } } }, sourceAccount: { select: { username: true } } } } },
  });
  const assetMap = new Map(assets.map((asset) => [asset.sourcePost.platformPostId, asset]));
  const results: VideoFileEntry[] = [];
  for (const name of mp4Files) {
    const platformPostId = name.slice(0, -4);
    const fullPath = resolve(storage, name);
    const asset = assetMap.get(platformPostId);
    if (!asset) continue;
    let fileSize: number;
    try { fileSize = (await stat(fullPath)).size; } catch { continue; }
    const status = asset.sourcePost.publishJob?.publishedPost ? "PUBLISHED" : asset.sourcePost.publishJob?.status ?? asset.sourcePost.status;
    results.push({
      sourcePostId: asset.sourcePost.id,
      platformPostId,
      fileName: name,
      fileSize,
      sourceUsername: asset.sourcePost.sourceAccount.username,
      sourceUrl: asset.sourcePost.sourceUrl,
      caption: asset.sourcePost.text,
      status,
      running: asset.sourcePost.downloadJob?.status === "RUNNING" || ["RUNNING", "PUBLISHING"].includes(asset.sourcePost.publishJob?.status ?? "") || asset.sourcePost.status === "PUBLISHING",
    });
  }
  return results;
}
