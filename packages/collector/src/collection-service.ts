import type { SourceAccount } from "@cenblu/database";
import type { PersistPostsResult } from "@cenblu/database";
import type { SourceCollector } from "@cenblu/shared";
import type { CollectionScanProgress } from "@cenblu/shared";
import type { Logger } from "pino";

export interface CollectionAccountRepository {
  listEnabled(limit: number): Promise<SourceAccount[]>;
  recordCollectionSuccess(id: string, collectedAt: Date): Promise<void>;
  recordCollectionFailure(id: string, failedAt: Date, error: string): Promise<void>;
}

export interface CollectionPostRepository {
  persistNew(sourceAccountId: string, posts: Awaited<ReturnType<SourceCollector["collect"]>>, collectedAt: Date): Promise<PersistPostsResult>;
  listPlatformPostIds(sourceAccountId: string): Promise<Set<string>>;
}

export type CollectionCycleResult = {
  sourcesProcessed: number;
  sourcesFailed: number;
  postsInserted: number;
  duplicatesIgnored: number;
  cancelled: boolean;
};

export type CollectionProgress = {
  sourceStarting?(source: { id: string; username: string; targetNew: number }): Promise<void>;
  sourceProgress?(sourceId: string, progress: CollectionScanProgress): Promise<void>;
  sourceFinished?(source: { id: string; failed: boolean; cancelled: boolean; inserted: number; stopReason?: string; error?: string }): Promise<void>;
  shouldCancel?(): Promise<boolean>;
};

export class CollectionService {
  constructor(
    private readonly accounts: CollectionAccountRepository,
    private readonly posts: CollectionPostRepository,
    private readonly collector: SourceCollector,
    private readonly logger: Logger,
    private readonly sourceAccountLimit: number,
    private readonly postsPerSource: number,
    private readonly progress?: CollectionProgress,
  ) {}

  async runOnce(): Promise<CollectionCycleResult> {
    const sources = await this.accounts.listEnabled(this.sourceAccountLimit);
    const result: CollectionCycleResult = {
      sourcesProcessed: 0,
      sourcesFailed: 0,
      postsInserted: 0,
      duplicatesIgnored: 0,
      cancelled: false,
    };

    const collectSources = async () => {
      for (const source of sources) {
        if (await this.progress?.shouldCancel?.()) { result.cancelled = true; break; }
        const collectedAt = new Date();
        await this.progress?.sourceStarting?.({ id: source.id, username: source.username, targetNew: Math.min(source.collectLimit, this.postsPerSource) });
        try {
          let latestProgress: CollectionScanProgress | undefined;
          const knownPostIds = await this.posts.listPlatformPostIds(source.id);
          const collected = await this.collector.collect({
            id: source.id,
            username: source.username,
            profileUrl: source.profileUrl,
            collectLimit: Math.min(source.collectLimit, this.postsPerSource),
          }, { knownPostIds, onProgress: async (progress) => { latestProgress = progress; await this.progress?.sourceProgress?.(source.id, progress); }, shouldCancel: () => this.progress?.shouldCancel?.() ?? false });
          const persisted = await this.posts.persistNew(source.id, collected, collectedAt);
          await this.accounts.recordCollectionSuccess(source.id, collectedAt);
          result.sourcesProcessed += 1;
          result.postsInserted += persisted.inserted;
          result.duplicatesIgnored += persisted.duplicates;
          this.logger.info({
            operation: "collector.source.complete",
            sourceAccount: source.username,
            collected: collected.length,
            inserted: persisted.inserted,
            duplicates: persisted.duplicates,
          }, "Source collection completed");
          const cancelled = latestProgress?.stopReason === "cancelled";
          await this.progress?.sourceFinished?.({ id: source.id, failed: false, cancelled, inserted: persisted.inserted, stopReason: latestProgress?.stopReason });
          if (cancelled) { result.cancelled = true; break; }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          result.sourcesFailed += 1;
          try {
            await this.accounts.recordCollectionFailure(source.id, collectedAt, message);
          } catch (recordError) {
            this.logger.error({
              operation: "collector.failure-record.failed",
              sourceAccount: source.username,
              error: recordError instanceof Error ? recordError.message : String(recordError),
            }, "Failed to persist source collection failure");
          }
          this.logger.error({
            operation: "collector.source.failed",
            sourceAccount: source.username,
            error: message,
          }, "Source collection failed");
          await this.progress?.sourceFinished?.({ id: source.id, failed: true, cancelled: false, inserted: 0, error: message });
        }
      }
    };

    if (this.collector.withSession) await this.collector.withSession(collectSources);
    else await collectSources();

    return result;
  }
}
