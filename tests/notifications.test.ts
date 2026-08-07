import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NotificationEmitter, NotificationDispatcher, NotificationStatusService, TelegramTransport, type NotificationTransport, type TelegramSendResult } from "@cenblu/notifications";
import { NotificationOutboxRepository, OperationalEventRepository, prisma } from "@cenblu/database";

beforeEach(async () => {
  await prisma.notificationOutbox.deleteMany();
  await prisma.operationalEvent.deleteMany();
});

afterAll(async () => prisma.$disconnect());

describe("notification outbox", () => {
  it("enqueues and claims one pending notification with a claim token", async () => {
    const outbox = new NotificationOutboxRepository(prisma);
    const id = await outbox.enqueue({ channel: "telegram", recipient: "123", text: "hello" });
    const claimed = await outbox.claimNext(new Date(), new Date(0));
    expect(claimed).toMatchObject({ id, channel: "telegram", recipient: "123", text: "hello" });
    expect(claimed?.claimToken).toBeTruthy();
  });

  it("fences completion with the current claim token", async () => {
    const outbox = new NotificationOutboxRepository(prisma);
    await outbox.enqueue({ channel: "telegram", recipient: "123", text: "hello" });
    const claimed = await outbox.claimNext(new Date(), new Date(0));
    expect(await outbox.complete(claimed!.id, "wrong-token")).toBe(false);
    expect(await outbox.complete(claimed!.id, claimed!.claimToken!)).toBe(true);
    expect(await outbox.countPending()).toBe(0);
  });

  it("recovers stale sending claims back to pending", async () => {
    const outbox = new NotificationOutboxRepository(prisma);
    await outbox.enqueue({ channel: "telegram", recipient: "123", text: "hello" });
    const claimed = await outbox.claimNext(new Date(), new Date(0));
    await prisma.notificationOutbox.update({ where: { id: claimed!.id }, data: { updatedAt: new Date(Date.now() - 30 * 60_000) } });
    const again = await outbox.claimNext(new Date(), new Date(Date.now() - 15 * 60_000));
    expect(again?.id).toBe(claimed!.id);
    expect(again?.claimToken).not.toBe(claimed!.claimToken);
  });

  it("marks dead after the configured max attempts", async () => {
    const outbox = new NotificationOutboxRepository(prisma);
    await outbox.enqueue({ channel: "telegram", recipient: "123", text: "hello" });
    const claimed = await outbox.claimNext(new Date(), new Date(0));
    expect(await outbox.fail(claimed!.id, claimed!.claimToken!, "boom", null, true)).toBe(true);
    const record = await prisma.notificationOutbox.findUniqueOrThrow({ where: { id: claimed!.id } });
    expect(record.status).toBe("DEAD");
  });
});

