import { applyStoredSettings, loadConfig } from "@cenblu/config";
import { prisma, SettingsRepository } from "@cenblu/database";
import { MediaRemovalService, StorageMaintenance } from "@cenblu/operations";
import { createLogger } from "@cenblu/shared/logger";

async function main(): Promise<void> {
  const config = applyStoredSettings(loadConfig(), await new SettingsRepository(prisma).getAll());
  const logger = createLogger({ directory: config.logStoragePath, component: "maintenance", maxBytes: config.logMaxBytes, retainedFiles: config.logRetainedFiles });
  const maintenance = new StorageMaintenance(prisma);
  const command = process.argv[2];
  if (command === "audit") {
    const issues = await maintenance.audit(config.videoStoragePath, config.thumbnailStoragePath);
    logger[issues.length === 0 ? "info" : "error"]({ operation: "maintenance.storage.audit", issueCount: issues.length, issues }, issues.length === 0 ? "Storage audit passed" : "Storage audit found integrity issues");
    if (issues.length > 0) process.exitCode = 1;
  } else if (command === "backup") {
    const path = await maintenance.backup(config.backupStoragePath);
    logger.info({ operation: "maintenance.database.backup", path }, "Database backup completed");
  } else if (command === "clean-temp") {
    const removed = await maintenance.cleanTemporary(config.tempStoragePath, new Date(Date.now() - 24 * 60 * 60_000));
    logger.info({ operation: "maintenance.temp.cleanup", removed }, "Temporary cleanup completed");
  } else if (command === "purge-published") {
    const dryRun = process.argv.includes("--dry-run");
    const summary = await new MediaRemovalService(prisma).purgePublished({ videos: config.videoStoragePath, thumbnails: config.thumbnailStoragePath }, { dryRun });
    const gigabytes = Number((summary.bytes / 1024 ** 3).toFixed(2));
    const level = summary.failed > 0 ? "warn" : "info";
    logger[level]({ operation: "maintenance.media.purge-published", ...summary, gigabytes }, `${dryRun ? "Would remove" : "Removed"} local media for ${summary.removed} published posts (${gigabytes} GB); skipped ${summary.skipped}, failed ${summary.failed}`);
    if (summary.failed > 0) process.exitCode = 1;
  } else throw new Error("Use one of: audit, backup, clean-temp, purge-published [--dry-run]");
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
