import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPublishNotifier, NotificationEmitter, NotificationDispatcher, type NotificationTransport, type NotificationSendResult } from "@cenblu/notifications";
import { NotificationOutboxRepository, OperationalEventRepository, prisma, SettingsRepository } from "@cenblu/database";

beforeEach(async () => {
  await prisma.notificationOutbox.deleteMany();
  await prisma.operationalEvent.deleteMany();
});

afterAll(async () => prisma.$disconnect());

describe("notification outbox", () => {
  it("enqueues and claims one pending notification with a claim token", async () => {
    const outbox = new NotificationOutboxRepository(prisma);
    const id = await outbox.enqueue({ channel: "discord", recipient: "123", text: "hello" });
    const claimed = await outbox.claimNext(new Date(), new Date(0));
    expect(claimed).toMatchObject({ id, channel: "discord", recipient: "123", text: "hello" });
    expect(claimed?.claimToken).toBeTruthy();
  });

  it("fences completion with the current claim token", async () => {
    const outbox = new NotificationOutboxRepository(prisma);
    await outbox.enqueue({ channel: "discord", recipient: "123", text: "hello" });
    const claimed = await outbox.claimNext(new Date(), new Date(0));
    expect(await outbox.complete(claimed!.id, "wrong-token")).toBe(false);
    expect(await outbox.complete(claimed!.id, claimed!.claimToken!)).toBe(true);
    expect(await outbox.countPending()).toBe(0);
  });

  it("recovers stale sending claims back to pending", async () => {
    const outbox = new NotificationOutboxRepository(prisma);
    await outbox.enqueue({ channel: "discord", recipient: "123", text: "hello" });
    const claimed = await outbox.claimNext(new Date(), new Date(0));
    await prisma.notificationOutbox.update({ where: { id: claimed!.id }, data: { updatedAt: new Date(Date.now() - 30 * 60_000) } });
    const again = await outbox.claimNext(new Date(), new Date(Date.now() - 15 * 60_000));
    expect(again?.id).toBe(claimed!.id);
    expect(again?.claimToken).not.toBe(claimed!.claimToken);
  });

  it("marks dead after the configured max attempts", async () => {
    const outbox = new NotificationOutboxRepository(prisma);
    await outbox.enqueue({ channel: "discord", recipient: "123", text: "hello" });
    const claimed = await outbox.claimNext(new Date(), new Date(0));
    expect(await outbox.fail(claimed!.id, claimed!.claimToken!, "boom", null, true)).toBe(true);
    const record = await prisma.notificationOutbox.findUniqueOrThrow({ where: { id: claimed!.id } });
    expect(record.status).toBe("DEAD");
  });

  it("reports counts, last delivery, and last error", async () => {
    const outbox = new NotificationOutboxRepository(prisma);
    await outbox.enqueue({ channel: "discord", recipient: "123", text: "one" });
    const claimed = await outbox.claimNext(new Date(), new Date(0));
    await outbox.complete(claimed!.id, claimed!.claimToken!);
    await outbox.enqueue({ channel: "discord", recipient: "123", text: "two" });
    const claimedTwo = await outbox.claimNext(new Date(), new Date(0));
    await outbox.fail(claimedTwo!.id, claimedTwo!.claimToken!, "boom", null, true);

    const summary = await outbox.statusSummary();
    expect(summary).toMatchObject({ pending: 0, sent: 1, dead: 1 });
    expect((await outbox.latestDelivery())?.sentAt).toBeTruthy();
    expect((await outbox.latestFailure())?.error).toBe("boom");
  });
});