describe("notification emitter", () => {
  it("enqueues a message when enabled with a chat id", async () => {
    const events = new OperationalEventRepository(prisma);
    const outbox = new NotificationOutboxRepository(prisma);
    const emitter = new NotificationEmitter(events, outbox);
    const emitted = await emitter.emitPublishFailure({
      jobId: "job-1", platformPostId: "90001", publisherIdentityId: "pub-1", error: "SUBMISSION_FAILED: nope", attemptCount: 1, manualAttention: false, retryable: true,
    }, { enabled: true, channels: { telegram: "123" } });
    expect(emitted).toBe(true);
    expect(await prisma.operationalEvent.count()).toBe(1);
    expect(await outbox.countPending()).toBe(1);
  });

  it("does nothing when disabled or missing recipients", async () => {
    const events = new OperationalEventRepository(prisma);
    const outbox = new NotificationOutboxRepository(prisma);
    const emitter = new NotificationEmitter(events, outbox);
    await emitter.emitPublishFailure({ jobId: "job-2", platformPostId: "90002", publisherIdentityId: null, error: "x", attemptCount: 1, manualAttention: false, retryable: false }, { enabled: false, channels: { telegram: "123" } });
    await emitter.emitPublishFailure({ jobId: "job-3", platformPostId: "90003", publisherIdentityId: null, error: "x", attemptCount: 1, manualAttention: false, retryable: false }, { enabled: true, channels: {} });
    expect(await prisma.operationalEvent.count()).toBe(0);
    expect(await outbox.countPending()).toBe(0);
  });

  it("dedupes repeated failures for the same job", async () => {
    const events = new OperationalEventRepository(prisma);
    const outbox = new NotificationOutboxRepository(prisma);
    const emitter = new NotificationEmitter(events, outbox, 60 * 60_000);
    const context = { jobId: "job-4", platformPostId: "90004", publisherIdentityId: null, error: "x", attemptCount: 1, manualAttention: true, retryable: false };
    expect(await emitter.emitPublishFailure(context, { enabled: true, channels: { telegram: "123" } })).toBe(true);
    expect(await emitter.emitPublishFailure(context, { enabled: true, channels: { telegram: "123" } })).toBe(false);
    expect(await prisma.operationalEvent.count()).toBe(1);
    expect(await outbox.countPending()).toBe(1);
  });

  it("resolves the publisher label through the resolver", async () => {
    const events = new OperationalEventRepository(prisma);
    const outbox = new NotificationOutboxRepository(prisma);
    const emitter = new NotificationEmitter(events, outbox, undefined, async () => "Publisher Two");
    await emitter.emitPublishFailure({ jobId: "job-5", platformPostId: "90005", publisherIdentityId: "pub-2", error: "x", attemptCount: 2, manualAttention: true, retryable: false }, { enabled: true, channels: { telegram: "123" } });
    const record = await prisma.operationalEvent.findFirstOrThrow();
    expect(record.message).toContain("Publisher Two");
    expect(record.message).toContain("Manual review required");
  });

  it("enqueues one row per configured channel", async () => {
    const events = new OperationalEventRepository(prisma);
    const outbox = new NotificationOutboxRepository(prisma);
    const emitter = new NotificationEmitter(events, outbox);
    await emitter.emitPublishFailure({ jobId: "job-6", platformPostId: "90006", publisherIdentityId: null, error: "x", attemptCount: 1, manualAttention: false, retryable: false }, { enabled: true, channels: { telegram: "123", discord: "456" } });
    expect(await outbox.countPending()).toBe(2);
    const rows = await prisma.notificationOutbox.findMany({ orderBy: { channel: "asc" }, select: { channel: true, recipient: true } });
    expect(rows).toEqual([
      { channel: "discord", recipient: "456" },
      { channel: "telegram", recipient: "123" },
    ]);
    expect(await prisma.operationalEvent.count()).toBe(1);
  });

  it("enqueues a published-post notification to every configured channel", async () => {
    const events = new OperationalEventRepository(prisma);
    const outbox = new NotificationOutboxRepository(prisma);
    const emitter = new NotificationEmitter(events, outbox, undefined, async () => "Publisher One");
    const emitted = await emitter.emitPublishedPost({ jobId: "job-7", platformPostId: "90007", publisherIdentityId: "pub-3", platformUrl: "https://x.com/a/status/90007" }, { enabled: true, channels: { telegram: "123", discord: "456" } });
    expect(emitted).toBe(true);
    expect(await outbox.countPending()).toBe(2);
    const record = await prisma.operationalEvent.findFirstOrThrow();
    expect(record.type).toBe("publish.success");
    expect(record.severity).toBe("INFO");
    expect(record.message).toContain("Published X post 90007 via Publisher One");
    expect(record.message).toContain("https://x.com/a/status/90007");
  });

  it("dedupes repeated published-post notifications for the same job", async () => {
    const events = new OperationalEventRepository(prisma);
    const outbox = new NotificationOutboxRepository(prisma);
    const emitter = new NotificationEmitter(events, outbox, 60 * 60_000);
    const context = { jobId: "job-8", platformPostId: "90008", publisherIdentityId: null, platformUrl: null };
    expect(await emitter.emitPublishedPost(context, { enabled: true, channels: { telegram: "123" } })).toBe(true);
    expect(await emitter.emitPublishedPost(context, { enabled: true, channels: { telegram: "123" } })).toBe(false);
    expect(await prisma.operationalEvent.count()).toBe(1);
    expect(await outbox.countPending()).toBe(1);
  });

  it("does nothing for a published-post notification when disabled", async () => {
    const events = new OperationalEventRepository(prisma);
    const outbox = new NotificationOutboxRepository(prisma);
    const emitter = new NotificationEmitter(events, outbox);
    expect(await emitter.emitPublishedPost({ jobId: "job-9", platformPostId: "90009", publisherIdentityId: null, platformUrl: null }, { enabled: false, channels: { telegram: "123" } })).toBe(false);
    expect(await prisma.operationalEvent.count()).toBe(0);
    expect(await outbox.countPending()).toBe(0);
  });
});

