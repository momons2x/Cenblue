import { applyStoredSettings, loadConfig } from "@cenblu/config";
import { prisma, SettingsRepository } from "@cenblu/database";
import { StorageMaintenance } from "@cenblu/operations";
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
  } else throw new Error("Use one of: audit, backup, clean-temp");
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
