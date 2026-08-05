import { prisma } from "@cenblu/database";

export async function GET() {
  const [actives, latest] = await Promise.all([
    prisma.collectionRun.findMany({ where: { status: "RUNNING" }, orderBy: { startedAt: "desc" }, include: { collectorIdentity: { select: { label: true, expectedUsername: true } }, sources: { include: { sourceAccount: { select: { username: true } } }, orderBy: { startedAt: "asc" } } } }),
    prisma.collectionRun.findFirst({ orderBy: { startedAt: "desc" }, include: { sources: { include: { sourceAccount: { select: { username: true } } }, orderBy: { startedAt: "asc" } } } }),
  ]);
  return Response.json({ active: actives[0] ?? null, actives, latest }, { headers: { "Cache-Control": "no-store" } });
}
