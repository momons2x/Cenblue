import { prisma } from "@cenblu/database";

export async function GET() {
  const [runtime, active] = await Promise.all([
    prisma.runtimeStatus.findUnique({ where: { component: "dashboard-downloader" } }),
    prisma.downloadJob.findMany({
      where: { status: "RUNNING" },
      orderBy: { startedAt: "asc" },
      select: { id: true, sourcePost: { select: { platformPostId: true, sourceAccount: { select: { username: true } } } } },
    }),
  ]);
  let progress: { processed: number; limit: number } | null = null;
  try {
    const parsed: unknown = runtime?.currentOperation ? JSON.parse(runtime.currentOperation) : null;
    if (parsed && typeof parsed === "object" && "processed" in parsed && "limit" in parsed && typeof parsed.processed === "number" && typeof parsed.limit === "number") progress = { processed: parsed.processed, limit: parsed.limit };
  } catch { /* Invalid historical runtime data is ignored. */ }
  const run = runtime && progress ? { status: runtime.status, ...progress } : null;
  return Response.json({ run, active }, { headers: { "Cache-Control": "no-store" } });
}
