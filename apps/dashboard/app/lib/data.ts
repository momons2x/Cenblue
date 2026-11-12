import "server-only";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { applyStoredSettings, browserBindingFingerprint, loadConfig } from "@cenblu/config";
import { NotificationOutboxRepository, prisma, SettingsRepository, type Prisma } from "@cenblu/database";
import { getActiveDiscordClient } from "@cenblu/discord-bot";
import { browserName, discoverInstalledChromiumBrowsers } from "@cenblu/publisher";

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
  const config = applyStoredSettings(loadConfig(), settings);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone }).format(new Date());
  const todayPosts = publishedForGoal.filter((post) => new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone }).format(post.publishedAt) === day).length;
  const dailyMinimum = Number(settings.DAILY_POST_MINIMUM ?? 2);
  const dailyPreferred = Number(settings.DAILY_POST_PREFERRED ?? 3);
  const collectorBrowserBusy = Boolean(collectorBrowserLock && collectorBrowserLock.lockedUntil > new Date());
  const publisherBrowserBusy = Boolean(publisherBrowserLock && publisherBrowserLock.lockedUntil > new Date());
  const [identities, identityLocks] = await Promise.all([
    prisma.browserIdentity.findMany({ orderBy: [{ role: "asc" }, { createdAt: "asc" }], select: { id: true, role: true, label: true, expectedUsername: true, enabled: true, automaticEnabled: true, verifiedAt: true, verifiedUsername: true } }),
    prisma.schedulerLock.findMany({ where: { name: { startsWith: "browser-profile:" }, lockedUntil: { gt: new Date() } }, select: { name: true } }),
  ]);
  const busyIds = new Set(identityLocks.map((lock) => lock.name.slice("browser-profile:".length)));
  const identityHealth = identities.map((identity) => ({ ...identity, verified: Boolean(identity.verifiedAt && identity.verifiedUsername && identity.verifiedUsername === identity.expectedUsername), busy: busyIds.has(identity.id) }));
  return { enabledSources, recentlyCollected, pendingDownloads, failedDownloads, scheduledPublishes, failedPublishes, recentPublished, lastCollectedAt: lastSource?.lastCollectedAt ?? null, collectionRun, browserBusy: collectorBrowserBusy || publisherBrowserBusy || busyIds.size > 0, collectorBrowserBusy, publisherBrowserBusy, runtime, todayPosts, dailyMinimum, dailyPreferred, timezone: config.timezone, identityHealth };
}

export async function getSources() {
  return prisma.sourceAccount.findMany({ where: { managedSource: true }, orderBy: { createdAt: "asc" }, include: { collectorIdentity: true, _count: { select: { posts: true } } } });
}

export async function getQueue(filters: { status?: string; source?: string; publisher?: string; page?: number } = {}) {
  const status = filters.status?.trim() || undefined;
  const source = filters.source?.trim().toLowerCase() || undefined;
  const page = Math.max(filters.page ?? 1, 1);
  const take = 50;
  const sourcePost = source ? { sourceAccount: { username: source } } : undefined;
  const downloadWhere: Prisma.DownloadJobWhereInput = { ...(status ? { status } : {}), ...(sourcePost ? { sourcePost } : {}) };
  const publishWhere: Prisma.PublishJobWhereInput = { ...(status ? { status } : {}), ...(sourcePost ? { sourcePost } : {}), ...(filters.publisher ? { publisherIdentityId: filters.publisher } : {}) };
  const [downloads, publishes, downloadTotal, publishTotal, actionableDownloads, actionablePublishes, sources, downloadStatuses, publishStatuses] = await Promise.all([
    prisma.downloadJob.findMany({ where: downloadWhere, take, skip: (page - 1) * take, orderBy: { updatedAt: "desc" }, include: { sourcePost: { include: { sourceAccount: true, mediaAsset: true } } } }),
    prisma.publishJob.findMany({ where: publishWhere, take, skip: (page - 1) * take, orderBy: [{ scheduledFor: "asc" }, { updatedAt: "desc" }], include: { sourcePost: { include: { sourceAccount: true } }, mediaAsset: true, publisherIdentity: true } }),
    prisma.downloadJob.count({ where: downloadWhere }),
    prisma.publishJob.count({ where: publishWhere }),
    prisma.downloadJob.count({ where: { ...downloadWhere, status: { in: ["PENDING", "FAILED", "RETRY_WAIT", "CANCELLED"] } } }),
    prisma.publishJob.count({ where: { ...publishWhere, status: { in: ["APPROVED", "RETRY_WAIT", "MANUAL_ATTENTION", "FAILED"] } } }),
    prisma.sourceAccount.findMany({ where: { archivedAt: null }, orderBy: { username: "asc" }, select: { username: true } }),
    prisma.downloadJob.findMany({ distinct: ["status"], select: { status: true } }),
    prisma.publishJob.findMany({ distinct: ["status"], select: { status: true } }),
  ]);
  const canonicalStatuses = ["PENDING", "READY_FOR_REVIEW", "APPROVED", "RUNNING", "RETRY_WAIT", "MANUAL_ATTENTION", "COMPLETED", "FAILED", "CANCELLED", "REJECTED"];
  const persistedStatuses = [...downloadStatuses, ...publishStatuses].map((item) => item.status);
  const statuses = [...new Set([...canonicalStatuses, ...persistedStatuses])];
  const publishers = await prisma.browserIdentity.findMany({ where: { role: "PUBLISHER" }, orderBy: { label: "asc" }, select: { id: true, label: true, expectedUsername: true } });
  return { downloads, publishes, sources, statuses, publishers, page, pageSize: take, downloadTotal, publishTotal, actionableDownloads, actionablePublishes };
}

