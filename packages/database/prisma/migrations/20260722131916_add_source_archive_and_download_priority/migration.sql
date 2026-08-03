-- AlterTable
ALTER TABLE "SourceAccount" ADD COLUMN "archivedAt" DATETIME;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DownloadJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourcePostId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME,
    "lastError" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "requestedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DownloadJob_sourcePostId_fkey" FOREIGN KEY ("sourcePostId") REFERENCES "SourcePost" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_DownloadJob" ("attemptCount", "completedAt", "createdAt", "id", "lastError", "nextAttemptAt", "sourcePostId", "startedAt", "status", "updatedAt") SELECT "attemptCount", "completedAt", "createdAt", "id", "lastError", "nextAttemptAt", "sourcePostId", "startedAt", "status", "updatedAt" FROM "DownloadJob";
DROP TABLE "DownloadJob";
ALTER TABLE "new_DownloadJob" RENAME TO "DownloadJob";
CREATE UNIQUE INDEX "DownloadJob_sourcePostId_key" ON "DownloadJob"("sourcePostId");
CREATE INDEX "DownloadJob_status_nextAttemptAt_idx" ON "DownloadJob"("status", "nextAttemptAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "SourceAccount_archivedAt_idx" ON "SourceAccount"("archivedAt");
