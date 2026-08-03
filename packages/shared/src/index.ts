import { z } from "zod";

export const sourceAccountInputSchema = z.object({
  id: z.string().min(1),
  username: z.string().regex(/^[A-Za-z0-9_]{1,15}$/),
  profileUrl: z.string().url(),
  collectLimit: z.number().int().min(1),
});

export type SourceAccountInput = z.infer<typeof sourceAccountInputSchema>;

export const collectedPostSchema = z.object({
  platformPostId: z.string().regex(/^\d+$/),
  sourceUrl: z.string().url(),
  text: z.string(),
  postedAt: z.date(),
  mediaType: z.literal("VIDEO"),
});

export type CollectedPost = z.infer<typeof collectedPostSchema>;

export const bookmarkedPostSchema = collectedPostSchema.extend({
  authorUsername: z.string().regex(/^[A-Za-z0-9_]{1,15}$/),
});

export type BookmarkedPost = z.infer<typeof bookmarkedPostSchema>;

export type CollectionScanProgress = { eligibleExamined: number; knownSkipped: number; newFound: number; targetNew: number; stopReason?: string };
export type CollectionOptions = { knownPostIds?: ReadonlySet<string>; onProgress?: (progress: CollectionScanProgress) => Promise<void> | void; shouldCancel?: () => Promise<boolean> | boolean };

export interface SourceCollector {
  collect(source: SourceAccountInput, options?: CollectionOptions): Promise<CollectedPost[]>;
  withSession?<T>(operation: () => Promise<T>): Promise<T>;
}