export async function getDownloads(source?: string, page = 1) {
  const username = source?.trim().toLowerCase();
  const pageSize = 50;
  const current = Math.max(page, 1);
  const where = username ? { sourcePost: { sourceAccount: { username } } } : undefined;
  const [assets, total, eligible] = await Promise.all([
    prisma.mediaAsset.findMany({ where, orderBy: { createdAt: "desc" }, take: pageSize, skip: (current - 1) * pageSize, include: { sourcePost: { include: { sourceAccount: true, downloadJob: true, publishJobs: { include: { publishedPost: true, publisherIdentity: true } } } } } }),
    prisma.mediaAsset.count({ where }),
    prisma.sourcePost.count({ where: { status: "DOWNLOADED", mediaAsset: { is: { localRemovedAt: null } }, publishJobs: { none: {} }, ...(username ? { sourceAccount: { username } } : {}) } }),
  ]);
  return { assets, total, eligible, page: current, pageSize };
}

export async function getDownloadSources() {
  return prisma.sourceAccount.findMany({ where: { posts: { some: { mediaAsset: { isNot: null } } } }, orderBy: { username: "asc" }, select: { username: true } });
}

export async function getPublished(page = 1) {
  const pageSize = 24;
  const current = Math.max(page, 1);
  const [records, total] = await Promise.all([
    prisma.publishedPost.findMany({ orderBy: { publishedAt: "desc" }, take: pageSize, skip: (current - 1) * pageSize, include: { publishJob: { include: { sourcePost: true, mediaAsset: true, publisherIdentity: true } } } }),
    prisma.publishedPost.count(),
  ]);
  return { records, total, page: current, pageSize };
}

export async function getRuntimeSettings() {
  const [stored, identities] = await Promise.all([
    new SettingsRepository(prisma).getAll(),
    prisma.browserIdentity.findMany({ orderBy: [{ role: "asc" }, { createdAt: "asc" }], select: { id: true, role: true, label: true, expectedUsername: true, enabled: true, automaticEnabled: true, verifiedAt: true, verifiedUsername: true } }),
  ]);
  const config = applyStoredSettings(loadConfig(), stored);
  return {
    timezone: stored.APP_TIMEZONE ?? config.timezone,
    publishMode: stored.PUBLISH_MODE ?? config.publishMode,
    downloadBatchLimit: stored.DOWNLOAD_BATCH_LIMIT ?? String(config.downloadBatchLimit),
    postsPerSource: stored.POSTS_PER_SOURCE ?? String(config.postsPerSource),
    sourceAccountLimit: stored.SOURCE_ACCOUNT_LIMIT ?? String(config.sourceAccountLimit),
    scheduleActiveWindows: config.scheduleActiveWindows,
    scheduleJitterMinutes: stored.SCHEDULE_JITTER_MINUTES ?? String(config.scheduleJitterMinutes),
    scheduleMinGapMinutes: stored.SCHEDULE_MIN_GAP_MINUTES ?? String(config.scheduleMinGapMinutes),
    reviewVideoPreviewEnabled: stored.REVIEW_VIDEO_PREVIEW_ENABLED ?? "false",
    identities: identities.map((identity) => ({ ...identity, verified: Boolean(identity.verifiedAt && identity.verifiedUsername && identity.verifiedUsername === identity.expectedUsername) })),
  };
}

