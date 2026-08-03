import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import pino from "pino";
import type { Locator } from "playwright";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, PublishRepository, SourceAccountRepository, SourcePostRepository } from "@cenblu/database";
import { calculateUploadTimeoutMs, captionsMatch, classifyBrowserLaunchError, cloneEdgeProfile, isPointerInterceptionError, keyboardFallbackAllowed, LocalPublishMediaVerifier, persistentContextOptions, publishButtonReady, PublisherError, PublishService, resolveCaption, selectVisiblePublishButton, validateCaption, type Publisher } from "@cenblu/publisher";
import { automaticPublishingEnabled } from "../apps/dashboard/app/lib/automatic-publisher";

const logger = pino({ level: "silent" });
const videos = resolve("storage/temp/publisher-test/videos");

async function publishablePost(platformPostId: string, fileExists = true): Promise<{ path: string }> {
  const account = await new SourceAccountRepository(prisma).create({ username: `publisher_${platformPostId}` });
  await new SourcePostRepository(prisma).persistNew(account.id, [{ platformPostId, sourceUrl: `https://x.com/publisher_${platformPostId}/status/${platformPostId}`, text: "caption", postedAt: new Date(), mediaType: "VIDEO" }], new Date());
  const sourcePost = await prisma.sourcePost.findUniqueOrThrow({ where: { platformPostId } });
  const path = resolve(videos, `${platformPostId}.mp4`);
  if (fileExists) { await mkdir(videos, { recursive: true }); await writeFile(path, "video"); }
  await prisma.mediaAsset.create({ data: { sourcePostId: sourcePost.id, filePath: path, mimeType: "video/mp4", fileSize: 5, durationSeconds: 1, width: 1, height: 1, checksum: "checksum" } });
  await prisma.sourcePost.update({ where: { id: sourcePost.id }, data: { status: "DOWNLOADED" } });
  return { path };
}

beforeEach(async () => {
  await prisma.publishedPost.deleteMany();
  await prisma.publishJob.deleteMany();
  await prisma.mediaAsset.deleteMany();
  await prisma.downloadJob.deleteMany();
  await prisma.sourcePost.deleteMany();
  await prisma.sourceAccount.deleteMany();
  await rm(videos, { recursive: true, force: true });
});

afterAll(async () => prisma.$disconnect());