describe("notification dispatcher", () => {
  class FakeTransport implements NotificationTransport {
    calls: string[] = [];
    constructor(private readonly result: TelegramSendResult) {}
    async send(recipient: string, text: string): Promise<TelegramSendResult> { this.calls.push(`${recipient}:${text}`); return this.result; }
  }

  it("delivers pending notifications and marks them sent", async () => {
    const outbox = new NotificationOutboxRepository(prisma);
    await outbox.enqueue({ channel: "telegram", recipient: "123", text: "one" });
    await outbox.enqueue({ channel: "telegram", recipient: "123", text: "two" });
    const transport = new FakeTransport({ ok: true });
    const dispatcher = new NotificationDispatcher(outbox, { telegram: transport }, { maxAttempts: 3, maxBackoffMs: 60_000, staleAfterMs: 15 * 60_000 });
    expect(await dispatcher.runOnce()).toBe(2);
    expect(transport.calls).toHaveLength(2);
    expect(await outbox.countPending()).toBe(0);
  });

  it("routes rows to the transport for their channel", async () => {
    const outbox = new NotificationOutboxRepository(prisma);
    await outbox.enqueue({ channel: "telegram", recipient: "123", text: "tg" });
    await outbox.enqueue({ channel: "discord", recipient: "456", text: "dc" });
    const telegram = new FakeTransport({ ok: true });
    const discord = new FakeTransport({ ok: true });
    const dispatcher = new NotificationDispatcher(outbox, { telegram, discord }, { maxAttempts: 3, maxBackoffMs: 60_000, staleAfterMs: 15 * 60_000 });
    expect(await dispatcher.runOnce()).toBe(2);
    expect(telegram.calls).toEqual(["123:tg"]);
    expect(discord.calls).toEqual(["456:dc"]);
    expect(await outbox.countPending()).toBe(0);
  });

  it("fails rows whose channel has no transport", async () => {
    const outbox = new NotificationOutboxRepository(prisma);
    await outbox.enqueue({ channel: "telegram", recipient: "123", text: "one" });
    const dispatcher = new NotificationDispatcher(outbox, {}, { maxAttempts: 3, maxBackoffMs: 60_000, staleAfterMs: 15 * 60_000 });
    expect(await dispatcher.runOnce()).toBe(0);
    const record = await prisma.notificationOutbox.findFirstOrThrow();
    expect(record.status).toBe("DEAD");
    expect(record.lastError).toContain("No transport configured");
  });

  it("backs off after a transient failure and retries later", async () => {
    const outbox = new NotificationOutboxRepository(prisma);
    await outbox.enqueue({ channel: "telegram", recipient: "123", text: "never" });
    const transport = new FakeTransport({ ok: false, error: "network" });
    const dispatcher = new NotificationDispatcher(outbox, { telegram: transport }, { maxAttempts: 2, maxBackoffMs: 60_000, staleAfterMs: 15 * 60_000 });
    expect(await dispatcher.runOnce()).toBe(0);
    const record = await prisma.notificationOutbox.findFirstOrThrow();
    expect(record.status).toBe("PENDING");
    expect(record.attemptCount).toBe(1);
    expect(record.nextAttemptAt).toBeTruthy();
  });

  it("marks a notification dead after exhausting max attempts", async () => {
    const outbox = new NotificationOutboxRepository(prisma);
    await outbox.enqueue({ channel: "telegram", recipient: "123", text: "never" });
    const transport = new FakeTransport({ ok: false, error: "network" });
    const dispatcher = new NotificationDispatcher(outbox, { telegram: transport }, { maxAttempts: 1, maxBackoffMs: 60_000, staleAfterMs: 15 * 60_000 });
    expect(await dispatcher.runOnce()).toBe(0);
    const record = await prisma.notificationOutbox.findFirstOrThrow();
    expect(record.status).toBe("DEAD");
    expect(record.attemptCount).toBe(1);
  });
});

