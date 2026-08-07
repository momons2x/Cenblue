import type { PrismaClient } from "@prisma/client";

export type PipelineStatus = {
  enabledSources: number;
  pendingDownloads: number;
  failedDownloads: number;
  scheduledPublishes: number;
  attentionPublishes: number;
  publishedToday: number;
  publishedTotal: number;
  workerActivity: { component: string; status: string; updatedAt: string }[];
};

export class PipelineStatusRepository {
  constructor(private readonly client: PrismaClient) {}

  async status(timeZone = "UTC", now = new Date()): Promise<PipelineStatus> {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
    const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60_000);
    const [enabledSources, pendingDownloads, failedDownloads, scheduledPublishes, attentionPublishes, recentPosts, publishedTotal, workerActivity] = await Promise.all([
      this.client.sourceAccount.count({ where: { enabled: true } }),
      this.client.downloadJob.count({ where: { status: { in: ["PENDING", "RUNNING", "RETRY_WAIT"] } } }),
      this.client.downloadJob.count({ where: { status: "FAILED" } }),
      this.client.publishJob.count({ where: { status: { in: ["APPROVED", "RETRY_WAIT", "RUNNING"] } } }),
      this.client.publishJob.count({ where: { status: { in: ["FAILED", "MANUAL_ATTENTION"] } } }),
      this.client.publishedPost.findMany({ where: { publishedAt: { gte: twoDaysAgo } }, select: { publishedAt: true } }),
      this.client.publishedPost.count(),
      this.client.runtimeStatus.findMany({ orderBy: { updatedAt: "desc" }, select: { component: true, status: true, updatedAt: true } }),
    ]);
    const publishedToday = recentPosts.filter((post) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(post.publishedAt) === day).length;
    return {
      enabledSources,
      pendingDownloads,
      failedDownloads,
      scheduledPublishes,
      attentionPublishes,
      publishedToday,
      publishedTotal,
      workerActivity: workerActivity.map((entry) => ({ component: entry.component, status: entry.status, updatedAt: entry.updatedAt.toISOString() })),
    };
  }

  async render(now = new Date()): Promise<string> {
    const status = await this.status(undefined, now);
    const lines = [
      `Sources: ${status.enabledSources} enabled`,
      `Downloads: ${status.pendingDownloads} pending · ${status.failedDownloads} failed`,
      `Publishes: ${status.scheduledPublishes} scheduled · ${status.attentionPublishes} need attention`,
      `Published: ${status.publishedToday} today · ${status.publishedTotal} total`,
    ];
    if (status.workerActivity.length > 0) {
      lines.push("Workers:");
      for (const worker of status.workerActivity) lines.push(`  ${worker.component}: ${worker.status}`);
    }
    return lines.join("\n");
  }
}
