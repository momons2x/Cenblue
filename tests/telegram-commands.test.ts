import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { parseTelegramCommand, TelegramCommandHandler, type TelegramTransport, type TelegramUpdate } from "@cenblu/notifications";
import { NotificationOutboxRepository, PipelineStatusRepository, prisma, SourceAccountRepository } from "@cenblu/database";

class FakeTransport {
  sent: string[] = [];
  async send(recipient: string, text: string): Promise<{ ok: boolean }> { this.sent.push(text); return { ok: true }; }
  async getMe(): Promise<{ ok: boolean; username?: string }> { return { ok: true, username: "cenblu_bot" }; }
  async getChat(_chatId: string): Promise<{ ok: boolean }> { void _chatId; return { ok: true }; }
}

beforeEach(async () => {
  await prisma.notificationOutbox.deleteMany();
  await prisma.operationalEvent.deleteMany();
  await prisma.sourceAccount.deleteMany();
});

afterAll(async () => prisma.$disconnect());

describe("telegram command parsing", () => {
  it("parses slash commands", () => {
    expect(parseTelegramCommand("/status")).toBe("status");
    expect(parseTelegramCommand("/pipeline")).toBe("pipeline");
    expect(parseTelegramCommand("/test")).toBe("test");
    expect(parseTelegramCommand("/help")).toBe("help");
  });

  it("is case-insensitive and ignores text after the command", () => {
    expect(parseTelegramCommand("  /STATUS")).toBe("status");
    expect(parseTelegramCommand("/Pipeline details here")).toBe("pipeline");
  });

  it("ignores non-command messages", () => {
    expect(parseTelegramCommand("hello")).toBeNull();
    expect(parseTelegramCommand("/")).toBeNull();
    expect(parseTelegramCommand("")).toBeNull();
  });
});

describe("telegram command handler", () => {
  function update(text: string, chatId = "123"): TelegramUpdate {
    return { updateId: 1, chatId, fromUserId: "456", text };
  }

  it("replies to /status for the configured chat", async () => {
    const transport = new FakeTransport();
    const handler = new TelegramCommandHandler({ chatId: "123", transport: transport as unknown as TelegramTransport, outbox: new NotificationOutboxRepository(prisma), pipeline: new PipelineStatusRepository(prisma) });
    const result = await handler.handle(update("/status"));
    expect(result).toEqual({ handled: true, replied: true });
    expect(transport.sent.some((text) => text.includes("Notification status"))).toBe(true);
  });

  it("replies to /pipeline for the configured chat", async () => {
    await new SourceAccountRepository(prisma).create({ username: "telegram_pipeline", enabled: true });
    const transport = new FakeTransport();
    const handler = new TelegramCommandHandler({ chatId: "123", transport: transport as unknown as TelegramTransport, outbox: new NotificationOutboxRepository(prisma), pipeline: new PipelineStatusRepository(prisma) });
    await handler.handle(update("/pipeline"));
    expect(transport.sent.some((text) => text.includes("Pipeline status") && text.includes("1 enabled"))).toBe(true);
  });

  it("replies to /help and /test", async () => {
    const transport = new FakeTransport();
    const handler = new TelegramCommandHandler({ chatId: "123", transport: transport as unknown as TelegramTransport, outbox: new NotificationOutboxRepository(prisma), pipeline: new PipelineStatusRepository(prisma) });
    await handler.handle(update("/help"));
    expect(transport.sent.some((text) => text.includes("/status"))).toBe(true);
    await handler.handle(update("/test"));
    expect(transport.sent.some((text) => text.includes("Test message delivered"))).toBe(true);
  });

  it("ignores messages from other chats and non-commands", async () => {
    const transport = new FakeTransport();
    const handler = new TelegramCommandHandler({ chatId: "123", transport: transport as unknown as TelegramTransport, outbox: new NotificationOutboxRepository(prisma), pipeline: new PipelineStatusRepository(prisma) });
    expect((await handler.handle(update("/status", "999"))).handled).toBe(false);
    expect((await handler.handle(update("just chatting"))).handled).toBe(false);
    expect(transport.sent).toHaveLength(0);
  });
});
