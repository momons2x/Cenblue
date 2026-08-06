import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { withDatabaseRetry } from "./retry";

export type NotificationEnqueueInput = {
  channel: string;
  recipient: string;
  text: string;
};

export type ClaimedNotification = {
  id: string;
  channel: string;
  recipient: string;
  text: string;
  claimToken: string;
};

export class NotificationOutboxRepository {
  constructor(private readonly client: PrismaClient) {}

  async enqueue(input: NotificationEnqueueInput, now = new Date()): Promise<string> {
    const record = await this.client.notificationOutbox.create({ data: { ...input, status: "PENDING", nextAttemptAt: now } });
    return record.id;
  }

  async claimNext(now: Date, staleBefore: Date): Promise<ClaimedNotification | null> {
    return withDatabaseRetry(() => this.client.$transaction(async (transaction) => {
      await transaction.notificationOutbox.updateMany({
        where: { status: "SENDING", updatedAt: { lt: staleBefore } },
        data: { status: "PENDING", claimToken: null, nextAttemptAt: now, lastError: "Recovered stale notification claim" },
      });
      const candidate = await transaction.notificationOutbox.findFirst({
        where: { status: "PENDING", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (!candidate) return null;
      const claimToken = randomUUID();
      const claimed = await transaction.notificationOutbox.updateMany({
        where: { id: candidate.id, status: "PENDING" },
        data: { status: "SENDING", claimToken, attemptCount: { increment: 1 } },
      });
      if (claimed.count !== 1) return null;
      const record = await transaction.notificationOutbox.findUniqueOrThrow({ where: { id: candidate.id } });
      return { id: record.id, channel: record.channel, recipient: record.recipient, text: record.text, claimToken };
    }));
  }

  async complete(id: string, claimToken: string, sentAt = new Date()): Promise<boolean> {
    const updated = await this.client.notificationOutbox.updateMany({
      where: { id, status: "SENDING", claimToken },
      data: { status: "SENT", claimToken: null, lastError: null, nextAttemptAt: null, updatedAt: sentAt },
    });
    return updated.count === 1;
  }

  async fail(id: string, claimToken: string, error: string, nextAttemptAt: Date | null, dead: boolean): Promise<boolean> {
    const updated = await this.client.notificationOutbox.updateMany({
      where: { id, status: "SENDING", claimToken },
      data: { status: dead ? "DEAD" : "PENDING", claimToken: null, lastError: error.slice(0, 2_000), nextAttemptAt, updatedAt: new Date() },
    });
    return updated.count === 1;
  }

  async countPending(): Promise<number> {
    return this.client.notificationOutbox.count({ where: { status: { in: ["PENDING", "SENDING"] } } });
  }

  async attemptCount(id: string): Promise<number> {
    const record = await this.client.notificationOutbox.findUnique({ where: { id }, select: { attemptCount: true } });
    return record?.attemptCount ?? 0;
  }

  async deleteSent(olderThan: Date): Promise<number> {
    const deleted = await this.client.notificationOutbox.deleteMany({ where: { status: "SENT", createdAt: { lt: olderThan } } });
    return deleted.count;
  }
}
