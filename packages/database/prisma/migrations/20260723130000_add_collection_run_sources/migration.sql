ALTER TABLE "CollectionRun" ADD COLUMN "targetNew" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CollectionRun" ADD COLUMN "eligibleExamined" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CollectionRun" ADD COLUMN "knownSkipped" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CollectionRun" ADD COLUMN "newFound" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CollectionRun" ADD COLUMN "inserted" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CollectionRun" ADD COLUMN "contentDuplicates" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "CollectionRunSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collectionRunId" TEXT NOT NULL,
    "sourceAccountId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "targetNew" INTEGER NOT NULL,
    "eligibleExamined" INTEGER NOT NULL DEFAULT 0,
    "knownSkipped" INTEGER NOT NULL DEFAULT 0,
    "newFound" INTEGER NOT NULL DEFAULT 0,
    "inserted" INTEGER NOT NULL DEFAULT 0,
    "contentDuplicates" INTEGER NOT NULL DEFAULT 0,
    "stopReason" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "lastError" TEXT,
    CONSTRAINT "CollectionRunSource_collectionRunId_fkey" FOREIGN KEY ("collectionRunId") REFERENCES "CollectionRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CollectionRunSource_sourceAccountId_fkey" FOREIGN KEY ("sourceAccountId") REFERENCES "SourceAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CollectionRunSource_collectionRunId_sourceAccountId_key" ON "CollectionRunSource"("collectionRunId", "sourceAccountId");
CREATE INDEX "CollectionRunSource_collectionRunId_status_idx" ON "CollectionRunSource"("collectionRunId", "status");
