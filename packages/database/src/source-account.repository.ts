import type { Prisma, PrismaClient, SourceAccount } from "@prisma/client";
import { withDatabaseRetry } from "./retry";

export type CreateSourceAccount = {
  username: string;
  displayName?: string | null;
  enabled?: boolean;
  collectLimit?: number;
  captionTemplate?: string | null;
  attributionTemplate?: string | null;
  hashtagRules?: string | null;
  collectorIdentityId?: string | null;
};

export type UpdateSourceAccount = Partial<CreateSourceAccount>;

function normalizedUsername(username: string): string {
  return username.trim().replace(/^@/, "").toLowerCase();
}

function profileUrl(username: string): string {
  return `https://x.com/${username}`;
}

export class SourceAccountRepository {
  constructor(private readonly client: PrismaClient, private readonly maximumEnabledSources = 100) {}

  create(input: CreateSourceAccount): Promise<SourceAccount> {
    const username = normalizedUsername(input.username);
    return withDatabaseRetry(() => this.client.$transaction(async (transaction) => {
      const existing = await transaction.sourceAccount.findUnique({ where: { username } });
      if (existing?.managedSource) throw new Error(`Source account @${username} already exists`);
      if (input.enabled !== false && await transaction.sourceAccount.count({ where: { enabled: true } }) >= this.maximumEnabledSources) {
        throw new Error(`At most ${this.maximumEnabledSources} source accounts may be enabled`);
      }
      if (existing) return transaction.sourceAccount.update({
        where: { id: existing.id },
        data: { ...input, username, profileUrl: profileUrl(username), managedSource: true, archivedAt: null, enabled: input.enabled ?? true },
      });
      return transaction.sourceAccount.create({ data: { ...input, username, profileUrl: profileUrl(username) } });
    }));
  }

  findById(id: string): Promise<SourceAccount | null> {
    return this.client.sourceAccount.findUnique({ where: { id } });
  }

  list(): Promise<SourceAccount[]> {
    return this.client.sourceAccount.findMany({ where: { managedSource: true }, orderBy: { createdAt: "asc" } });
  }

  listEnabled(limit: number): Promise<SourceAccount[]> {
    return this.client.sourceAccount.findMany({
      where: { enabled: true, archivedAt: null, managedSource: true },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
  }

  listEnabledForCollector(collectorIdentityId: string, limit: number): Promise<SourceAccount[]> {
    return this.client.sourceAccount.findMany({
      where: { collectorIdentityId, enabled: true, archivedAt: null, managedSource: true },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
  }

  async update(id: string, input: UpdateSourceAccount): Promise<SourceAccount> {
    const username = input.username === undefined ? undefined : normalizedUsername(input.username);
    const data: Prisma.SourceAccountUpdateInput = {
      ...input,
      username,
      profileUrl: username === undefined ? undefined : profileUrl(username),
    };
    return withDatabaseRetry(() => this.client.$transaction(async (transaction) => {
      if (input.enabled === true && await transaction.sourceAccount.count({ where: { enabled: true, id: { not: id } } }) >= this.maximumEnabledSources) {
        throw new Error(`At most ${this.maximumEnabledSources} source accounts may be enabled`);
      }
      return transaction.sourceAccount.update({ where: { id }, data });
    }));
  }

  delete(id: string): Promise<SourceAccount> {
    return this.client.sourceAccount.delete({ where: { id } });
  }

  archive(id: string, archivedAt = new Date()): Promise<SourceAccount> {
    return this.client.sourceAccount.update({ where: { id }, data: { enabled: false, archivedAt } });
  }

  restore(id: string): Promise<SourceAccount> {
    return this.client.sourceAccount.update({ where: { id }, data: { archivedAt: null, enabled: false } });
  }

  async recordCollectionSuccess(id: string, collectedAt: Date): Promise<void> {
    await this.client.sourceAccount.update({
      where: { id },
      data: {
        lastCollectedAt: collectedAt,
        lastCollectionError: null,
      },
    });
  }

  async recordCollectionFailure(id: string, failedAt: Date, error: string): Promise<void> {
    await this.client.sourceAccount.update({
      where: { id },
      data: {
        lastCollectionFailedAt: failedAt,
        lastCollectionError: error.slice(0, 2_000),
      },
    });
  }
}
