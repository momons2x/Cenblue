import { prisma } from "@cenblu/database";

export async function GET() {
  const [active, latest] = await Promise.all([
    prisma.collectionRun.findFirst({ where: { status: "RUNNING" }, orderBy: { startedAt: "desc" }, include: { sources: { include: { sourceAccount: { select: { username: true } } }, orderBy: { startedAt: "asc" } } } }),
    prisma.collectionRun.findFirst({ orderBy: { startedAt: "desc" }, include: { sources: { include: { sourceAccount: { select: { username: true } } }, orderBy: { startedAt: "asc" } } } }),
  ]);
  return Response.json({ active, latest }, { headers: { "Cache-Control": "no-store" } });
}
