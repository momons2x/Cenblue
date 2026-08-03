import type { BookmarkedPost, CollectedPost } from "@cenblu/shared";
import type { PrismaClient } from "@prisma/client";
import { withDatabaseRetry } from "./retry";

export type PersistPostsResult = {
  inserted: number;
  duplicates: number;
};

export class SourcePostRepository {
  constructor(private readonly client: PrismaClient) {}

  async listPlatformPostIds(sourceAccountId: string): Promise<Set<string>> {
    const posts = await this.client.sourcePost.findMany({ where: { sourceAccountId }, select: { platformPostId: true } });
    return new Set(posts.map((post) => post.platformPostId));
  }

  async listAllPlatformPostIds(): Promise<Set<string>> {
    const posts = await this.client.sourcePost.findMany({ select: { platformPostId: true } });
    return new Set(posts.map((post) => post.platformPostId));
  }

  async persistNew(sourceAccountId: string, posts: CollectedPost[], collectedAt: Date): Promise<PersistPostsResult> {
    const result = await withDatabaseRetry(() => this.client.$transaction(async (transaction) => {
      const uniquePosts = [...new Map(posts.map((post) => [post.platformPostId, post])).values()];
      const platformPostIds = uniquePosts.map((post) => post.platformPostId);
      const existing = platformPostIds.length === 0
        ? []
        : await transaction.sourcePost.findMany({
            where: { platformPostId: { in: platformPostIds } },
            select: { platformPostId: true },
          });
      const existingIds = new Set(existing.map((post) => post.platformPostId));
      const newPosts = uniquePosts.filter((post) => !existingIds.has(post.platformPostId));

      if (newPosts.length > 0) {
        await transaction.sourcePost.createMany({
          data: newPosts.map((post) => ({
            ...post,
            sourceAccountId,
            status: "QUEUED_FOR_DOWNLOAD",
            collectedAt,
          })),
        });
        const created = await transaction.sourcePost.findMany({
          where: { platformPostId: { in: newPosts.map((post) => post.platformPostId) } },
          select: { id: true },
        });
        await transaction.downloadJob.createMany({ data: created.map((post) => ({ sourcePostId: post.id })) });
      }

      return { inserted: newPosts.length, duplicates: posts.length - newPosts.length };
    }));
    return result;
  }

  async persistBookmarks(posts: BookmarkedPost[], collectedAt: Date): Promise<PersistPostsResult> {
    const uniquePosts = [...new Map(posts.map((post) => [post.platformPostId, post])).values()];
    const transactionResult = await withDatabaseRetry(() => this.client.$transaction(async (transaction) => {
      const createdIds: string[] = [];
      const existing = uniquePosts.length === 0 ? [] : await transaction.sourcePost.findMany({ where: { platformPostId: { in: uniquePosts.map((post) => post.platformPostId) } }, select: { platformPostId: true } });
      const existingIds = new Set(existing.map((post) => post.platformPostId));
      const newPosts = uniquePosts.filter((post) => !existingIds.has(post.platformPostId));
      for (const post of newPosts) {
        const authorUsername = post.authorUsername.toLowerCase();
        const author = await transaction.sourceAccount.upsert({
          where: { username: authorUsername },
          create: { username: authorUsername, profileUrl: `https://x.com/${authorUsername}`, enabled: false, managedSource: false },
          update: {},
        });
        const { authorUsername: _authorUsername, ...postData } = post;
        void _authorUsername;
        const created = await transaction.sourcePost.create({ data: { ...postData, sourceAccountId: author.id, discoveryKind: "BOOKMARK", status: "QUEUED_FOR_DOWNLOAD", collectedAt } });
        await transaction.downloadJob.create({ data: { sourcePostId: created.id } });
        createdIds.push(created.id);
      }
      return { result: { inserted: newPosts.length, duplicates: posts.length - newPosts.length }, createdIds };
    }));
    return transactionResult.result;
  }
}
