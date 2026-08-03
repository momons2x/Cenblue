PRAGMA foreign_keys=OFF;

CREATE TABLE "new_CollectionRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "totalSources" INTEGER NOT NULL,
    "completedSources" INTEGER NOT NULL DEFAULT 0,
    "failedSources" INTEGER NOT NULL DEFAULT 0,
    "currentSource" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "lastError" TEXT,
    "cancelRequestedAt" DATETIME,
    "heartbeatAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "new_CollectionRun" ("id", "status", "totalSources", "completedSources", "failedSources", "currentSource", "startedAt", "completedAt", "lastError", "heartbeatAt")
SELECT "id", "status", "totalSources", "completedSources", "failedSources", "currentSource", "startedAt", "completedAt", "lastError", CURRENT_TIMESTAMP FROM "CollectionRun";

DROP TABLE "CollectionRun";
ALTER TABLE "new_CollectionRun" RENAME TO "CollectionRun";
CREATE INDEX "CollectionRun_status_startedAt_idx" ON "CollectionRun"("status", "startedAt");

PRAGMA foreign_keys=ON;
