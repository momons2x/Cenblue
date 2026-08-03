import type { PrismaClient } from "@prisma/client";

export class RuntimeStatusRepository {
  constructor(private readonly client: PrismaClient) {}

  async update(component: string, status: string, currentOperation?: string, lastError?: string): Promise<void> {
    await this.client.runtimeStatus.upsert({ where: { component }, create: { component, status, currentOperation, lastError }, update: { status, currentOperation, lastError } });
  }
}
