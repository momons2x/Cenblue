import type { BookmarkedPost, CollectedPost, SourceAccountInput } from "@cenblu/shared";
import { bookmarkedPostSchema, collectedPostSchema } from "@cenblu/shared";
import { z } from "zod";

const rawTimelinePostSchema = z.object({
  statusHref: z.string().nullable(),
  text: z.string(),
  datetime: z.string().nullable(),
  hasVideo: z.boolean(),
  hasOwnVideo: z.boolean().optional(),
  isReply: z.boolean(),
  isRepost: z.boolean(),
});

export type RawTimelinePost = z.infer<typeof rawTimelinePostSchema>;

const statusPathPattern = /^\/?([A-Za-z0-9_]{1,15})\/status\/(\d+)(?:[/?#].*)?$/;

const SNOWFLAKE_EPOCH_MS = 1_288_834_974_657;
const SNOWFLAKE_SHIFT = 2 ** 22;

function postedAtFromStatusId(platformPostId: string): Date | null {
  if (!/^\d{1,19}$/.test(platformPostId)) return null;
  const id = Number(platformPostId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const postedAt = new Date(Math.floor(id / SNOWFLAKE_SHIFT) + SNOWFLAKE_EPOCH_MS);
  return Number.isNaN(postedAt.getTime()) ? null : postedAt;
}

function resolvePostedAt(datetime: string | null, platformPostId: string): Date | null {
  if (datetime === null) return postedAtFromStatusId(platformPostId);
  const postedAt = new Date(datetime);
  return Number.isNaN(postedAt.getTime()) ? null : postedAt;
}

export type ParsedStatusUrl = {
  username: string;
  platformPostId: string;
  sourceUrl: string;
};

export function parseStatusUrl(value: string): ParsedStatusUrl | null {
  let url: URL;
  try {
    url = new URL(value, "https://x.com");
  } catch {
    return null;
  }

  if (!new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com"]).has(url.hostname.toLowerCase())) {
    return null;
  }

  const match = statusPathPattern.exec(url.pathname);
  if (!match) {
    return null;
  }

  const [, username, platformPostId] = match;
  return {
    username,
    platformPostId,
    sourceUrl: `https://x.com/${username}/status/${platformPostId}`,
  };
}

export function normalizeTimelinePost(rawValue: unknown, source: SourceAccountInput, policy: { allowReplies?: boolean } = {}): CollectedPost | null {
  const raw = rawTimelinePostSchema.safeParse(rawValue);
  if (!raw.success || (!policy.allowReplies && raw.data.isReply) || raw.data.isRepost || !(raw.data.hasOwnVideo ?? raw.data.hasVideo) || !raw.data.statusHref) {
    return null;
  }

  const status = parseStatusUrl(raw.data.statusHref);
  if (!status || status.username.toLowerCase() !== source.username.toLowerCase()) {
    return null;
  }

  const postedAt = resolvePostedAt(raw.data.datetime, status.platformPostId);
  if (!postedAt) {
    return null;
  }

  const result = collectedPostSchema.safeParse({
    platformPostId: status.platformPostId,
    sourceUrl: `https://x.com/${source.username}/status/${status.platformPostId}`,
    text: raw.data.text.trim(),
    postedAt,
    mediaType: "VIDEO",
  });
  return result.success ? result.data : null;
}

export function normalizeBookmarkedPost(rawValue: unknown): BookmarkedPost | null {
  const raw = rawTimelinePostSchema.safeParse(rawValue);
  if (!raw.success || raw.data.isRepost || !(raw.data.hasOwnVideo ?? raw.data.hasVideo) || !raw.data.statusHref) return null;
  const status = parseStatusUrl(raw.data.statusHref);
  if (!status) return null;
  const postedAt = resolvePostedAt(raw.data.datetime, status.platformPostId);
  if (!postedAt) return null;
  const result = bookmarkedPostSchema.safeParse({
    platformPostId: status.platformPostId,
    sourceUrl: status.sourceUrl,
    authorUsername: status.username,
    text: raw.data.text.trim(),
    postedAt,
    mediaType: "VIDEO",
  });
  return result.success ? result.data : null;
}
