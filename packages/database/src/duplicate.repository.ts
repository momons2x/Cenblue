import type { PrismaClient, SourcePost } from "@prisma/client";
import { withDatabaseRetry } from "./retry";

function words(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []);
}

export function captionSimilarity(left: string, right: string): number {
  const a = words(left);
  const b = words(right);
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const word of a) if (b.has(word)) overlap += 1;
  return overlap / new Set([...a, ...b]).size;
}

export function perceptualSimilarity(left: string, right: string): number {
  if (left.length !== right.length || left.length === 0) return 0;
  let different = 0;
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) different += 1;
  return 1 - different / left.length;
}

export class DuplicateRepository {
  constructor(private readonly client: PrismaClient) {}

  async detectCaption(post: Pick<SourcePost, "id" | "text">): Promise<void> {
    if (!post.text.trim()) return;
    const candidates = await this.client.sourcePost.findMany({
      where: { id: { not: post.id }, duplicateGroupId: null, text: { not: "" } },
      orderBy: { createdAt: "asc" },
      select: { id: true, text: true },
    });
    const match = candidates.find((candidate) => captionSimilarity(post.text, candidate.text) >= 0.96);
    if (match) await this.group(post.id, match.id, "CAPTION", captionSimilarity(post.text, match.text));
  }

  async detectMedia(sourcePostId: string, checksum: string, perceptualHash: string | null): Promise<void> {
    const candidates = await this.client.mediaAsset.findMany({
      where: { sourcePostId: { not: sourcePostId } },
      select: { sourcePostId: true, checksum: true, perceptualHash: true },
    });
    const exact = candidates.find((candidate) => candidate.checksum === checksum);
    if (exact) return this.group(sourcePostId, exact.sourcePostId, "CHECKSUM", 1);
    if (!perceptualHash) return;
    const similar = candidates.find((candidate) => candidate.perceptualHash && perceptualSimilarity(perceptualHash, candidate.perceptualHash) >= 0.92);
    if (similar?.perceptualHash) await this.group(sourcePostId, similar.sourcePostId, "PERCEPTUAL", perceptualSimilarity(perceptualHash, similar.perceptualHash));
  }

  private async group(postId: string, canonicalId: string, detectionKind: string, similarity: number): Promise<void> {
    await withDatabaseRetry(() => this.client.$transaction(async (transaction) => {
      const canonical = await transaction.sourcePost.findUniqueOrThrow({ where: { id: canonicalId }, select: { duplicateGroupId: true } });
      const group = canonical.duplicateGroupId
        ? await transaction.duplicateGroup.findUniqueOrThrow({ where: { id: canonical.duplicateGroupId } })
        : await transaction.duplicateGroup.create({ data: { canonicalSourcePostId: canonicalId, detectionKind, similarity } });
      await transaction.sourcePost.updateMany({
        where: { id: { in: [postId, canonicalId] } },
        data: { duplicateGroupId: group.id },
      });
      await transaction.sourcePost.update({ where: { id: postId }, data: { status: "SKIPPED", duplicateReason: `${detectionKind} duplicate (${Math.round(similarity * 100)}%)` } });
      await transaction.downloadJob.updateMany({ where: { sourcePostId: postId, status: { not: "COMPLETED" } }, data: { status: "CANCELLED", nextAttemptAt: null } });
    }));
  }
}
