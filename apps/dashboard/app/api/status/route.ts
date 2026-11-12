import { prisma } from "@cenblu/database";

export const dynamic = "force-dynamic";

const collectionInclude = {
  collectorIdentity: { select: { label: true, expectedUsername: true } },
  sources: { include: { sourceAccount: { select: { username: true } } }, orderBy: { startedAt: "asc" as const } },
};

export async function GET() {
  const [actives, busy, runtime, reviewCount, queueDownloads, queuePublishes] = await Promise.all([
    prisma.collectionRun.findMany({ where: { status: "RUNNING" }, orderBy: { startedAt: "desc" }, include: collectionInclude }),
    prisma.collectionRun.findFirst({ where: { status: "BUSY" }, orderBy: { startedAt: "desc" }, include: collectionInclude }),
    prisma.runtimeStatus.findUnique({ where: { component: "dashboard-downloader" } }),
    prisma.publishJob.count({ where: { status: { in: ["READY_FOR_REVIEW", "MANUAL_ATTENTION", "FAILED"] } } }),
    prisma.downloadJob.count({ where: { status: { in: ["PENDING", "RETRY_WAIT", "FAILED", "CANCELLED"] } } }),
    prisma.publishJob.count({ where: { status: { in: ["APPROVED", "RETRY_WAIT", "MANUAL_ATTENTION", "FAILED"] } } }),
  ]);
  const latest = actives[0] ?? busy ?? null;
  let progress: { processed: number; limit: number } | null = null;
  try {
    const parsed: unknown = runtime?.currentOperation ? JSON.parse(runtime.currentOperation) : null;
    if (parsed && typeof parsed === "object" && "processed" in parsed && "limit" in parsed && typeof parsed.processed === "number" && typeof parsed.limit === "number") progress = { processed: parsed.processed, limit: parsed.limit };
  } catch {
    // Invalid historical runtime data is ignored.
  }
  const active = runtime?.status === "RUNNING"
    ? await prisma.downloadJob.findMany({
      where: { status: "RUNNING" },
      orderBy: { startedAt: "asc" },
      select: { id: true, sourcePost: { select: { platformPostId: true, sourceAccount: { select: { username: true } } } } },
    })
    : [];
  return Response.json({
    collection: { active: latest, actives, latest },
    downloads: { run: runtime && progress ? { status: runtime.status, ...progress } : null, active },
    counts: { review: reviewCount, queue: queueDownloads + queuePublishes },
  }, { headers: { "Cache-Control": "no-store" } });
}
