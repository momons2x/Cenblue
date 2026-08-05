import "dotenv/config";
import { relative, resolve } from "node:path";
import { z } from "zod";

const booleanFromEnvironment = z.enum(["true", "false"]).transform((value) => value === "true");
const timeZone = z.string().min(1).refine((value) => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }, "Enter a valid IANA timezone");

export const storedConfigKeys = [
  "COLLECTION_INTERVAL_MINUTES", "POSTS_PER_SOURCE", "PUBLISH_INTERVAL_MINUTES", "PLAYWRIGHT_HEADLESS",
  "PUBLISH_MODE", "PUBLISH_MIN_UPLOAD_MBPS", "PUBLISH_MAX_UPLOAD_MINUTES", "DOWNLOAD_CONCURRENCY",
  "DOWNLOAD_BATCH_LIMIT", "SOURCE_ACCOUNT_LIMIT", "CAPTION_TEMPLATES", "APP_TIMEZONE",
] as const;

export const browserIds = ["msedge", "chrome", "brave", "chromium", "vivaldi", "opera", "custom"] as const;
export type BrowserId = typeof browserIds[number];

export const deviceBrowserSettingKeys = [
  "DEVICE_COLLECTOR_BROWSER_ID", "DEVICE_COLLECTOR_BROWSER_EXECUTABLE",
  "DEVICE_PUBLISHER_BROWSER_ID", "DEVICE_PUBLISHER_BROWSER_EXECUTABLE",
] as const;

const environmentSchema = z.object({
  CENBLU_ROOT: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  APP_TIMEZONE: timeZone.default("Asia/Jakarta"),
  PLAYWRIGHT_HEADLESS: booleanFromEnvironment.default(false),
  PLAYWRIGHT_PROFILE_PATH: z.string().min(1).default("./storage/browser-profile"),
  PLAYWRIGHT_PROFILE_SOURCE_PATH: z.string().min(1).optional(),
  PLAYWRIGHT_PROFILE_DIRECTORY: z.string().regex(/^(Default|Profile \d+)$/).optional(),
  PUBLISHER_PROFILE_PATH: z.string().min(1).default("./storage/browser-profile-publisher"),
  PUBLISHER_PROFILE_DIRECTORY: z.string().regex(/^(Default|Profile \d+)$/).optional(),
  PLAYWRIGHT_BROWSER_CHANNEL: z.enum(["msedge", "chrome"]).default("msedge"),
  COLLECTOR_BROWSER_ID: z.enum(browserIds).optional(),
  COLLECTOR_BROWSER_EXECUTABLE: z.string().min(1).optional(),
  PUBLISHER_BROWSER_ID: z.enum(browserIds).optional(),
  PUBLISHER_BROWSER_EXECUTABLE: z.string().min(1).optional(),
  PLAYWRIGHT_ALLOW_EXTERNAL_PROFILE: booleanFromEnvironment.default(false),
  SOURCE_ACCOUNT_LIMIT: z.coerce.number().int().min(1).max(100).default(3),
  POSTS_PER_SOURCE: z.coerce.number().int().min(1).default(5),
  VIDEO_ONLY: booleanFromEnvironment.default(true),
  LOG_STORAGE_PATH: z.string().min(1).default("./storage/logs"),
  VIDEO_STORAGE_PATH: z.string().min(1).default("./storage/videos"),
  TEMP_STORAGE_PATH: z.string().min(1).default("./storage/temp"),
  THUMBNAIL_STORAGE_PATH: z.string().min(1).default("./storage/thumbnails"),
  YTDLP_BINARY: z.string().min(1).default("yt-dlp"),
  FFMPEG_BINARY: z.string().min(1).default("ffmpeg"),
  FFPROBE_BINARY: z.string().min(1).default("ffprobe"),
  PUBLISH_ALLOW_EMPTY_CAPTION: booleanFromEnvironment.default(false),
  PUBLISH_MIN_UPLOAD_MBPS: z.coerce.number().min(0.25).max(1_000).default(2),
  PUBLISH_MAX_UPLOAD_MINUTES: z.coerce.number().int().min(5).max(120).default(45),
  COLLECTION_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(59).default(15),
  PUBLISH_INTERVAL_MINUTES: z.coerce.number().int().min(1).default(60),
  DOWNLOAD_CONCURRENCY: z.coerce.number().int().min(1).max(3).default(1),
  DOWNLOAD_BATCH_LIMIT: z.coerce.number().int().min(1).max(1_000).default(20),
  WORKER_LOCK_TIMEOUT_MINUTES: z.coerce.number().int().min(1).default(30),
  COLLECTOR_MAX_SCROLLS: z.coerce.number().int().min(1).max(200).default(60),
  COLLECTOR_IDLE_SCROLLS: z.coerce.number().int().min(1).max(30).default(8),
  COLLECTOR_SCROLL_DELAY_MS: z.coerce.number().int().min(250).max(10_000).default(1_200),
  COLLECTOR_MAX_SOURCE_SECONDS: z.coerce.number().int().min(30).max(1_800).default(300),
  PUBLISH_MODE: z.enum(["ASSISTED", "AUTOMATIC"]).default("ASSISTED"),
  CAPTION_TEMPLATES: z.string().default("{sourceCaption}"),
  LOG_MAX_BYTES: z.coerce.number().int().min(10_000).default(5_000_000),
  LOG_RETAINED_FILES: z.coerce.number().int().min(1).max(20).default(5),
  BACKUP_STORAGE_PATH: z.string().min(1).default("./storage/backups"),
});