describe("telegram transport", () => {
  it("honors retry-after on HTTP 429", async () => {
    const transport = new TelegramTransport("token", async () => new Response(null, { status: 429, headers: { "retry-after": "7" } }));
    const result = await transport.send("123", "hi");
    expect(result.ok).toBe(false);
    expect(result.retryAfterSeconds).toBe(7);
  });

  it("parses a successful response", async () => {
    const transport = new TelegramTransport("token", async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const result = await transport.send("123", "hi");
    expect(result.ok).toBe(true);
  });

  it("reports a rejected response", async () => {
    const transport = new TelegramTransport("token", async () => new Response(JSON.stringify({ ok: false, description: "bad" }), { status: 400 }));
    const result = await transport.send("123", "hi");
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("validates the bot token with getMe", async () => {
    const transport = new TelegramTransport("good-token", async () => new Response(JSON.stringify({ ok: true, result: { username: "cenblu_bot", first_name: "Cenblue" } }), { status: 200 }));
    expect(await transport.getMe()).toEqual({ ok: true, username: "cenblu_bot", name: "Cenblue" });
    const invalid = new TelegramTransport("bad-token", async () => new Response(JSON.stringify({ ok: false, description: "Unauthorized" }), { status: 401 }));
    const result = await invalid.getMe();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/401/);
  });

  it("validates the chat with getChat", async () => {
    const transport = new TelegramTransport("token", async () => new Response(JSON.stringify({ ok: true, result: { title: "My Channel" } }), { status: 200 }));
    expect(await transport.getChat("123")).toEqual({ ok: true, title: "My Channel" });
    const missing = new TelegramTransport("token", async () => new Response(JSON.stringify({ ok: false, description: "chat not found" }), { status: 400 }));
    const result = await missing.getChat("999");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("chat not found");
  });

  it("parses updates from getUpdates and filters non-message entries", async () => {
    const transport = new TelegramTransport("token", async () => new Response(JSON.stringify({ ok: true, result: [
      { update_id: 1, message: { chat: { id: 123 }, from: { id: 456 }, text: "/status" } },
      { update_id: 2, message: { chat: { id: 123 }, from: { id: 456 }, text: "" } },
      { update_id: 3, message: { chat: { id: 123 }, from: { id: 456 } } },
      { update_id: 4, message: { chat: { id: 123 }, from: { id: 456 }, text: "hello" } },
    ] }), { status: 200 }));
    const result = await transport.getUpdates(2, 10);
    expect(result.ok).toBe(true);
    expect(result.updates).toEqual([
      { updateId: 1, chatId: "123", fromUserId: "456", text: "/status" },
      { updateId: 4, chatId: "123", fromUserId: "456", text: "hello" },
    ]);
  });

  it("returns no updates on an empty getUpdates result", async () => {
    const transport = new TelegramTransport("token", async () => new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 }));
    const result = await transport.getUpdates();
    expect(result.ok).toBe(true);
    expect(result.updates).toEqual([]);
  });

  it("treats a poll timeout abort as no updates instead of an error", async () => {
    const transport = new TelegramTransport("token", async (_url, init) => {
      const signal = init?.signal as AbortSignal | undefined;
      await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve()));
      throw new DOMException("This operation was aborted", "AbortError");
    }, 1_000);
    const result = await transport.getUpdates(0, 0);
    expect(result.ok).toBe(true);
    expect(result.updates).toEqual([]);
    expect(result.error).toBeUndefined();
  });
});

describe("notification status", () => {
  it("reports outbox counts, last delivery, and last error", async () => {
    const outbox = new NotificationOutboxRepository(prisma);
    await outbox.enqueue({ channel: "telegram", recipient: "123", text: "one" });
    const claimed = await outbox.claimNext(new Date(), new Date(0));
    await outbox.complete(claimed!.id, claimed!.claimToken!);
    await outbox.enqueue({ channel: "telegram", recipient: "123", text: "two" });
    const claimedTwo = await outbox.claimNext(new Date(), new Date(0));
    await outbox.fail(claimedTwo!.id, claimedTwo!.claimToken!, "boom", null, true);

    const service = new NotificationStatusService(null, outbox);
    const report = await service.status();
    expect(report.tokenConfigured).toBe(false);
    expect(report.outbox).toMatchObject({ pending: 0, sent: 1, dead: 1 });
    expect(report.lastDeliveredAt).toBeTruthy();
    expect(report.lastError).toBe("boom");
  });

  it("resolves bot and chat details through the transport", async () => {
    const outbox = new NotificationOutboxRepository(prisma);
    let calls = 0;
    const transport = new TelegramTransport("token", async () => {
      calls += 1;
      return calls === 1
        ? new Response(JSON.stringify({ ok: true, result: { username: "cenblu_bot", first_name: "Cenblue" } }), { status: 200 })
        : new Response(JSON.stringify({ ok: true, result: { title: "My Channel" } }), { status: 200 });
    });
    const service = new NotificationStatusService(transport, outbox);
    const report = await service.withChat("123");
    expect(report.tokenValid).toBe(true);
    expect(report.botUsername).toBe("cenblu_bot");
    expect(report.chatReachable).toBe(true);
    expect(report.chatTitle).toBe("My Channel");
    expect(calls).toBe(2);
  });
});
