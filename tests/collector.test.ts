import pino from "pino";
import { resolve } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  CollectionService,
  collectorBrowserLaunchOptions,
  normalizeTimelinePost,
  normalizeBookmarkedPost,
  mergeTimelineCandidates,
  PlaywrightTimelineBrowser,
  parseStatusUrl,
  XPlaywrightCollector,
  type RawTimelinePost,
  type TimelineBrowser,
} from "@cenblu/collector";
import { prisma, SourceAccountRepository, SourcePostRepository, type SourceAccount } from "@cenblu/database";
import type { SourceAccountInput } from "@cenblu/shared";

const client = prisma;
const logger = pino({ level: "silent" });
const accounts = new SourceAccountRepository(client);
const posts = new SourcePostRepository(client);

const sourceInput: SourceAccountInput = {
  id: "source-id",
  username: "example",
  profileUrl: "https://x.com/example",
  collectLimit: 5,
};

const originalVideo: RawTimelinePost = {
  statusHref: "/example/status/1234567890?ref_src=twsrc",
  text: " Video post ",
  datetime: "2026-07-20T10:15:30.000Z",
  hasVideo: true,
  isReply: false,
  isRepost: false,
};

class FixtureTimelineBrowser implements TimelineBrowser {
  constructor(private readonly fixtures: RawTimelinePost[]) {}

  async read(): Promise<RawTimelinePost[]> {
    return this.fixtures;
  }
}

beforeEach(async () => {
  await client.sourcePost.deleteMany();
  await client.sourceAccount.deleteMany();
});

afterAll(async () => {
  await client.$disconnect();
});

