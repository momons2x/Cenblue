import type { PrismaClient } from "@prisma/client";

export type OperationalEventInput = {
  type: string;
  severity: "INFO" | "WARN" | "ERROR" | "CRITICAL";
  component: string;
  message: string;
  meta?: string | null;
  dedupeKey?: string | null;
  dedupeUntil?: Date | null;
};

export class OperationalEventRepository {
  constructor(private readonly client: PrismaClient) {}

  async insert(input: OperationalEventInput): Promise<string> {
    const record = await this.client.operationalEvent.create({ data: input });
    return record.id;
  }

  async hasRecentDedupe(key: string, now = new Date()): Promise<boolean> {
    const record = await this.client.operationalEvent.findFirst({
      where: { dedupeKey: key, dedupeUntil: { gt: now } },
      select: { id: true },
    });
    return record !== null;
  }
}