export async function getSettingsPage() {
  const [stored, collectorBrowserLock, publisherBrowserLock, installedBrowsers, identities] = await Promise.all([
    new SettingsRepository(prisma).getAll(),
    prisma.schedulerLock.findUnique({ where: { name: "x-collector-profile" } }),
    prisma.schedulerLock.findUnique({ where: { name: "x-publisher-profile" } }),
    discoverInstalledChromiumBrowsers(),
    prisma.browserIdentity.findMany({ orderBy: [{ role: "asc" }, { createdAt: "asc" }], include: { _count: { select: { assignedSources: true, publishJobs: true } } } }),
  ]);
  const config = applyStoredSettings(loadConfig(), stored);
  const collectorVerified = stored.COLLECTOR_BROWSER_SESSION_BINDING === browserBindingFingerprint(config, "collector");
  const publisherVerified = stored.PUBLISHER_BROWSER_SESSION_BINDING === browserBindingFingerprint(config, "publisher");
  const identityLocks = await prisma.schedulerLock.findMany({ where: { name: { startsWith: "browser-profile:" } }, select: { name: true, lockedUntil: true } });
  const lockByName = new Map(identityLocks.map((lock) => [lock.name, lock]));
  const identityCards = await Promise.all(identities.map(async (identity) => {
    const lock = lockByName.get(`browser-profile:${identity.id}`);
    const profilePath = resolve(config.repositoryRoot, identity.profilePath);
    const managedRoot = resolve(config.repositoryRoot, "storage", "browser-profiles");
    const managedRelative = relative(managedRoot, profilePath);
    return {
      ...identity,
      dailyPostLimit: identity.dailyPostLimit ?? null,
      profilePath,
      profilePresent: await stat(profilePath).then((entry) => entry.isDirectory()).catch(() => false),
      managed: managedRelative !== "" && !managedRelative.startsWith("..") && !managedRelative.includes(":"),
      busy: Boolean(lock && lock.lockedUntil > new Date()),
      verified: Boolean(identity.verifiedAt && identity.verifiedUsername && identity.verifiedUsername === identity.expectedUsername && identity.verifiedFingerprint),
    };
  }));
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
    reviewVideoPreviewEnabled: stored.REVIEW_VIDEO_PREVIEW_ENABLED ?? "false",
    timezone: stored.APP_TIMEZONE ?? config.timezone,
    dailyMinimum: stored.DAILY_POST_MINIMUM ?? "2",
    dailyPreferred: stored.DAILY_POST_PREFERRED ?? "3",
    scheduleActiveStart: stored.SCHEDULE_ACTIVE_START ?? config.scheduleActiveStart,
    scheduleActiveEnd: stored.SCHEDULE_ACTIVE_END ?? config.scheduleActiveEnd,
    scheduleActiveWindows: config.scheduleActiveWindows,
    scheduleJitterMinutes: stored.SCHEDULE_JITTER_MINUTES ?? String(config.scheduleJitterMinutes),
    scheduleMinGapMinutes: stored.SCHEDULE_MIN_GAP_MINUTES ?? String(config.scheduleMinGapMinutes),
    notificationsEnabled: stored.NOTIFICATIONS_ENABLED ?? "false",
    notificationOutbox: await new NotificationOutboxRepository(prisma).statusSummary(),
    notificationLastDeliveredAt: (await new NotificationOutboxRepository(prisma).latestDelivery())?.sentAt.toISOString() ?? null,
    notificationLastError: (await new NotificationOutboxRepository(prisma).latestFailure())?.error ?? null,
    discordNotificationsEnabled: stored.NOTIFICATIONS_DISCORD_ENABLED ?? "false",
    discordBotTokenConfigured: Boolean(config.discordBotToken),
    discordOwnerConfigured: Boolean(config.discordOwnerId),
    discordOwnerId: config.discordOwnerId ?? "",
    discordBotConnected: Boolean(getActiveDiscordClient()),
    repositoryRoot: config.repositoryRoot,
    installedBrowsers,
    identities: identityCards,
    collectorBrowserId: config.collectorBrowserId,
    collectorBrowserName: browserName(config.collectorBrowserId),
    collectorBrowserExecutablePath: config.collectorBrowserExecutablePath ?? "Not selected in dashboard",
    collectorProfilePath: config.playwrightProfilePath,
    collectorProfileDirectory: config.playwrightProfileDirectory ?? "Profile root",
    collectorSessionVerifiedAt: collectorVerified ? stored.COLLECTOR_BROWSER_SESSION_VERIFIED_AT ?? null : null,
    collectorSessionAccount: collectorVerified ? stored.COLLECTOR_BROWSER_SESSION_ACCOUNT || "Authenticated X account" : null,
    collectorSessionError: stored.COLLECTOR_BROWSER_SESSION_ERROR ?? null,
    collectorBrowserBusy: Boolean(collectorBrowserLock && collectorBrowserLock.lockedUntil > new Date()),
    publisherProfilePath: config.publisherProfilePath,
    publisherBrowserId: config.publisherBrowserId,
    publisherBrowserName: browserName(config.publisherBrowserId),
    publisherBrowserExecutablePath: config.publisherBrowserExecutablePath ?? "Not selected in dashboard",
    publisherProfileDirectory: config.publisherProfileDirectory ?? "Profile root",
    publisherSessionVerifiedAt: publisherVerified ? stored.PUBLISHER_BROWSER_SESSION_VERIFIED_AT ?? null : null,
    publisherSessionAccount: publisherVerified ? stored.PUBLISHER_BROWSER_SESSION_ACCOUNT || "Authenticated X account" : null,
    publisherSessionError: stored.PUBLISHER_BROWSER_SESSION_ERROR ?? null,
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

const reviewStatuses = ["READY_FOR_REVIEW", "MANUAL_ATTENTION", "FAILED"];
const reviewPageSize = 25;

function reviewOrder(sort: string | undefined): Prisma.PublishJobOrderByWithRelationInput {
  switch (sort) {
    case "newest": return { updatedAt: "desc" as const };
    case "post-newest": return { sourcePost: { postedAt: "desc" as const } };
    case "post-oldest": return { sourcePost: { postedAt: "asc" as const } };
    case "largest": return { mediaAsset: { fileSize: "desc" as const } };
    case "smallest": return { mediaAsset: { fileSize: "asc" as const } };
    case "longest": return { mediaAsset: { durationSeconds: "desc" as const } };
    case "shortest": return { mediaAsset: { durationSeconds: "asc" as const } };
    case "source-az": return { sourcePost: { sourceAccount: { username: "asc" as const } } };
    case "source-za": return { sourcePost: { sourceAccount: { username: "desc" as const } } };
    default: return { updatedAt: "asc" as const };
  }
}

export async function getReviewQueue(options: { source?: string; sort?: string; page?: number } = {}) {
  const username = options.source?.trim().toLowerCase();
  const sort = options.sort;
  const current = Math.max(options.page ?? 1, 1);
  const skip = (current - 1) * reviewPageSize;
  const where: Prisma.PublishJobWhereInput = { status: { in: reviewStatuses }, ...(username ? { sourcePost: { sourceAccount: { username } } } : {}) };
  const include = { sourcePost: { include: { sourceAccount: true, duplicateGroup: true } }, mediaAsset: true } satisfies Prisma.PublishJobInclude;
  type ReviewJob = Prisma.PublishJobGetPayload<{ include: typeof include }>;

  let jobs: ReviewJob[] = [];
  let total = 0;
  if (sort === "caption-longest" || sort === "caption-shortest") {
    const rows = await prisma.publishJob.findMany({ where, select: { id: true, caption: true } });
    const direction = sort === "caption-longest" ? -1 : 1;
    rows.sort((left, right) => direction * (Array.from(left.caption).length - Array.from(right.caption).length) || left.id.localeCompare(right.id));
    const pageIds = rows.slice(skip, skip + reviewPageSize).map((row) => row.id);
    const found = pageIds.length === 0 ? [] : await prisma.publishJob.findMany({ where: { id: { in: pageIds } }, include });
    const byId = new Map(found.map((job) => [job.id, job]));
    jobs = pageIds.map((id) => byId.get(id)).filter((job): job is ReviewJob => Boolean(job));
    total = rows.length;
  } else {
    const [found, count] = await Promise.all([
      prisma.publishJob.findMany({ where, orderBy: reviewOrder(sort), take: reviewPageSize, skip, include }),
      prisma.publishJob.count({ where }),
    ]);
    jobs = found;
    total = count;
  }

  const duplicateWhere = { status: "SKIPPED", duplicateGroupId: { not: null }, publishJobs: { none: {} }, ...(username ? { sourceAccount: { username } } : {}) };
  const [duplicates, duplicateTotal, sources, publishers] = await Promise.all([
    prisma.sourcePost.findMany({ where: duplicateWhere, orderBy: { updatedAt: "asc" }, take: 50, include: { sourceAccount: true, duplicateGroup: true, mediaAsset: true } }),
    prisma.sourcePost.count({ where: duplicateWhere }),
    prisma.sourceAccount.findMany({ where: { posts: { some: { OR: [{ publishJobs: { some: { status: { in: reviewStatuses } } } }, { duplicateGroupId: { not: null }, status: "SKIPPED" }] } } }, orderBy: { username: "asc" }, select: { username: true } }),
    prisma.browserIdentity.findMany({ where: { role: "PUBLISHER", enabled: true }, orderBy: { label: "asc" }, select: { id: true, label: true, expectedUsername: true, verifiedAt: true, dailyPostLimit: true } }),
  ]);
  return { jobs, total, page: current, pageSize: reviewPageSize, duplicates, duplicateTotal, sources, publishers };
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
    for (const name of logNames) {
      const content = await readFile(resolve(directory, name), "utf8");
      for (const line of content.slice(-100_000).split("\n")) {
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

export type StorageUsage = {
  totalBytes: number;
  videoBytes: number;
  fileCount: number;
};

async function shallowSize(directory: string): Promise<{ bytes: number; files: number }> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile());
    const sizes = await Promise.all(files.map((entry) => stat(resolve(directory, entry.name)).then((metadata) => metadata.size).catch(() => 0)));
    return { bytes: sizes.reduce((sum, size) => sum + size, 0), files: files.length };
  } catch { return { bytes: 0, files: 0 }; }
}

export async function getStorageUsage(): Promise<StorageUsage> {
  const config = loadConfig();
  const [video, thumbnails, temp, logs, backups] = await Promise.all([
    prisma.mediaAsset.aggregate({ where: { localRemovedAt: null }, _sum: { fileSize: true }, _count: { _all: true } }),
    shallowSize(config.thumbnailStoragePath),
    shallowSize(config.tempStoragePath),
    shallowSize(config.logStoragePath),
    shallowSize(config.backupStoragePath),
  ]);
  const videoBytes = video._sum.fileSize ?? 0;
  return {
    totalBytes: videoBytes + thumbnails.bytes + temp.bytes + logs.bytes + backups.bytes,
    videoBytes,
    fileCount: video._count._all + thumbnails.files + temp.files + logs.files + backups.files,
  };
}

export async function getVideoFiles(): Promise<VideoFileEntry[]> {
  const storage = loadConfig().videoStoragePath;
  let names: string[];
  try { names = await readdir(storage); } catch { return []; }
  const mp4Files = names.filter((name) => extname(name).toLowerCase() === ".mp4").sort().reverse();
  const postIds = mp4Files.map((name) => name.slice(0, -4));
  const assets = await prisma.mediaAsset.findMany({
    where: { sourcePost: { platformPostId: { in: postIds } }, localRemovedAt: null },
    include: { sourcePost: { select: { id: true, platformPostId: true, sourceUrl: true, text: true, status: true, downloadJob: { select: { status: true } }, publishJobs: { select: { status: true, publishedPost: { select: { id: true } } } }, sourceAccount: { select: { username: true } } } } },
  });
  const assetMap = new Map(assets.map((asset) => [asset.sourcePost.platformPostId, asset]));
  const results: VideoFileEntry[] = [];
  for (const name of mp4Files) {
    const platformPostId = name.slice(0, -4);
    const asset = assetMap.get(platformPostId);
    if (!asset) continue;
    const publication = asset.sourcePost.publishJobs.find((job) => job.publishedPost) ?? asset.sourcePost.publishJobs[0];
    const status = publication?.publishedPost ? "PUBLISHED" : publication?.status ?? asset.sourcePost.status;
    results.push({
      sourcePostId: asset.sourcePost.id,
      platformPostId,
      fileName: name,
      fileSize: asset.fileSize,
      sourceUsername: asset.sourcePost.sourceAccount.username,
      sourceUrl: asset.sourcePost.sourceUrl,
      caption: asset.sourcePost.text ? asset.sourcePost.text.slice(0, 280) : asset.sourcePost.text,
      status,
      running: asset.sourcePost.downloadJob?.status === "RUNNING" || asset.sourcePost.publishJobs.some((job) => ["RUNNING", "PUBLISHING"].includes(job.status)) || asset.sourcePost.status === "PUBLISHING",
    });
  }
  return results;
}
