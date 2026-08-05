import { mkdir, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import type { Logger } from "pino";
import type { BrowserId } from "@cenblu/config";
import type { CollectionOptions, SourceAccountInput } from "@cenblu/shared";
import { pruneDiagnosticFiles } from "@cenblu/shared/diagnostics";
import type { ExclusiveLease } from "@cenblu/shared/lease";
import { detectXUsername } from "@cenblu/shared/x-identity";
import type { RawTimelinePost } from "./normalize";
import { normalizeBookmarkedPost, normalizeTimelinePost } from "./normalize";
import { parsePostMetricLabels, type PostMetrics } from "./post-metrics";
import { xSelectors } from "./selectors";

export interface TimelineBrowser {
  read(source: SourceAccountInput, candidateLimit: number, options?: CollectionOptions): Promise<RawTimelinePost[]>;
  readBookmarks?(candidateLimit: number, options?: CollectionOptions): Promise<RawTimelinePost[]>;
  withSession?<T>(operation: () => Promise<T>): Promise<T>;
}

export type PlaywrightTimelineBrowserOptions = {
  headless: boolean;
  browserId?: BrowserId;
  browserChannel?: "msedge" | "chrome";
  browserExecutablePath?: string;
  repositoryRoot: string;
  profileDirectory: string;
  browserProfileDirectory?: string;
  allowExternalProfile?: boolean;
  lease: ExclusiveLease;
  diagnosticsDirectory: string;
  navigationAttempts?: number;
  operationTimeoutMs?: number;
  maxScrolls?: number;
  idleScrolls?: number;
  scrollDelayMs?: number;
  maxSourceDurationMs?: number;
  profileRole?: "collector" | "publisher";
  expectedUsername?: string;
};

export function collectorBrowserLaunchOptions(options: PlaywrightTimelineBrowserOptions) {
  const browserId = options.browserId ?? options.browserChannel ?? "msedge";
  if (!options.browserExecutablePath && !["msedge", "chrome", "chromium"].includes(browserId)) throw new Error(`${browserId} requires a configured browser executable`);
  return {
    headless: options.headless,
    timeout: options.operationTimeoutMs ?? 20_000,
    ...(options.browserExecutablePath ? { executablePath: options.browserExecutablePath } : { channel: browserId }),
    args: options.browserProfileDirectory ? [`--profile-directory=${options.browserProfileDirectory}`] : undefined,
  };
}

function configuredProfilePath(path: string, repositoryRoot: string, label: string, allowExternal = false): string {
  const resolved = resolve(path);
  const fromRoot = relative(resolve(repositoryRoot), resolved);
  if (!allowExternal && (fromRoot.startsWith("..") || fromRoot.includes(":"))) throw new Error(`${label} browser profile must be inside the repository`);
  return resolved;
}

const sleep = (milliseconds: number) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

export function mergeTimelineCandidates(target: Map<string, RawTimelinePost>, candidates: RawTimelinePost[]): number {
  const initialSize = target.size;
  for (const candidate of candidates) {
    if (candidate.statusHref) target.set(candidate.statusHref, candidate);
  }
  return target.size - initialSize;
}

async function extractPosts(page: Page): Promise<RawTimelinePost[]> {
  return page.locator(xSelectors.timelinePost).evaluateAll((articles, selectors) => articles.map((article) => {
    const timestamp = article.querySelector(selectors.timestamp);
    const timestampParent = timestamp?.parentElement;
    const statusHref = (timestampParent?.tagName === "A" ? timestampParent.getAttribute("href") : null)
      ?? article.querySelector(selectors.statusLink)?.getAttribute("href")
      ?? null;
    const statusPostId = statusHref?.match(/\/status\/(\d+)/)?.[1];
    const linkedPostIds = [...article.querySelectorAll(selectors.statusLink)]
      .map((link) => link.getAttribute("href")?.match(/\/status\/(\d+)/)?.[1])
      .filter((value): value is string => Boolean(value));
    const hasVideo = article.querySelector(selectors.video) !== null;
    const socialContext = article.querySelector(selectors.socialContext)?.textContent ?? "";
    const articleText = article.textContent ?? "";

  return {
      statusHref,
      text: article.querySelector(selectors.tweetText)?.textContent ?? "",
      datetime: timestamp?.getAttribute("datetime") ?? null,
      hasVideo,
      // Conservatively reject media ownership when a card embeds another post ID.
      hasOwnVideo: hasVideo && Boolean(statusPostId) && linkedPostIds.every((postId) => postId === statusPostId),
      isReply: /replying to/i.test(articleText),
      isRepost: /reposted/i.test(socialContext),
    };
  }), xSelectors);
}

export class PlaywrightTimelineBrowser implements TimelineBrowser {
  private readonly navigationAttempts: number;
  private readonly operationTimeoutMs: number;
  private readonly profileDirectory: string;
  private readonly maxScrolls: number;
  private readonly idleScrolls: number;
  private readonly scrollDelayMs: number;
  private readonly maxSourceDurationMs: number;
  private readonly profileRole: "collector" | "publisher";
  private activePage: Page | null = null;

  constructor(
    private readonly options: PlaywrightTimelineBrowserOptions,
    private readonly logger: Logger,
  ) {
    this.navigationAttempts = options.navigationAttempts ?? 3;
    this.operationTimeoutMs = options.operationTimeoutMs ?? 20_000;
    this.profileRole = options.profileRole ?? "collector";
    this.profileDirectory = configuredProfilePath(options.profileDirectory, options.repositoryRoot, this.profileRole === "collector" ? "Collector" : "Publisher", options.allowExternalProfile);
    this.maxScrolls = options.maxScrolls ?? 60;
    this.idleScrolls = options.idleScrolls ?? 8;
    this.scrollDelayMs = options.scrollDelayMs ?? 1_200;
    this.maxSourceDurationMs = options.maxSourceDurationMs ?? 300_000;
  }

  private async context(): Promise<BrowserContext> {
    const label = this.profileRole === "collector" ? "Collector" : "Publisher";
    if (this.options.browserProfileDirectory) {
      await stat(resolve(this.profileDirectory, "Local State")).catch(() => { throw new Error(`${label} browser Local State is missing from ${this.profileDirectory}`); });
      await stat(resolve(this.profileDirectory, this.options.browserProfileDirectory)).catch(() => { throw new Error(`${label} browser profile ${this.options.browserProfileDirectory} is missing from ${this.profileDirectory}`); });
    } else if (!this.options.allowExternalProfile) await mkdir(this.profileDirectory, { recursive: true });
    const browserId = this.options.browserId ?? this.options.browserChannel ?? "msedge";
    this.logger.info({ operation: `${this.profileRole}.browser.launch.start`, browserId, profileDirectory: this.profileDirectory, browserProfileDirectory: this.options.browserProfileDirectory ?? null }, `Launching authenticated ${this.profileRole} browser profile`);
    const context = await chromium.launchPersistentContext(this.profileDirectory, collectorBrowserLaunchOptions(this.options));
    this.logger.info({ operation: `${this.profileRole}.browser.launch.complete`, browserId }, `Authenticated ${this.profileRole} browser profile launched`);
    return context;
  }

  private async assertLoggedIn(page: Page, navigateToProfile = false): Promise<string | null> {
    await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: this.operationTimeoutMs });
    const accountMenu = page.locator(xSelectors.accountMenuButton).first();
    await Promise.race([
      accountMenu.waitFor({ state: "visible", timeout: this.operationTimeoutMs }),
      page.locator(xSelectors.loginLink).first().waitFor({ state: "visible", timeout: this.operationTimeoutMs }),
    ]).catch(() => undefined);
    const intervention = page.getByText(/verify your identity|your account is locked|account suspended|unusual activity|complete (the )?captcha|security challenge/i).first();
    const label = this.profileRole === "collector" ? "Collector" : "Publisher";
    if (await intervention.isVisible().catch(() => false)) throw new Error(`${label} X account requires manual intervention`);
    if (!await accountMenu.isVisible().catch(() => false)) throw new Error(`${label} browser profile is not logged in to X`);
    const activeUsername = await detectXUsername(page, xSelectors.accountMenuButton, navigateToProfile);
    if (this.options.expectedUsername) {
      if (!activeUsername || activeUsername !== this.options.expectedUsername.toLowerCase()) throw new Error(`${label} identity mismatch. Expected @${this.options.expectedUsername}.`);
    }
    return activeUsername;
  }

  async checkSession(): Promise<string | null> {
    return this.options.lease.run(async () => {
      const context = await this.context();
      const page = context.pages()[0] ?? await context.newPage();
      try {
        const activeUsername = await this.assertLoggedIn(page, true);
        const account = activeUsername ? `@${activeUsername}` : null;
        this.logger.info({ operation: `${this.profileRole}.session.check`, browserId: this.options.browserId ?? this.options.browserChannel, browserProfileDirectory: this.options.browserProfileDirectory ?? null, account }, `${this.profileRole === "collector" ? "Collector" : "Publisher"} session is authenticated`);
        return account;
      } finally { await context.close().catch(() => undefined); }
    });
  }

  async readPostMetrics(postUrl: string): Promise<PostMetrics> {
    const url = new URL(postUrl);
    if (!["x.com", "www.x.com"].includes(url.hostname) || !/^\/[A-Za-z0-9_]+\/status\/\d+/.test(url.pathname)) throw new Error("Published post URL is not a valid X status URL.");
    const postId = url.pathname.match(/\/status\/(\d+)/)?.[1];
    if (!postId) throw new Error("Published post ID is missing.");
    return this.options.lease.run(async () => {
      const context = await this.context();
      const page = context.pages()[0] ?? await context.newPage();
      page.setDefaultTimeout(this.operationTimeoutMs);
      try {
        await this.assertLoggedIn(page);
        await page.goto(postUrl, { waitUntil: "domcontentloaded", timeout: this.operationTimeoutMs });
        const article = page.locator(xSelectors.timelinePost).filter({ has: page.locator(`a[href*="/status/${postId}"]`) }).first();
        await article.waitFor({ state: "visible", timeout: this.operationTimeoutMs });
        const labels = await article.locator('[aria-label]').evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label") ?? "").filter(Boolean));
        const metrics = parsePostMetricLabels(labels);
        if (!metrics) throw new Error("X did not expose performance metrics for this post.");
        return metrics;
      } finally {
        await context.close().catch(() => undefined);
      }
    });
  }

  async withSession<T>(operation: () => Promise<T>): Promise<T> {
    return this.options.lease.run(async () => {
      const context = await this.context();
      const page = context.pages()[0] ?? await context.newPage();
      page.setDefaultTimeout(this.operationTimeoutMs);
      try {
        await this.assertLoggedIn(page);
        this.activePage = page;
        return await operation();
      } finally {
        this.activePage = null;
        await context.close().catch(() => undefined);
      }
    });
  }

  private async navigateTimeline(page: Page, url: string, sourceLabel: string): Promise<boolean> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.navigationAttempts; attempt += 1) {
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: this.operationTimeoutMs });
        const timelinePost = page.locator(xSelectors.timelinePost).first();
        await Promise.race([
          timelinePost.waitFor({ state: "visible", timeout: this.operationTimeoutMs }),
          page.locator(xSelectors.statusLink).first().waitFor({ state: "visible", timeout: this.operationTimeoutMs }),
          page.getByText(/no (media|bookmarks)|haven't added any posts|doesn’t have any media/i).first().waitFor({ state: "visible", timeout: this.operationTimeoutMs }),
        ]).catch(() => undefined);
        return await timelinePost.isVisible().catch(() => false);
      } catch (error) {
        lastError = error;
        this.logger.warn({
          operation: "collector.navigate",
          sourceAccount: sourceLabel,
          url,
          attempt,
          error: error instanceof Error ? error.message : String(error),
        }, "Timeline navigation attempt failed");
        if (attempt < this.navigationAttempts) {
          await sleep(500 * 2 ** (attempt - 1));
        }
      }
    }

    throw new Error(`Failed to load timeline for ${sourceLabel} after ${this.navigationAttempts} attempts`, {
      cause: lastError,
    });
  }

  private async saveDiagnostic(page: Page, source: SourceAccountInput): Promise<string> {
    const directory = resolve(this.options.diagnosticsDirectory);
    await mkdir(directory, { recursive: true });
    await pruneDiagnosticFiles(directory, "collector-", 50);
    const filename = `collector-${source.username}-${Date.now()}.png`;
    const path = resolve(directory, filename);
    await page.screenshot({ path, fullPage: true, timeout: this.operationTimeoutMs });
    return path;
  }

  async read(source: SourceAccountInput, eligibleLimit: number, options: CollectionOptions = {}): Promise<RawTimelinePost[]> {
    if (this.activePage) return this.readFromPage(this.activePage, source, eligibleLimit, options);
    return this.options.lease.run(() => this.readAuthenticated(source, eligibleLimit, options));
  }

  async readBookmarks(eligibleLimit: number, options: CollectionOptions = {}): Promise<RawTimelinePost[]> {
    if (this.activePage) return this.readBookmarksFromPage(this.activePage, eligibleLimit, options);
    return this.options.lease.run(async () => {
      const context = await this.context();
      const page = context.pages()[0] ?? await context.newPage();
      page.setDefaultTimeout(this.operationTimeoutMs);
      try {
        await this.assertLoggedIn(page);
        return await this.readBookmarksFromPage(page, eligibleLimit, options);
      } finally { await context.close().catch(() => undefined); }
    });
  }

  private async readAuthenticated(source: SourceAccountInput, eligibleLimit: number, options: CollectionOptions): Promise<RawTimelinePost[]> {
    const context = await this.context();
    const page = context.pages()[0] ?? await context.newPage();
    page.setDefaultTimeout(this.operationTimeoutMs);

    try {
      await this.assertLoggedIn(page);
      return await this.readFromPage(page, source, eligibleLimit, options);
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  private async readFromPage(page: Page, source: SourceAccountInput, eligibleLimit: number, options: CollectionOptions): Promise<RawTimelinePost[]> {
    try {
      const candidates = new Map<string, RawTimelinePost>();
      const startedAt = Date.now();
      const normalize = (candidate: RawTimelinePost) => normalizeTimelinePost(candidate, source, { allowReplies: true });
      const mediaUrl = `${source.profileUrl.replace(/\/$/, "")}/media`;
      let loaded = await this.navigateTimeline(page, mediaUrl, `@${source.username}`);
      if (!loaded && await page.locator(xSelectors.statusLink).first().isVisible().catch(() => false)) {
        this.logger.info({ operation: "collector.navigate.fallback", sourceAccount: source.username }, "Media grid lacks tweet metadata; using the profile timeline");
        loaded = await this.navigateTimeline(page, source.profileUrl, `@${source.username}`);
      }
      let scan = loaded ? await this.scanTimeline(page, candidates, eligibleLimit, options, normalize, startedAt) : { scrolls: 0, stopReason: "timeline_empty" };
      let stats = this.collectionStats(candidates, options, normalize);
      if (stats.newFound < eligibleLimit && scan.stopReason !== "cancelled" && scan.stopReason !== "max_duration") {
        const repliesUrl = `${source.profileUrl.replace(/\/$/, "")}/with_replies`;
        if (await this.navigateTimeline(page, repliesUrl, `@${source.username} replies`)) {
          const repliesScan = await this.scanTimeline(page, candidates, eligibleLimit, options, normalize, startedAt);
          scan = { scrolls: scan.scrolls + repliesScan.scrolls, stopReason: repliesScan.stopReason };
          stats = this.collectionStats(candidates, options, normalize);
        }
      }
      const posts = [...candidates.values()];
      const stopReason = stats.newFound >= eligibleLimit ? "target_reached" : scan.stopReason;
      await options.onProgress?.({ eligibleExamined: stats.eligibleFound, knownSkipped: stats.knownSkipped, newFound: stats.newFound, targetNew: eligibleLimit, stopReason });
      this.logger.info({
        operation: "collector.timeline.complete",
        sourceAccount: source.username,
        requested: eligibleLimit,
        candidatesSeen: posts.length,
        eligibleFound: stats.eligibleFound,
        scrolls: scan.scrolls,
        stopReason,
      }, stats.newFound >= eligibleLimit ? "Collector fulfilled the eligible post request" : "Collector exhausted its bounded timeline search before fulfilling the request");
      return posts;
    } catch (error) {
      let screenshotPath: string | undefined;
      try {
        screenshotPath = await this.saveDiagnostic(page, source);
      } catch (screenshotError) {
        this.logger.error({
          operation: "collector.diagnostic",
          sourceAccount: source.username,
          error: screenshotError instanceof Error ? screenshotError.message : String(screenshotError),
        }, "Failed to save collector diagnostic screenshot");
      }
      throw new Error(`Timeline extraction failed for @${source.username}${screenshotPath ? `; screenshot: ${screenshotPath}` : ""}`, {
        cause: error,
      });
    }
  }

  private async readBookmarksFromPage(page: Page, eligibleLimit: number, options: CollectionOptions): Promise<RawTimelinePost[]> {
    const candidates = new Map<string, RawTimelinePost>();
    const startedAt = Date.now();
    if (!await this.navigateTimeline(page, "https://x.com/i/bookmarks", "bookmarks")) {
      await options.onProgress?.({ eligibleExamined: 0, knownSkipped: 0, newFound: 0, targetNew: eligibleLimit, stopReason: "timeline_empty" });
      return [];
    }
    const scan = await this.scanTimeline(page, candidates, eligibleLimit, options, normalizeBookmarkedPost, startedAt);
    const stats = this.collectionStats(candidates, options, normalizeBookmarkedPost);
    await options.onProgress?.({ eligibleExamined: stats.eligibleFound, knownSkipped: stats.knownSkipped, newFound: stats.newFound, targetNew: eligibleLimit, stopReason: stats.newFound >= eligibleLimit ? "target_reached" : scan.stopReason });
    this.logger.info({ operation: "collector.bookmarks.complete", requested: eligibleLimit, candidatesSeen: candidates.size, eligibleFound: stats.eligibleFound, newFound: stats.newFound, scrolls: scan.scrolls }, "Bookmark collection completed");
    return [...candidates.values()];
  }

  private collectionStats(candidates: Map<string, RawTimelinePost>, options: CollectionOptions, normalize: (candidate: RawTimelinePost) => { platformPostId: string } | null) {
    const eligible = [...candidates.values()].map(normalize).filter((candidate): candidate is { platformPostId: string } => candidate !== null);
    const knownSkipped = eligible.filter((candidate) => options.knownPostIds?.has(candidate.platformPostId)).length;
    return { eligibleFound: eligible.length, knownSkipped, newFound: eligible.length - knownSkipped };
  }

  private async scanTimeline(page: Page, candidates: Map<string, RawTimelinePost>, eligibleLimit: number, options: CollectionOptions, normalize: (candidate: RawTimelinePost) => { platformPostId: string } | null, startedAt: number): Promise<{ scrolls: number; stopReason: string }> {
    let scrolls = 0;
    let idleRounds = 0;
    let stopReason = "timeline_exhausted";
    while (true) {
      if (await options.shouldCancel?.()) { stopReason = "cancelled"; break; }
      const articles = page.locator(xSelectors.timelinePost);
      const visible = await extractPosts(page);
      const count = visible.length;
      const added = mergeTimelineCandidates(candidates, visible);
      idleRounds = added === 0 ? idleRounds + 1 : 0;
      const stats = this.collectionStats(candidates, options, normalize);
      await options.onProgress?.({ eligibleExamined: stats.eligibleFound, knownSkipped: stats.knownSkipped, newFound: stats.newFound, targetNew: eligibleLimit });
      if (stats.newFound >= eligibleLimit) { stopReason = "target_reached"; break; }
      if (scrolls >= this.maxScrolls) { stopReason = "max_scrolls"; break; }
      if (Date.now() - startedAt >= this.maxSourceDurationMs) { stopReason = "max_duration"; break; }
      if (idleRounds >= this.idleScrolls) { stopReason = "timeline_exhausted"; break; }
      if (count > 0) await articles.last().scrollIntoViewIfNeeded().catch(() => undefined);
      await page.mouse.wheel(0, 1_800);
      await page.waitForTimeout(this.scrollDelayMs);
      scrolls += 1;
    }
    return { scrolls, stopReason };
  }
}