export type AppConfig = {
  repositoryRoot: string;
  databaseUrl: string;
  timezone: string;
  playwrightHeadless: boolean;
  playwrightProfilePath: string;
  playwrightProfileSourcePath: string | undefined;
  playwrightProfileDirectory: string | undefined;
  publisherProfilePath: string;
  publisherProfileDirectory: string | undefined;
  playwrightBrowserChannel: "msedge" | "chrome";
  collectorBrowserId: BrowserId;
  collectorBrowserExecutablePath: string | undefined;
  publisherBrowserId: BrowserId;
  publisherBrowserExecutablePath: string | undefined;
  playwrightAllowExternalProfile: boolean;
  sourceAccountLimit: number;
  postsPerSource: number;
  videoOnly: boolean;
  logStoragePath: string;
  videoStoragePath: string;
  tempStoragePath: string;
  thumbnailStoragePath: string;
  ytDlpBinary: string;
  ffmpegBinary: string;
  ffprobeBinary: string;
  publishAllowEmptyCaption: boolean;
  publishMinUploadMbps: number;
  publishMaxUploadMinutes: number;
  collectionIntervalMinutes: number;
  publishIntervalMinutes: number;
  downloadConcurrency: number;
  downloadBatchLimit: number;
  workerLockTimeoutMinutes: number;
  collectorMaxScrolls: number;
  collectorIdleScrolls: number;
  collectorScrollDelayMs: number;
  collectorMaxSourceSeconds: number;
  publishMode: "ASSISTED" | "AUTOMATIC";
  captionTemplates: string;
  logMaxBytes: number;
  logRetainedFiles: number;
  backupStoragePath: string;
};

export function browserBindingFingerprint(config: AppConfig, role: "collector" | "publisher"): string {
  return JSON.stringify(role === "collector"
    ? { id: config.collectorBrowserId, executablePath: config.collectorBrowserExecutablePath ?? null, profilePath: config.playwrightProfilePath, profileDirectory: config.playwrightProfileDirectory ?? null }
    : { id: config.publisherBrowserId, executablePath: config.publisherBrowserExecutablePath ?? null, profilePath: config.publisherProfilePath, profileDirectory: config.publisherProfileDirectory ?? null });
}

function localPath(root: string, value: string, name: string): string {
  const path = resolve(root, value);
  const fromRoot = relative(root, path);
  if (fromRoot.startsWith("..") || fromRoot.includes(":")) throw new Error(`${name} must be inside the repository`);
  return path;
}

