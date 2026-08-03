import type { CollectionRun, PrismaClient } from "@prisma/client";
import type { CollectionScanProgress } from "@cenblu/shared";

export class CollectionRunRepository {
  constructor(private readonly client: PrismaClient) {}

  start(sources: { id: string; targetNew: number }[]): Promise<CollectionRun> {
    return this.client.collectionRun.create({ data: { totalSources: sources.length, targetNew: sources.reduce((total, source) => total + source.targetNew, 0), sources: { create: sources.map((source) => ({ sourceAccountId: source.id, targetNew: source.targetNew })) } } });
  }

  setCurrent(id: string, username: string): Promise<CollectionRun> {
    return this.client.collectionRun.update({ where: { id }, data: { currentSource: username, heartbeatAt: new Date() } });
  }

  async startSource(runId: string, sourceId: string, username: string): Promise<void> {
    await this.client.$transaction([
      this.client.collectionRun.update({ where: { id: runId }, data: { currentSource: username, heartbeatAt: new Date() } }),
      this.client.collectionRunSource.update({ where: { collectionRunId_sourceAccountId: { collectionRunId: runId, sourceAccountId: sourceId } }, data: { status: "RUNNING", startedAt: new Date() } }),
    ]);
  }

  async progressSource(runId: string, sourceId: string, progress: CollectionScanProgress): Promise<void> {
    await this.client.$transaction(async (transaction) => {
      const previous = await transaction.collectionRunSource.findUniqueOrThrow({ where: { collectionRunId_sourceAccountId: { collectionRunId: runId, sourceAccountId: sourceId } }, select: { eligibleExamined: true, knownSkipped: true, newFound: true } });
      await transaction.collectionRunSource.update({ where: { collectionRunId_sourceAccountId: { collectionRunId: runId, sourceAccountId: sourceId } }, data: { eligibleExamined: progress.eligibleExamined, knownSkipped: progress.knownSkipped, newFound: progress.newFound } });
      await transaction.collectionRun.update({ where: { id: runId }, data: { eligibleExamined: { increment: progress.eligibleExamined - previous.eligibleExamined }, knownSkipped: { increment: progress.knownSkipped - previous.knownSkipped }, newFound: { increment: progress.newFound - previous.newFound }, heartbeatAt: new Date() } });
    });
  }

  async recordSource(id: string, failed: boolean): Promise<void> {
    await this.client.collectionRun.update({ where: { id }, data: { completedSources: { increment: 1 }, failedSources: failed ? { increment: 1 } : undefined, heartbeatAt: new Date() } });
  }

  async finishSource(runId: string, sourceId: string, input: { failed: boolean; cancelled: boolean; inserted: number; stopReason?: string; error?: string }): Promise<void> {
    await this.client.$transaction([
      this.client.collectionRunSource.update({ where: { collectionRunId_sourceAccountId: { collectionRunId: runId, sourceAccountId: sourceId } }, data: { status: input.cancelled ? "CANCELLED" : input.failed ? "FAILED" : input.stopReason === "timeline_exhausted" ? "EXHAUSTED" : "COMPLETED", inserted: input.inserted, stopReason: input.stopReason, lastError: input.error?.slice(0, 2_000), completedAt: new Date() } }),
      this.client.collectionRun.update({ where: { id: runId }, data: { completedSources: { increment: 1 }, failedSources: input.failed ? { increment: 1 } : undefined, inserted: { increment: input.inserted }, heartbeatAt: new Date() } }),
    ]);
  }

  finish(id: string, status: "COMPLETED" | "FAILED" | "BUSY" | "CANCELLED", error?: string): Promise<CollectionRun> {
    return this.client.collectionRun.update({ where: { id }, data: { status, completedAt: new Date(), currentSource: null, lastError: error?.slice(0, 2_000) } });
  }

  latest(): Promise<CollectionRun | null> {
    return this.client.collectionRun.findFirst({ orderBy: { startedAt: "desc" } });
  }

  async recoverStale(before: Date): Promise<number> {
    const updated = await this.client.collectionRun.updateMany({ where: { status: "RUNNING", heartbeatAt: { lt: before } }, data: { status: "FAILED", completedAt: new Date(), currentSource: null, lastError: "Recovered stale collection run" } });
    return updated.count;
  }

  requestCancel(id: string): Promise<CollectionRun> {
    return this.client.collectionRun.update({ where: { id, status: "RUNNING" }, data: { cancelRequestedAt: new Date() } });
  }

  async shouldCancel(id: string): Promise<boolean> {
    const run = await this.client.collectionRun.findUnique({ where: { id }, select: { cancelRequestedAt: true } });
    return Boolean(run?.cancelRequestedAt);
  }
}