describe("notification emitter", () => {
  it("enqueues a message when enabled with a recipient", async () => {
    const events = new OperationalEventRepository(prisma);
    const outbox = new NotificationOutboxRepository(prisma);
    const emitter = new NotificationEmitter(events, outbox);
    const emitted = await emitter.emitPublishFailure({
      jobId: "job-1", platformPostId: "90001", publisherIdentityId: "pub-1", error: "SUBMISSION_FAILED: nope", attemptCount: 1, manualAttention: false, retryable: true,
    }, { enabled: true, channels: { discord: "123" } });
    expect(emitted).toBe(true);
    expect(await prisma.operationalEvent.count()).toBe(1);
    expect(await outbox.countPending()).toBe(1);
  });

  it("does nothing when disabled or missing recipients", async () => {
    const events = new OperationalEventRepository(prisma);
    const outbox = new NotificationOutboxRepository(prisma);
    const emitter = new NotificationEmitter(events, outbox);
    await emitter.emitPublishFailure({ jobId: "job-2", platformPostId: "90002", publisherIdentityId: null, error: "x", attemptCount: 1, manualAttention: false, retryable: false }, { enabled: false, channels: { discord: "123" } });
    await emitter.emitPublishFailure({ jobId: "job-3", platformPostId: "90003", publisherIdentityId: null, error: "x", attemptCount: 1, manualAttention: false, retryable: false }, { enabled: true, channels: {} });
    expect(await prisma.operationalEvent.count()).toBe(0);
    expect(await outbox.countPending()).toBe(0);
  });

  it("dedupes repeated failures for the same job", async () => {
    const events = new OperationalEventRepository(prisma);
    const outbox = new NotificationOutboxRepository(prisma);
    const emitter = new NotificationEmitter(events, outbox, 60 * 60_000);
    const context = { jobId: "job-4", platformPostId: "90004", publisherIdentityId: null, error: "x", attemptCount: 1, manualAttention: true, retryable: false };
    expect(await emitter.emitPublishFailure(context, { enabled: true, channels: { discord: "123" } })).toBe(true);
    expect(await emitter.emitPublishFailure(context, { enabled: true, channels: { discord: "123" } })).toBe(false);
    expect(await prisma.operationalEvent.count()).toBe(1);
    expect(await outbox.countPending()).toBe(1);
  });

  it("resolves the publisher label through the resolver", async () => {
    const events = new OperationalEventRepository(prisma);
    const outbox = new NotificationOutboxRepository(prisma);
    const emitter = new NotificationEmitter(events, outbox, undefined, async () => "Publisher Two");
    await emitter.emitPublishFailure({ jobId: "job-5", platformPostId: "90005", publisherIdentityId: "pub-2", error: "x", attemptCount: 2, manualAttention: true, retryable: false }, { enabled: true, channels: { discord: "123" } });
    const record = await prisma.operationalEvent.findFirstOrThrow();
    expect(record.message).toContain("Publisher Two");
    expect(record.message).toContain("Manual review required");
  });

  it("enqueues one row for the configured channel", async () => {
    const events = new OperationalEventRepository(prisma);
    const outbox = new NotificationOutboxRepository(prisma);
    const emitter = new NotificationEmitter(events, outbox);
    await emitter.emitPublishFailure({ jobId: "job-6", platformPostId: "90006", publisherIdentityId: null, error: "x", attemptCount: 1, manualAttention: false, retryable: false }, { enabled: true, channels: { discord: "456" } });
    expect(await outbox.countPending()).toBe(1);
    const rows = await prisma.notificationOutbox.findMany({ orderBy: { channel: "asc" }, select: { channel: true, recipient: true } });
    expect(rows).toEqual([{ channel: "discord", recipient: "456" }]);
    expect(await prisma.operationalEvent.count()).toBe(1);
  });

  it("enqueues a published-post notification to the configured channel", async () => {
    const events = new OperationalEventRepository(prisma);
    const outbox = new NotificationOutboxRepository(prisma);
    const emitter = new NotificationEmitter(events, outbox, undefined, async () => "Publisher One");
    const emitted = await emitter.emitPublishedPost({ jobId: "job-7", platformPostId: "90007", publisherIdentityId: "pub-3", platformUrl: "https://x.com/a/status/90007" }, { enabled: true, channels: { discord: "456" } });
    expect(emitted).toBe(true);
    expect(await outbox.countPending()).toBe(1);
    const record = await prisma.operationalEvent.findFirstOrThrow();
    expect(record.type).toBe("publish.success");
    expect(record.severity).toBe("INFO");
    expect(record.message).toContain("Published X post 90007 via Publisher One");
    expect(record.message).toContain("https://x.com/a/status/90007");
    expect(record.message).toContain("Please confirm it posted");
  });

  it("dedupes repeated published-post notifications for the same job", async () => {
    const events = new OperationalEventRepository(prisma);
    const outbox = new NotificationOutboxRepository(prisma);
    const emitter = new NotificationEmitter(events, outbox, 60 * 60_000);
    const context = { jobId: "job-8", platformPostId: "90008", publisherIdentityId: null, platformUrl: null };
    expect(await emitter.emitPublishedPost(context, { enabled: true, channels: { discord: "123" } })).toBe(true);
    expect(await emitter.emitPublishedPost(context, { enabled: true, channels: { discord: "123" } })).toBe(false);
    expect(await prisma.operationalEvent.count()).toBe(1);
    expect(await outbox.countPending()).toBe(1);
  });

  it("does nothing for a published-post notification when disabled", async () => {
    const events = new OperationalEventRepository(prisma);
    const outbox = new NotificationOutboxRepository(prisma);
    const emitter = new NotificationEmitter(events, outbox);
    expect(await emitter.emitPublishedPost({ jobId: "job-9", platformPostId: "90009", publisherIdentityId: null, platformUrl: null }, { enabled: false, channels: { discord: "123" } })).toBe(false);
    expect(await prisma.operationalEvent.count()).toBe(0);
    expect(await outbox.countPending()).toBe(0);
  });
});