describe("collector normalization", () => {
  it("launches the collector with installed Edge rather than bundled Chromium", () => {
    expect(collectorBrowserLaunchOptions({
      headless: true,
      browserChannel: "msedge",
      repositoryRoot: resolve("."),
      profileDirectory: "storage/browser-profile-edge",
      browserProfileDirectory: "Profile 1",
      lease: { run: async (operation) => operation() },
      diagnosticsDirectory: "storage/logs",
    })).toEqual({
      headless: true,
      timeout: 20_000,
      channel: "msedge",
      args: ["--profile-directory=Profile 1"],
    });
  });

  it("validates profiles against the repository root from a nested dashboard cwd", () => {
    const repositoryRoot = resolve(".");
    const originalCwd = process.cwd();
    process.chdir(resolve(repositoryRoot, "apps/dashboard"));
    try {
      const options = {
        headless: true,
        browserChannel: "msedge" as const,
        repositoryRoot,
        profileDirectory: resolve(repositoryRoot, "storage/browser-profile-edge"),
        browserProfileDirectory: "Profile 1",
        lease: { run: async <T>(operation: () => Promise<T>) => operation() },
        diagnosticsDirectory: resolve(repositoryRoot, "storage/logs"),
      };
      expect(() => new PlaywrightTimelineBrowser(options, logger)).not.toThrow();
      expect(() => new PlaywrightTimelineBrowser({ ...options, profileDirectory: resolve(repositoryRoot, "../external-profile") }, logger)).toThrow("inside the repository");
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("extracts stable IDs and canonicalizes representative status URLs", () => {
    expect(parseStatusUrl("https://twitter.com/Example/status/1234567890/video/1?x=1")).toEqual({
      username: "Example",
      platformPostId: "1234567890",
      sourceUrl: "https://x.com/Example/status/1234567890",
    });
    expect(parseStatusUrl("https://example.com/example/status/123")).toBeNull();
    expect(parseStatusUrl("/example/status/not-a-number")).toBeNull();
  });

  it("normalizes only original video posts from the configured author", () => {
    expect(normalizeTimelinePost(originalVideo, sourceInput)).toMatchObject({
      platformPostId: "1234567890",
      text: "Video post",
      mediaType: "VIDEO",
    });
    expect(normalizeTimelinePost({ ...originalVideo, isReply: true }, sourceInput)).toBeNull();
    expect(normalizeTimelinePost({ ...originalVideo, isRepost: true }, sourceInput)).toBeNull();
    expect(normalizeTimelinePost({ ...originalVideo, hasVideo: false }, sourceInput)).toBeNull();
    expect(normalizeTimelinePost({ ...originalVideo, statusHref: "/other/status/1234567890" }, sourceInput)).toBeNull();
    expect(normalizeTimelinePost({ ...originalVideo, datetime: "invalid" }, sourceInput)).toBeNull();
  });

  it("allows authored video replies only under the explicit reply policy", () => {
    const reply = { ...originalVideo, isReply: true };
    expect(normalizeTimelinePost(reply, sourceInput)).toBeNull();
    expect(normalizeTimelinePost(reply, sourceInput, { allowReplies: true })).toMatchObject({ platformPostId: "1234567890" });
    expect(normalizeTimelinePost({ ...reply, hasOwnVideo: false }, sourceInput, { allowReplies: true })).toBeNull();
  });

  it("normalizes bookmarked outer-post videos with their actual author", () => {
    expect(normalizeBookmarkedPost({ ...originalVideo, statusHref: "/OtherAuthor/status/777" })).toMatchObject({ platformPostId: "777", authorUsername: "OtherAuthor", sourceUrl: "https://x.com/OtherAuthor/status/777" });
    expect(normalizeBookmarkedPost({ ...originalVideo, hasOwnVideo: false })).toBeNull();
    expect(normalizeBookmarkedPost({ ...originalVideo, isRepost: true })).toBeNull();
  });

  it("deduplicates fixture output and honors the source limit", async () => {
    const collector = new XPlaywrightCollector(new FixtureTimelineBrowser([
      originalVideo,
      originalVideo,
      { ...originalVideo, statusHref: "/example/status/2" },
      { ...originalVideo, statusHref: "/example/status/3" },
    ]));
    const result = await collector.collect({ ...sourceInput, collectLimit: 2 });
    expect(result.map((post) => post.platformPostId)).toEqual(["1234567890", "2"]);
  });

  it("retains posts across virtualized rounds even when mounted card count stays constant", () => {
    const accumulated = new Map<string, RawTimelinePost>();
    expect(mergeTimelineCandidates(accumulated, [originalVideo, { ...originalVideo, statusHref: "/example/status/2" }])).toBe(2);
    expect(mergeTimelineCandidates(accumulated, [{ ...originalVideo, statusHref: "/example/status/3" }, { ...originalVideo, statusHref: "/example/status/4" }])).toBe(2);
    expect(accumulated.size).toBe(4);
    expect([...accumulated.keys()]).toContain("/example/status/1234567890?ref_src=twsrc");
  });
});

describe("repositories and collection cycle", () => {
  it("supports source account CRUD", async () => {
    const created = await accounts.create({ username: "@Example", collectLimit: 4 });
    expect(created).toMatchObject({ username: "example", profileUrl: "https://x.com/example", enabled: true });
    expect(await accounts.findById(created.id)).not.toBeNull();
    expect(await accounts.list()).toHaveLength(1);
    expect(await accounts.update(created.id, { username: "renamed", enabled: false })).toMatchObject({
      username: "renamed",
      profileUrl: "https://x.com/renamed",
      enabled: false,
    });
    await accounts.delete(created.id);
    expect(await accounts.list()).toHaveLength(0);
  });

  it("archives sources without deleting history and excludes them from collection", async () => {
    const source = await accounts.create({ username: "archive_me" });
    await posts.persistNew(source.id, [{ ...normalizeTimelinePost(originalVideo, sourceInput)!, sourceUrl: "https://x.com/archive_me/status/1234567890" }], new Date());
    await accounts.archive(source.id);
    expect(await accounts.listEnabled(3)).toHaveLength(0);
    expect(await client.sourcePost.count()).toBe(1);
    expect((await accounts.findById(source.id))?.archivedAt).not.toBeNull();
  });

  it("persists posts transactionally and ignores repeated platform IDs", async () => {
    const source = await accounts.create({ username: "example" });
    const collector = new XPlaywrightCollector(new FixtureTimelineBrowser([originalVideo]));
    const collected = await collector.collect({ ...sourceInput, id: source.id });

    expect(await posts.persistNew(source.id, [...collected, ...collected], new Date())).toEqual({ inserted: 1, duplicates: 1 });
    expect(await posts.persistNew(source.id, collected, new Date())).toEqual({ inserted: 0, duplicates: 1 });
    expect(await client.sourcePost.count()).toBe(1);
    expect(await client.sourcePost.findFirst()).toMatchObject({ status: "QUEUED_FOR_DOWNLOAD", mediaType: "VIDEO" });
  });

  it("persists bookmark posts under hidden original authors and promotes them when configured", async () => {
    const bookmark = normalizeBookmarkedPost({ ...originalVideo, statusHref: "/BookmarkAuthor/status/888" })!;
    expect(await posts.persistBookmarks([bookmark, bookmark], new Date())).toEqual({ inserted: 1, duplicates: 1 });
    const author = await client.sourceAccount.findUniqueOrThrow({ where: { username: "bookmarkauthor" } });
    expect(author).toMatchObject({ enabled: false, managedSource: false });
    expect(await accounts.list()).toHaveLength(0);
    expect(await client.sourcePost.findUniqueOrThrow({ where: { platformPostId: "888" } })).toMatchObject({ sourceAccountId: author.id, discoveryKind: "BOOKMARK", status: "QUEUED_FOR_DOWNLOAD" });
    expect(await client.downloadJob.count()).toBe(1);
    expect(await accounts.create({ username: "BookmarkAuthor", collectLimit: 4 })).toMatchObject({ id: author.id, enabled: true, managedSource: true });
    expect(await accounts.list()).toHaveLength(1);
  });

  it("collects unique new bookmarks without requiring the configured source author", async () => {
    const browser: TimelineBrowser = { read: async () => [], readBookmarks: async () => [{ ...originalVideo, statusHref: "/one/status/901" }, { ...originalVideo, statusHref: "/two/status/902" }] };
    const collector = new XPlaywrightCollector(browser);
    const result = await collector.collectBookmarks(5, { knownPostIds: new Set(["901"]) });
    expect(result.map((post) => ({ id: post.platformPostId, author: post.authorUsername }))).toEqual([{ id: "902", author: "two" }]);
  });

  it("continues processing after one source fails and records both outcomes", async () => {
    const failing = await accounts.create({ username: "failing" });
    const working = await accounts.create({ username: "working" });
    const collector = {
      collect: async (source: SourceAccountInput) => {
        if (source.username === "failing") throw new Error("fixture failure");
        return [{
          platformPostId: "42",
          sourceUrl: "https://x.com/working/status/42",
          text: "works",
          postedAt: new Date("2026-07-20T10:15:30Z"),
          mediaType: "VIDEO" as const,
        }];
      },
    };
    const service = new CollectionService(accounts, posts, collector, logger, 3, 5);
    expect(await service.runOnce()).toEqual({
      sourcesProcessed: 1,
      sourcesFailed: 1,
      postsInserted: 1,
      duplicatesIgnored: 0,
      cancelled: false,
    });

    const records = await client.sourceAccount.findMany();
    const byId = new Map<string, SourceAccount>(records.map((record) => [record.id, record]));
    expect(byId.get(failing.id)?.lastCollectionError).toBe("fixture failure");
    expect(byId.get(working.id)?.lastCollectedAt).not.toBeNull();
  });
});