describe("publisher", () => {
  it("builds installed Edge launch options for the selected profile", () => {
    expect(persistentContextOptions({
      profileDirectory: "C:/Edge/User Data",
      browserChannel: "msedge",
      browserProfileDirectory: "Profile 1",
      allowExternalProfile: true,
      lease: { run: async (operation) => operation() },
      diagnosticsDirectory: "storage/logs",
      headless: false,
    })).toEqual({ headless: false, timeout: 20_000, channel: "msedge", args: ["--profile-directory=Profile 1"] });
  });

  it("classifies a locked Edge profile as manual intervention", () => {
    expect(classifyBrowserLaunchError(new Error("user data directory is already in use"))).toMatchObject({
      kind: "PROFILE_IN_USE",
      retryable: false,
      manualAttention: true,
    });
  });

  it("does not treat generic challenge text as a browser launch failure", () => {
    expect(classifyBrowserLaunchError(new Error("generic challenge text"))).toMatchObject({ kind: "BROWSER_LAUNCH_FAILED" });
  });

  it("selects the first visible composer Post button instead of a hidden duplicate", () => {
    let selector = "";
    let selectedFirst = false;
    const chosen = {} as Locator;
    const dialog = {
      locator(value: string) {
        selector = value;
        return { first() { selectedFirst = true; return chosen; } };
      },
    } as unknown as Locator;
    expect(selectVisiblePublishButton(dialog)).toBe(chosen);
    expect(selector).toContain("tweetButton']:visible");
    expect(selector).toContain("tweetButtonInline']:visible");
    expect(selectedFirst).toBe(true);
  });

  it("treats only a visible enabled Post button as ready", () => {
    expect(publishButtonReady({ visible: true, disabled: false, ariaDisabled: null })).toBe(true);
    expect(publishButtonReady({ visible: true, disabled: false, ariaDisabled: "false" })).toBe(true);
    expect(publishButtonReady({ visible: false, disabled: false, ariaDisabled: null })).toBe(false);
    expect(publishButtonReady({ visible: true, disabled: true, ariaDisabled: null })).toBe(false);
    expect(publishButtonReady({ visible: true, disabled: false, ariaDisabled: "true" })).toBe(false);
  });

  it("calculates adaptive upload deadlines from size and duration", () => {
    expect(calculateUploadTimeoutMs(5_000_000, 30, 2, 45 * 60_000)).toBe(5 * 60_000);
    const longVideoTimeout = calculateUploadTimeoutMs(359_152_636, 3_613, 2, 45 * 60_000);
    expect(longVideoTimeout).toBeGreaterThan(41 * 60_000);
    expect(longVideoTimeout).toBeLessThan(43 * 60_000);
    expect(calculateUploadTimeoutMs(2_000_000_000, 20_000, 2, 45 * 60_000)).toBe(45 * 60_000);
  });

  it("starts scheduled publishing only in automatic mode with a verified session", () => {
    expect(automaticPublishingEnabled("ASSISTED", "2026-08-01T00:00:00.000Z")).toBe(false);
    expect(automaticPublishingEnabled("AUTOMATIC", undefined)).toBe(false);
    expect(automaticPublishingEnabled("AUTOMATIC", "2026-08-01T00:00:00.000Z")).toBe(true);
  });

  it("allows keyboard fallback only for pointer interception on a still-ready composer", () => {
    const interception = new Error("subtree intercepts pointer events");
    const ready = { visible: true, disabled: false, ariaDisabled: null };
    expect(isPointerInterceptionError(interception)).toBe(true);
    expect(keyboardFallbackAllowed(interception, ready, true, null)).toBe(true);
    expect(keyboardFallbackAllowed(new Error("element detached"), ready, true, null)).toBe(false);
    expect(keyboardFallbackAllowed(interception, { ...ready, disabled: true }, true, null)).toBe(false);
    expect(keyboardFallbackAllowed(interception, ready, false, null)).toBe(false);
    expect(keyboardFallbackAllowed(interception, ready, true, "Upload failed")).toBe(false);
  });

  it("clones only the selected Edge profile and excludes browser caches", async () => {
    const fixtureRoot = resolve("storage/temp/edge-profile-clone-test");
    const source = resolve(fixtureRoot, "source");
    const destination = resolve(fixtureRoot, "destination");
    await rm(fixtureRoot, { recursive: true, force: true });
    await mkdir(resolve(source, "Profile 1", "Cache"), { recursive: true });
    await writeFile(resolve(source, "Local State"), "local-state");
    await writeFile(resolve(source, "Profile 1", "Cookies"), "session");
    await writeFile(resolve(source, "Profile 1", "Cache", "cache.bin"), "cache");
    await cloneEdgeProfile(source, "Profile 1", destination, async () => undefined);
    expect(await readFile(resolve(destination, "Profile 1", "Cookies"), "utf8")).toBe("session");
    await expect(stat(resolve(destination, "Profile 1", "Cache", "cache.bin"))).rejects.toThrow();
  });

  it("validates empty and over-length captions before publishing", () => {
    expect(() => validateCaption("", false)).toThrow("cannot be empty");
    expect(validateCaption("", true)).toBe("");
    expect(() => validateCaption("a".repeat(281), false)).toThrow("exceeds 280");
    expect(validateCaption("  caption  ", false)).toBe("caption");
  });

  it("renders literal template text and rotates only on a three-hyphen separator line", () => {
    const source = { platformPostId: "123456", text: "Source caption", sourceUrl: "https://x.com/source/status/123456", sourceAccount: { username: "source", captionTemplate: null, attributionTemplate: null, hashtagRules: null } };
    expect(resolveCaption(source, "{sourceCaption} --\n\nfrom\n\nblablabla")).toBe("Source caption --\n\nfrom\n\nblablabla");
    const rotation = "first {sourceCaption}\r\n  ---  \r\nsecond {sourceUsername}";
    expect(resolveCaption({ ...source, platformPostId: "2" }, rotation)).toBe("first Source caption");
    expect(resolveCaption({ ...source, platformPostId: "3" }, rotation)).toBe("second @source");
  });

  it("compares composer captions across browser line-ending and space normalization", () => {
    expect(captionsMatch("Line one\n\nLine two", "Line one\r\n\r\nLine two")).toBe(true);
    expect(captionsMatch("Caption\u00a0text", "Caption text")).toBe(true);
    expect(captionsMatch("Caption\u2028text", "Caption\ntext")).toBe(true);
    expect(captionsMatch("Heart ❤️", "Heart ❤")).toBe(true);
    expect(captionsMatch("Caption\u200B text", "Caption text")).toBe(true);
    expect(captionsMatch("", "Expected caption")).toBe(false);
    expect(captionsMatch("Different caption", "Expected caption")).toBe(false);
    expect(captionsMatch("Expected caption", "caption Expected")).toBe(false);
  });

  it("claims and completes a job transactionally without duplicate records", async () => {
    await publishablePost("40001");
    const repository = new PublishRepository(prisma);
    const first = await repository.createForPost("40001", "caption");
    expect((await repository.createForPost("40001", "different")).id).toBe(first.id);
    const claimed = await repository.claimNext(new Date(), new Date(0));
    expect(claimed).toMatchObject({ id: first.id, status: "RUNNING", attemptCount: 1 });
    await repository.complete(claimed!.id, claimed!.claimToken!, { platformPostId: "90001", platformUrl: "https://x.com/cenblu/status/90001" }, new Date());
    expect(await repository.claimNext(new Date(), new Date(0))).toBeNull();
    expect(await prisma.publishedPost.count()).toBe(1);
    expect(await prisma.sourcePost.findUniqueOrThrow({ where: { platformPostId: "40001" } })).toMatchObject({ status: "PUBLISHED" });
  });

  it("approves selected review jobs atomically with a shared schedule", async () => {
    await publishablePost("40021");
    await publishablePost("40022");
    const posts = await prisma.sourcePost.findMany({ where: { platformPostId: { in: ["40021", "40022"] } }, include: { mediaAsset: true } });
    const jobs = [];
    for (const post of posts) jobs.push(await prisma.publishJob.create({ data: { sourcePostId: post.id, mediaAssetId: post.mediaAsset!.id, caption: post.text, status: "READY_FOR_REVIEW" } }));
    const repository = new PublishRepository(prisma);
    const schedule = new Date("2026-08-04T02:15:00.000Z");
    await repository.approveMany(jobs.map((job) => job.id), schedule);
    expect(await prisma.publishJob.count({ where: { id: { in: jobs.map((job) => job.id) }, status: "APPROVED", scheduledFor: schedule } })).toBe(2);

    await prisma.publishJob.update({ where: { id: jobs[1].id }, data: { status: "COMPLETED" } });
    await prisma.publishJob.update({ where: { id: jobs[0].id }, data: { status: "READY_FOR_REVIEW" } });
    await expect(repository.approveMany(jobs.map((job) => job.id), null)).rejects.toThrow("can no longer be approved");
    expect((await prisma.publishJob.findUniqueOrThrow({ where: { id: jobs[0].id } })).status).toBe("READY_FOR_REVIEW");
  });

  it("fences completion with the current claim token and keeps active heartbeats from going stale", async () => {
    await publishablePost("40006");
    const repository = new PublishRepository(prisma);
    await repository.createForPost("40006", "caption");
    const now = new Date();
    const claimed = await repository.claimNext(now, new Date(0));
    expect(claimed?.claimToken).toBeTruthy();
    await prisma.publishJob.update({ where: { id: claimed!.id }, data: { startedAt: new Date(0) } });

    expect(await repository.claimNext(now, new Date(now.getTime() - 15 * 60_000))).toBeNull();
    expect(await repository.complete(claimed!.id, "wrong-token", { platformPostId: "90006", platformUrl: null }, now)).toBe(false);
    expect(await prisma.publishJob.findUniqueOrThrow({ where: { id: claimed!.id } })).toMatchObject({ status: "RUNNING", claimToken: claimed!.claimToken });
  });

  it("returns an operator-deleted incorrect publication to Review without losing caption or media", async () => {
    await publishablePost("40009");
    const repository = new PublishRepository(prisma);
    const job = await repository.createForPost("40009", "caption to preserve");
    const claimed = await repository.claimById(job.id, new Date(), new Date(0));
    await repository.complete(claimed!.id, claimed!.claimToken!, { platformPostId: "90009", platformUrl: "https://x.com/cenblu/status/90009" }, new Date());

    await repository.recoverIncorrectPublishedPost(job.id);

    expect(await prisma.publishedPost.count({ where: { publishJobId: job.id } })).toBe(0);
    expect(await prisma.publishJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "READY_FOR_REVIEW", caption: "caption to preserve", publishedAt: null });
    expect(await prisma.mediaAsset.count()).toBe(1);
    expect(await prisma.sourcePost.findUniqueOrThrow({ where: { platformPostId: "40009" } })).toMatchObject({ status: "READY_FOR_REVIEW" });
  });

  it("does not recover a publication after its local media is marked removed", async () => {
    await publishablePost("40010");
    const repository = new PublishRepository(prisma);
    const job = await repository.createForPost("40010", "caption to preserve");
    const claimed = await repository.claimById(job.id, new Date(), new Date(0));
    await repository.complete(claimed!.id, claimed!.claimToken!, { platformPostId: "90010", platformUrl: "https://x.com/cenblu/status/90010" }, new Date());
    await prisma.mediaAsset.update({ where: { sourcePostId: claimed!.sourcePostId }, data: { localRemovedAt: new Date() } });

    await expect(repository.recoverIncorrectPublishedPost(job.id)).rejects.toThrow("local media has been removed");

    expect(await prisma.publishedPost.count({ where: { publishJobId: job.id } })).toBe(1);
    expect(await prisma.publishJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "COMPLETED" });
  });

  it("claims only the explicitly selected approved publish job", async () => {
    await publishablePost("40011");
    await publishablePost("40012");
    const repository = new PublishRepository(prisma);
    const first = await repository.createForPost("40011", "first caption");
    const second = await repository.createForPost("40012", "second caption");
    const claimed = await repository.claimById(second.id, new Date(), new Date(0));
    expect(claimed).toMatchObject({ id: second.id, status: "RUNNING" });
    expect(await prisma.publishJob.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ status: "APPROVED", attemptCount: 0 });
  });

  it("returns an approved job to editable review instead of cancelling it", async () => {
    await publishablePost("40013");
    const repository = new PublishRepository(prisma);
    const job = await repository.createForPost("40013", "editable caption");
    await prisma.publishJob.update({ where: { id: job.id }, data: { scheduledFor: new Date(Date.now() + 60_000) } });

    await repository.cancel(job.id);

    expect(await prisma.publishJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "READY_FOR_REVIEW", scheduledFor: null });
    expect(await prisma.sourcePost.findUniqueOrThrow({ where: { platformPostId: "40013" } })).toMatchObject({ status: "READY_FOR_REVIEW" });
  });

  it("supports safe operator status changes and keeps source state synchronized", async () => {
    await publishablePost("40014");
    const repository = new PublishRepository(prisma);
    const job = await repository.createForPost("40014", "operator caption");

    await repository.setOperatorStatus(job.id, "REJECTED");
    expect(await prisma.sourcePost.findUniqueOrThrow({ where: { platformPostId: "40014" } })).toMatchObject({ status: "SKIPPED" });
    await repository.setOperatorStatus(job.id, "READY_FOR_REVIEW");
    expect(await prisma.publishJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "READY_FOR_REVIEW" });
    expect(await prisma.sourcePost.findUniqueOrThrow({ where: { platformPostId: "40014" } })).toMatchObject({ status: "READY_FOR_REVIEW" });
  });

  it("finds only scheduled jobs whose publish time has arrived", async () => {
    await publishablePost("40021");
    await publishablePost("40022");
    await publishablePost("40023");
    const repository = new PublishRepository(prisma);
    const due = await repository.createForPost("40021", "due");
    const future = await repository.createForPost("40022", "future");
    const manual = await repository.createForPost("40023", "manual");
    const now = new Date();
    await prisma.publishJob.update({ where: { id: due.id }, data: { scheduledFor: new Date(now.getTime() - 60_000) } });
    await prisma.publishJob.update({ where: { id: future.id }, data: { scheduledFor: new Date(now.getTime() + 60_000) } });

    expect(await repository.findDueScheduledIds(now)).toEqual([due.id]);
    expect((await prisma.publishJob.findUniqueOrThrow({ where: { id: manual.id } })).scheduledFor).toBeNull();
  });

  it("publishes a due scheduled job while leaving a future job untouched", async () => {
    await publishablePost("40024");
    await publishablePost("40025");
    const repository = new PublishRepository(prisma);
    const due = await repository.createForPost("40024", "due caption");
    const future = await repository.createForPost("40025", "future caption");
    const now = new Date();
    await prisma.publishJob.update({ where: { id: due.id }, data: { scheduledFor: new Date(now.getTime() - 60_000) } });
    await prisma.publishJob.update({ where: { id: future.id }, data: { scheduledFor: new Date(now.getTime() + 60_000) } });
    let calls = 0;
    const publisher: Publisher = { publish: async () => { calls += 1; return { platformPostId: "90024", platformUrl: "https://x.com/cenblu/status/90024" }; } };
    const service = new PublishService(repository, publisher, new LocalPublishMediaVerifier(videos), logger, false);

    for (const jobId of await repository.findDueScheduledIds(now)) expect(await service.processJob(jobId)).toBe(true);

    expect(calls).toBe(1);
    expect(await prisma.publishJob.findUniqueOrThrow({ where: { id: due.id } })).toMatchObject({ status: "COMPLETED", attemptCount: 1 });
    expect(await prisma.publishedPost.findUniqueOrThrow({ where: { publishJobId: due.id } })).toMatchObject({ platformPostId: "90024" });
    expect(await prisma.publishJob.findUniqueOrThrow({ where: { id: future.id } })).toMatchObject({ status: "APPROVED", attemptCount: 0 });
  });

  it("fails missing local media before invoking the browser publisher", async () => {
    await publishablePost("40002", false);
    const repository = new PublishRepository(prisma);
    await repository.createForPost("40002", "caption");
    let invoked = false;
    const publisher: Publisher = { publish: async () => { invoked = true; return { platformPostId: null, platformUrl: null }; } };
    await new PublishService(repository, publisher, new LocalPublishMediaVerifier(videos), logger, false).processNext();
    expect(invoked).toBe(false);
    expect(await prisma.publishJob.findFirstOrThrow()).toMatchObject({ status: "FAILED", lastError: expect.stringContaining("MISSING_MEDIA") });
  });

  it("persists successful mocked publication and does not republish it", async () => {
    await publishablePost("40003");
    const repository = new PublishRepository(prisma);
    await repository.createForPost("40003", "caption");
    let calls = 0;
    const publisher: Publisher = { publish: async () => { calls += 1; return { platformPostId: "90003", platformUrl: "https://x.com/cenblu/status/90003" }; } };
    const service = new PublishService(repository, publisher, new LocalPublishMediaVerifier(videos), logger, false);
    expect(await service.processPending()).toBe(1);
    expect(await service.processPending()).toBe(0);
    expect(calls).toBe(1);
  });

  it("marks login and challenge failures for manual attention", async () => {
    await publishablePost("40004");
    const repository = new PublishRepository(prisma);
    await repository.createForPost("40004", "caption");
    const publisher: Publisher = { publish: async () => { throw new PublisherError("NOT_LOGGED_IN", "login required", false, true); } };
    await new PublishService(repository, publisher, new LocalPublishMediaVerifier(videos), logger, false).processNext();
    expect(await prisma.publishJob.findFirstOrThrow()).toMatchObject({ status: "MANUAL_ATTENTION", lastError: "NOT_LOGGED_IN: login required" });
  });

  it("retries one processing timeout and then fails without uncertain-publication attention", async () => {
    await publishablePost("40005");
    const repository = new PublishRepository(prisma);
    await repository.createForPost("40005", "caption");
    const publisher: Publisher = { publish: async () => { throw new PublisherError("PROCESSING_TIMEOUT", "slow upload", true, false); } };
    const service = new PublishService(repository, publisher, new LocalPublishMediaVerifier(videos), logger, false);

    await service.processNext();
    const retry = await prisma.publishJob.findFirstOrThrow();
    expect(retry).toMatchObject({ status: "RETRY_WAIT", attemptCount: 1 });
    await prisma.publishJob.update({ where: { id: retry.id }, data: { nextAttemptAt: new Date(0) } });

    await service.processNext();
    expect(await prisma.publishJob.findFirstOrThrow()).toMatchObject({ status: "FAILED", attemptCount: 2, lastError: "PROCESSING_TIMEOUT: slow upload" });
  });
});