describe("notification dispatcher", () => {
  class FakeTransport implements NotificationTransport {
    calls: string[] = [];
    constructor(private readonly result: NotificationSendResult) {}
    async send(recipient: string, text: string): Promise<NotificationSendResult> { this.calls.push(`${recipient}:${text}`); return this.result; }
  }

  it("delivers pending notifications and marks them sent", async () => {
    const outbox = new NotificationOutboxRepository(prisma);
    await outbox.enqueue({ channel: "discord", recipient: "123", text: "one" });
    await outbox.enqueue({ channel: "discord", recipient: "123", text: "two" });
    const transport = new FakeTransport({ ok: true });
    const dispatcher = new NotificationDispatcher(outbox, { discord: transport }, { maxAttempts: 3, maxBackoffMs: 60_000, staleAfterMs: 15 * 60_000 });
    expect(await dispatcher.runOnce()).toBe(2);
    expect(transport.calls).toHaveLength(2);
    expect(await outbox.countPending()).toBe(0);
  });

  it("routes rows to the transport for their channel", async () => {
    const outbox = new NotificationOutboxRepository(prisma);
    await outbox.enqueue({ channel: "discord", recipient: "456", text: "dc" });
    await outbox.enqueue({ channel: "email", recipient: "123", text: "mail" });
    const discord = new FakeTransport({ ok: true });
    const dispatcher = new NotificationDispatcher(outbox, { discord }, { maxAttempts: 3, maxBackoffMs: 60_000, staleAfterMs: 15 * 60_000 });
    expect(await dispatcher.runOnce()).toBe(1);
    expect(discord.calls).toEqual(["456:dc"]);
  });

  it("fails rows whose channel has no transport", async () => {
    const outbox = new NotificationOutboxRepository(prisma);
    await outbox.enqueue({ channel: "email", recipient: "123", text: "one" });
    const dispatcher = new NotificationDispatcher(outbox, {}, { maxAttempts: 3, maxBackoffMs: 60_000, staleAfterMs: 15 * 60_000 });
    expect(await dispatcher.runOnce()).toBe(0);
    const record = await prisma.notificationOutbox.findFirstOrThrow();
    expect(record.status).toBe("DEAD");
    expect(record.lastError).toContain("No transport configured");
  });

  it("backs off after a transient failure and retries later", async () => {
    const outbox = new NotificationOutboxRepository(prisma);
    await outbox.enqueue({ channel: "discord", recipient: "123", text: "never" });
    const transport = new FakeTransport({ ok: false, error: "network" });
    const dispatcher = new NotificationDispatcher(outbox, { discord: transport }, { maxAttempts: 2, maxBackoffMs: 60_000, staleAfterMs: 15 * 60_000 });
    expect(await dispatcher.runOnce()).toBe(0);
    const record = await prisma.notificationOutbox.findFirstOrThrow();
    expect(record.status).toBe("PENDING");
    expect(record.attemptCount).toBe(1);
    expect(record.nextAttemptAt).toBeTruthy();
  });

  it("marks a notification dead after exhausting max attempts", async () => {
    const outbox = new NotificationOutboxRepository(prisma);
    await outbox.enqueue({ channel: "discord", recipient: "123", text: "never" });
    const transport = new FakeTransport({ ok: false, error: "network" });
    const dispatcher = new NotificationDispatcher(outbox, { discord: transport }, { maxAttempts: 1, maxBackoffMs: 60_000, staleAfterMs: 15 * 60_000 });
    expect(await dispatcher.runOnce()).toBe(0);
    const record = await prisma.notificationOutbox.findFirstOrThrow();
    expect(record.status).toBe("DEAD");
    expect(record.attemptCount).toBe(1);
  });
});

describe("createPublishNotifier", () => {
  it("enqueues on success and failure for the configured channel", async () => {
    await new SettingsRepository(prisma).setMany({
      NOTIFICATIONS_ENABLED: "true",
      NOTIFICATIONS_DISCORD_ENABLED: "true",
    });
    const notifier = await createPublishNotifier(prisma, { discordBotToken: "dc", discordOwnerId: "456" });
    expect(notifier).not.toBeNull();
    await notifier!.onPublishSuccess({ jobId: "job-a", platformPostId: "90090", publisherIdentityId: null, platformUrl: "https://x.com/a/status/90090" });
    await notifier!.onPublishFailure({ jobId: "job-b", platformPostId: "90091", publisherIdentityId: null, error: "x", attemptCount: 1, manualAttention: false, retryable: false });
    const rows = await prisma.notificationOutbox.findMany({ orderBy: { channel: "asc" }, select: { channel: true, text: true } });
    const byChannel: Record<string, string[]> = {};
    for (const row of rows) (byChannel[row.channel] ??= []).push(row.text);
    expect(byChannel.discord).toHaveLength(2);
    expect(byChannel.discord.join("\n")).toContain("Published X post 90090");
    expect(byChannel.discord.join("\n")).toContain("Please confirm it posted");
    expect(byChannel.discord.join("\n")).toContain("Publication failed");
  });

  it("returns null when notifications are disabled", async () => {
    await new SettingsRepository(prisma).setMany({ NOTIFICATIONS_ENABLED: "false" });
    const notifier = await createPublishNotifier(prisma, { discordBotToken: "dc", discordOwnerId: "456" });
    expect(notifier).toBeNull();
  });
});
