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
  if (!status || status.username.toLowerCase() !== source.username.toLowerCase() || !raw.data.datetime) {
    return null;
  }

  const postedAt = new Date(raw.data.datetime);
  if (Number.isNaN(postedAt.getTime())) {
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
  if (!raw.success || raw.data.isRepost || !(raw.data.hasOwnVideo ?? raw.data.hasVideo) || !raw.data.statusHref || !raw.data.datetime) return null;
  const status = parseStatusUrl(raw.data.statusHref);
  if (!status) return null;
  const postedAt = new Date(raw.data.datetime);
  if (Number.isNaN(postedAt.getTime())) return null;
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
