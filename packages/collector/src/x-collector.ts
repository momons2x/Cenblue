import type { BookmarkedPost, CollectedPost, CollectionOptions, SourceAccountInput, SourceCollector } from "@cenblu/shared";
import { normalizeBookmarkedPost, normalizeTimelinePost } from "./normalize";
import type { TimelineBrowser } from "./timeline-browser";

export class XPlaywrightCollector implements SourceCollector {
  constructor(private readonly browser: TimelineBrowser) {}

  async collect(source: SourceAccountInput, options: CollectionOptions = {}): Promise<CollectedPost[]> {
    const candidates = await this.browser.read(source, source.collectLimit, options);
    const collected = new Map<string, CollectedPost>();

    for (const candidate of candidates) {
      const post = normalizeTimelinePost(candidate, source, { allowReplies: true });
      if (post && !options.knownPostIds?.has(post.platformPostId) && !collected.has(post.platformPostId)) {
        collected.set(post.platformPostId, post);
      }
      if (collected.size >= source.collectLimit) {
        break;
      }
    }

    return [...collected.values()];
  }

  async collectBookmarks(limit: number, options: CollectionOptions = {}): Promise<BookmarkedPost[]> {
    if (!this.browser.readBookmarks) throw new Error("Bookmark collection is not supported by this browser.");
    const candidates = await this.browser.readBookmarks(limit, options);
    const collected = new Map<string, BookmarkedPost>();
    for (const candidate of candidates) {
      const post = normalizeBookmarkedPost(candidate);
      if (post && !options.knownPostIds?.has(post.platformPostId) && !collected.has(post.platformPostId)) collected.set(post.platformPostId, post);
      if (collected.size >= limit) break;
    }
    return [...collected.values()];
  }

  withSession<T>(operation: () => Promise<T>): Promise<T> {
    return this.browser.withSession ? this.browser.withSession(operation) : operation();
  }
}