function browserProfilePath(root: string, value: string, name: string, allowExternal: boolean): string {
  return allowExternal ? resolve(value) : localPath(root, value, name);
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.parse(environment);
  const repositoryRoot = resolve(parsed.CENBLU_ROOT);
  const playwrightProfilePath = browserProfilePath(repositoryRoot, parsed.PLAYWRIGHT_PROFILE_PATH, "PLAYWRIGHT_PROFILE_PATH", parsed.PLAYWRIGHT_ALLOW_EXTERNAL_PROFILE);
  const publisherProfilePath = browserProfilePath(repositoryRoot, parsed.PUBLISHER_PROFILE_PATH, "PUBLISHER_PROFILE_PATH", parsed.PLAYWRIGHT_ALLOW_EXTERNAL_PROFILE);
  if (playwrightProfilePath === publisherProfilePath) throw new Error("Collector and publisher browser profiles must use different directories");

  return {
    repositoryRoot,
    databaseUrl: parsed.DATABASE_URL,
    timezone: parsed.APP_TIMEZONE,
    playwrightHeadless: parsed.PLAYWRIGHT_HEADLESS,
    playwrightProfilePath,
    playwrightProfileSourcePath: parsed.PLAYWRIGHT_PROFILE_SOURCE_PATH ? resolve(parsed.PLAYWRIGHT_PROFILE_SOURCE_PATH) : undefined,
    playwrightProfileDirectory: parsed.PLAYWRIGHT_PROFILE_DIRECTORY,
    publisherProfilePath,
    publisherProfileDirectory: parsed.PUBLISHER_PROFILE_DIRECTORY,
    playwrightBrowserChannel: parsed.PLAYWRIGHT_BROWSER_CHANNEL,
    collectorBrowserId: parsed.COLLECTOR_BROWSER_ID ?? parsed.PLAYWRIGHT_BROWSER_CHANNEL,
    collectorBrowserExecutablePath: parsed.COLLECTOR_BROWSER_EXECUTABLE ? resolve(parsed.COLLECTOR_BROWSER_EXECUTABLE) : undefined,
    publisherBrowserId: parsed.PUBLISHER_BROWSER_ID ?? parsed.PLAYWRIGHT_BROWSER_CHANNEL,
    publisherBrowserExecutablePath: parsed.PUBLISHER_BROWSER_EXECUTABLE ? resolve(parsed.PUBLISHER_BROWSER_EXECUTABLE) : undefined,
    playwrightAllowExternalProfile: parsed.PLAYWRIGHT_ALLOW_EXTERNAL_PROFILE,
    sourceAccountLimit: parsed.SOURCE_ACCOUNT_LIMIT,
    postsPerSource: parsed.POSTS_PER_SOURCE,
    videoOnly: parsed.VIDEO_ONLY,
    logStoragePath: localPath(repositoryRoot, parsed.LOG_STORAGE_PATH, "LOG_STORAGE_PATH"),
    videoStoragePath: localPath(repositoryRoot, parsed.VIDEO_STORAGE_PATH, "VIDEO_STORAGE_PATH"),
    tempStoragePath: localPath(repositoryRoot, parsed.TEMP_STORAGE_PATH, "TEMP_STORAGE_PATH"),
    thumbnailStoragePath: localPath(repositoryRoot, parsed.THUMBNAIL_STORAGE_PATH, "THUMBNAIL_STORAGE_PATH"),
    ytDlpBinary: parsed.YTDLP_BINARY,
    ffmpegBinary: parsed.FFMPEG_BINARY,
    ffprobeBinary: parsed.FFPROBE_BINARY,
    publishAllowEmptyCaption: parsed.PUBLISH_ALLOW_EMPTY_CAPTION,
    publishMinUploadMbps: parsed.PUBLISH_MIN_UPLOAD_MBPS,
    publishMaxUploadMinutes: parsed.PUBLISH_MAX_UPLOAD_MINUTES,
    collectionIntervalMinutes: parsed.COLLECTION_INTERVAL_MINUTES,
    publishIntervalMinutes: parsed.PUBLISH_INTERVAL_MINUTES,
    downloadConcurrency: parsed.DOWNLOAD_CONCURRENCY,
    downloadBatchLimit: parsed.DOWNLOAD_BATCH_LIMIT,
    workerLockTimeoutMinutes: parsed.WORKER_LOCK_TIMEOUT_MINUTES,
    collectorMaxScrolls: parsed.COLLECTOR_MAX_SCROLLS,
    collectorIdleScrolls: parsed.COLLECTOR_IDLE_SCROLLS,
    collectorScrollDelayMs: parsed.COLLECTOR_SCROLL_DELAY_MS,
    collectorMaxSourceSeconds: parsed.COLLECTOR_MAX_SOURCE_SECONDS,
    publishMode: parsed.PUBLISH_MODE,
    captionTemplates: parsed.CAPTION_TEMPLATES,
    logMaxBytes: parsed.LOG_MAX_BYTES,
    logRetainedFiles: parsed.LOG_RETAINED_FILES,
    backupStoragePath: localPath(repositoryRoot, parsed.BACKUP_STORAGE_PATH, "BACKUP_STORAGE_PATH"),
  };
}

