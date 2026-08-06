import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "@cenblu/config";
import { prisma } from "@cenblu/database";

export async function GET() {
  const config = loadConfig();
  let version = "unknown";
  try {
    const manifest: { version?: string } = JSON.parse(await readFile(resolve(config.repositoryRoot, "package.json"), "utf8"));
    version = manifest.version ?? "unknown";
  } catch { /* The version is best-effort and omitted when the manifest is unavailable. */ }

  let database = "ok";
  let storage = "ok";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch { database = "unavailable"; }
  for (const directory of [config.videoStoragePath, config.logStoragePath]) {
    try {
      const entry = await stat(directory);
      if (!entry.isDirectory()) storage = "unavailable";
    } catch { storage = "unavailable"; }
  }

  const [pendingDownloads, attentionPublishes] = await Promise.all([
    prisma.downloadJob.count({ where: { status: { in: ["PENDING", "RETRY_WAIT"] } } }),
    prisma.publishJob.count({ where: { status: { in: ["FAILED", "MANUAL_ATTENTION"] } } }),
  ]);

  return Response.json(
    {
      status: database === "ok" && storage === "ok" ? "ok" : "degraded",
      version,
      timezone: config.timezone,
      database,
      storage,
      pendingDownloads,
      attentionPublishes,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
