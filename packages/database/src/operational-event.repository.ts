import type { PrismaClient } from "@prisma/client";

export type OperationalEventInput = {
  type: string;
  severity: "INFO" | "WARN" | "ERROR" | "CRITICAL";
  component: string;
  message: string;
  meta?: string | null;
  operationId?: string | null;
  dedupeKey?: string | null;
  dedupeUntil?: Date | null;
};

export class OperationalEventRepository {
  constructor(private readonly client: PrismaClient) {}

  async insert(input: OperationalEventInput): Promise<string> {
    const record = await this.client.operationalEvent.create({ data: input });
    return record.id;
  }

  async listRecent(limit = 50): Promise<Array<{ id: string; type: string; severity: string; component: string; message: string; meta: string | null; operationId: string | null; createdAt: Date }>> {
    return this.client.operationalEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, type: true, severity: true, component: true, message: true, meta: true, operationId: true, createdAt: true },
    });
  }

  async hasRecentDedupe(key: string, now = new Date()): Promise<boolean> {
    const record = await this.client.operationalEvent.findFirst({
      where: { dedupeKey: key, dedupeUntil: { gt: now } },
      select: { id: true },
    });
    return record !== null;
  }
}