export function applyStoredSettings(config: AppConfig, settings: Record<string, string>): AppConfig {
  const allowedSettings = Object.fromEntries(storedConfigKeys.flatMap((key) => settings[key] === undefined ? [] : [[key, settings[key]]]));
  const collectorBrowserId = settings.DEVICE_COLLECTOR_BROWSER_ID;
  const publisherBrowserId = settings.DEVICE_PUBLISHER_BROWSER_ID;
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    CENBLU_ROOT: config.repositoryRoot,
    DATABASE_URL: config.databaseUrl,
    APP_TIMEZONE: config.timezone,
    PLAYWRIGHT_PROFILE_PATH: config.playwrightProfilePath,
    PLAYWRIGHT_PROFILE_SOURCE_PATH: config.playwrightProfileSourcePath,
    PLAYWRIGHT_PROFILE_DIRECTORY: config.playwrightProfileDirectory,
    PUBLISHER_PROFILE_PATH: config.publisherProfilePath,
    PUBLISHER_PROFILE_DIRECTORY: config.publisherProfileDirectory,
    PLAYWRIGHT_BROWSER_CHANNEL: config.playwrightBrowserChannel,
    COLLECTOR_BROWSER_ID: collectorBrowserId ?? config.collectorBrowserId,
    COLLECTOR_BROWSER_EXECUTABLE: settings.DEVICE_COLLECTOR_BROWSER_EXECUTABLE ?? config.collectorBrowserExecutablePath,
    PUBLISHER_BROWSER_ID: publisherBrowserId ?? config.publisherBrowserId,
    PUBLISHER_BROWSER_EXECUTABLE: settings.DEVICE_PUBLISHER_BROWSER_EXECUTABLE ?? config.publisherBrowserExecutablePath,
    PLAYWRIGHT_ALLOW_EXTERNAL_PROFILE: String(config.playwrightAllowExternalProfile),
    LOG_STORAGE_PATH: config.logStoragePath,
    VIDEO_STORAGE_PATH: config.videoStoragePath,
    TEMP_STORAGE_PATH: config.tempStoragePath,
    THUMBNAIL_STORAGE_PATH: config.thumbnailStoragePath,
    BACKUP_STORAGE_PATH: config.backupStoragePath,
    YTDLP_BINARY: config.ytDlpBinary,
    FFMPEG_BINARY: config.ffmpegBinary,
    FFPROBE_BINARY: config.ffprobeBinary,
    ...allowedSettings,
  };
  if (collectorBrowserId) {
    environment.PLAYWRIGHT_PROFILE_PATH = resolve(config.repositoryRoot, "storage", "browser-profiles", "collector", collectorBrowserId);
    delete environment.PLAYWRIGHT_PROFILE_DIRECTORY;
  }
  if (publisherBrowserId) {
    environment.PUBLISHER_PROFILE_PATH = resolve(config.repositoryRoot, "storage", "browser-profiles", "publisher", publisherBrowserId);
    delete environment.PUBLISHER_PROFILE_DIRECTORY;
  }
  return loadConfig(environment);
}
