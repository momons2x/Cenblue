import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

export const portableSettingKeys = [
  "COLLECTION_INTERVAL_MINUTES", "POSTS_PER_SOURCE", "PUBLISH_INTERVAL_MINUTES", "PLAYWRIGHT_HEADLESS",
  "PUBLISH_MODE", "PUBLISH_MIN_UPLOAD_MBPS", "PUBLISH_MAX_UPLOAD_MINUTES", "DOWNLOAD_CONCURRENCY",
  "DOWNLOAD_BATCH_LIMIT", "SOURCE_ACCOUNT_LIMIT", "DAILY_POST_MINIMUM", "DAILY_POST_PREFERRED", "CAPTION_TEMPLATES", "APP_TIMEZONE",
  "SCHEDULE_ACTIVE_START", "SCHEDULE_ACTIVE_END", "SCHEDULE_ACTIVE_WINDOWS", "SCHEDULE_JITTER_MINUTES", "SCHEDULE_MIN_GAP_MINUTES",
] as const;

const settingsSchema = z.object({
  COLLECTION_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(59).transform(String).optional(),
  POSTS_PER_SOURCE: z.coerce.number().int().min(1).max(100).transform(String).optional(),
  PUBLISH_INTERVAL_MINUTES: z.coerce.number().int().min(1).transform(String).optional(),
  PLAYWRIGHT_HEADLESS: z.enum(["true", "false"]).optional(),
  PUBLISH_MODE: z.enum(["ASSISTED", "AUTOMATIC"]).optional(),
  PUBLISH_MIN_UPLOAD_MBPS: z.coerce.number().min(0.25).max(1_000).transform(String).optional(),
  PUBLISH_MAX_UPLOAD_MINUTES: z.coerce.number().int().min(5).max(120).transform(String).optional(),
  DOWNLOAD_CONCURRENCY: z.coerce.number().int().min(1).max(3).transform(String).optional(),
  DOWNLOAD_BATCH_LIMIT: z.coerce.number().int().min(1).max(1_000).transform(String).optional(),
  SOURCE_ACCOUNT_LIMIT: z.coerce.number().int().min(1).max(100).transform(String).optional(),
  DAILY_POST_MINIMUM: z.coerce.number().int().min(0).max(20).transform(String).optional(),
  DAILY_POST_PREFERRED: z.coerce.number().int().min(0).max(20).transform(String).optional(),
  CAPTION_TEMPLATES: z.string().max(10_000).optional(),
  APP_TIMEZONE: z.string().min(1).refine((value) => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }, "Invalid IANA timezone").optional(),
  SCHEDULE_ACTIVE_START: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  SCHEDULE_ACTIVE_END: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  SCHEDULE_JITTER_MINUTES: z.coerce.number().int().min(0).max(120).transform(String).optional(),
  SCHEDULE_MIN_GAP_MINUTES: z.coerce.number().int().min(0).max(180).transform(String).optional(),
}).strict();

const sourceSchema = z.object({
  username: z.string().regex(/^[a-z0-9_]{1,15}$/),
  displayName: z.string().max(100).nullable(),
  enabled: z.boolean(),
  collectLimit: z.number().int().min(1).max(100),
  captionTemplate: z.string().max(10_000).nullable(),
  attributionTemplate: z.string().max(2_000).nullable(),
  hashtagRules: z.string().max(2_000).nullable(),
}).strict();

export const portableConfigSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string().datetime(),
  settings: settingsSchema,
  sources: z.array(sourceSchema).max(100),
}).strict();

export type PortableConfig = z.infer<typeof portableConfigSchema>;

export class PortableConfigService {
  constructor(private readonly client: PrismaClient) {}

  async export(): Promise<PortableConfig> {
    const [stored, sources] = await Promise.all([
      this.client.appSetting.findMany({ where: { key: { in: [...portableSettingKeys] } }, orderBy: { key: "asc" } }),
      this.client.sourceAccount.findMany({ where: { managedSource: true }, orderBy: { username: "asc" }, select: { username: true, displayName: true, enabled: true, collectLimit: true, captionTemplate: true, attributionTemplate: true, hashtagRules: true } }),
    ]);
    return portableConfigSchema.parse({ version: 1, exportedAt: new Date().toISOString(), settings: Object.fromEntries(stored.map(({ key, value }) => [key, value])), sources });
  }

  async import(input: unknown): Promise<{ settings: number; sources: number }> {
    const manifest = portableConfigSchema.parse(input);
    const settings = Object.entries(manifest.settings).filter((entry): entry is [string, string] => entry[1] !== undefined);
    await this.client.$transaction(async (transaction) => {
      for (const [key, value] of settings) await transaction.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
      await transaction.appSetting.deleteMany({ where: { key: { in: [
        "COLLECTOR_BROWSER_SESSION_VERIFIED_AT", "COLLECTOR_BROWSER_SESSION_ACCOUNT", "COLLECTOR_BROWSER_SESSION_BINDING", "COLLECTOR_BROWSER_SESSION_ERROR",
        "PUBLISHER_BROWSER_SESSION_VERIFIED_AT", "PUBLISHER_BROWSER_SESSION_ACCOUNT", "PUBLISHER_BROWSER_SESSION_BINDING", "PUBLISHER_BROWSER_SESSION_ERROR",
      ] } } });
      for (const source of manifest.sources) {
        await transaction.sourceAccount.upsert({
          where: { username: source.username },
          create: { ...source, profileUrl: `https://x.com/${source.username}`, managedSource: true },
          update: { ...source, profileUrl: `https://x.com/${source.username}`, managedSource: true, archivedAt: null },
        });
      }
    });
    return { settings: settings.length, sources: manifest.sources.length };
  }
}
