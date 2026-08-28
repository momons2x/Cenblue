-- AlterTable
ALTER TABLE "BrowserIdentity" ADD COLUMN "dailyPostLimit" INTEGER;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
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
    "heartbeatAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "targetNew" INTEGER NOT NULL DEFAULT 0,
    "collectorIdentityId" TEXT,
    "eligibleExamined" INTEGER NOT NULL DEFAULT 0,
    "knownSkipped" INTEGER NOT NULL DEFAULT 0,
    "newFound" INTEGER NOT NULL DEFAULT 0,
    "inserted" INTEGER NOT NULL DEFAULT 0,
    "contentDuplicates" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "CollectionRun_collectorIdentityId_fkey" FOREIGN KEY ("collectorIdentityId") REFERENCES "BrowserIdentity" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_CollectionRun" ("cancelRequestedAt", "collectorIdentityId", "completedAt", "completedSources", "contentDuplicates", "currentSource", "eligibleExamined", "failedSources", "heartbeatAt", "id", "inserted", "knownSkipped", "lastError", "newFound", "startedAt", "status", "targetNew", "totalSources") SELECT "cancelRequestedAt", "collectorIdentityId", "completedAt", "completedSources", "contentDuplicates", "currentSource", "eligibleExamined", "failedSources", "heartbeatAt", "id", "inserted", "knownSkipped", "lastError", "newFound", "startedAt", "status", "targetNew", "totalSources" FROM "CollectionRun";
DROP TABLE "CollectionRun";
ALTER TABLE "new_CollectionRun" RENAME TO "CollectionRun";
CREATE INDEX "CollectionRun_status_startedAt_idx" ON "CollectionRun"("status", "startedAt");
CREATE INDEX "CollectionRun_collectorIdentityId_status_idx" ON "CollectionRun"("collectorIdentityId", "status");
CREATE TABLE "new_DownloadJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourcePostId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME,
    "lastError" TEXT,
    "startedAt" DATETIME,
    "heartbeatAt" DATETIME,
    "claimToken" TEXT,
    "completedAt" DATETIME,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "requestedAt" DATETIME,
    "collectorIdentityId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DownloadJob_sourcePostId_fkey" FOREIGN KEY ("sourcePostId") REFERENCES "SourcePost" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DownloadJob_collectorIdentityId_fkey" FOREIGN KEY ("collectorIdentityId") REFERENCES "BrowserIdentity" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_DownloadJob" ("attemptCount", "claimToken", "collectorIdentityId", "completedAt", "createdAt", "heartbeatAt", "id", "lastError", "nextAttemptAt", "priority", "requestedAt", "sourcePostId", "startedAt", "status", "updatedAt") SELECT "attemptCount", "claimToken", "collectorIdentityId", "completedAt", "createdAt", "heartbeatAt", "id", "lastError", "nextAttemptAt", "priority", "requestedAt", "sourcePostId", "startedAt", "status", "updatedAt" FROM "DownloadJob";
DROP TABLE "DownloadJob";
ALTER TABLE "new_DownloadJob" RENAME TO "DownloadJob";
CREATE UNIQUE INDEX "DownloadJob_sourcePostId_key" ON "DownloadJob"("sourcePostId");
CREATE INDEX "DownloadJob_status_nextAttemptAt_idx" ON "DownloadJob"("status", "nextAttemptAt");
CREATE INDEX "DownloadJob_status_heartbeatAt_idx" ON "DownloadJob"("status", "heartbeatAt");
CREATE INDEX "DownloadJob_collectorIdentityId_status_idx" ON "DownloadJob"("collectorIdentityId", "status");
CREATE TABLE "new_SourceAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "displayName" TEXT,
    "profileUrl" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "managedSource" BOOLEAN NOT NULL DEFAULT true,
    "collectLimit" INTEGER NOT NULL DEFAULT 5,
    "lastCollectedAt" DATETIME,
    "lastCollectionFailedAt" DATETIME,
    "lastCollectionError" TEXT,
    "archivedAt" DATETIME,
    "captionTemplate" TEXT,
    "attributionTemplate" TEXT,
    "hashtagRules" TEXT,
    "collectorIdentityId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SourceAccount_collectorIdentityId_fkey" FOREIGN KEY ("collectorIdentityId") REFERENCES "BrowserIdentity" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SourceAccount" ("archivedAt", "attributionTemplate", "captionTemplate", "collectLimit", "collectorIdentityId", "createdAt", "displayName", "enabled", "hashtagRules", "id", "lastCollectedAt", "lastCollectionError", "lastCollectionFailedAt", "managedSource", "profileUrl", "updatedAt", "username") SELECT "archivedAt", "attributionTemplate", "captionTemplate", "collectLimit", "collectorIdentityId", "createdAt", "displayName", "enabled", "hashtagRules", "id", "lastCollectedAt", "lastCollectionError", "lastCollectionFailedAt", "managedSource", "profileUrl", "updatedAt", "username" FROM "SourceAccount";
DROP TABLE "SourceAccount";
ALTER TABLE "new_SourceAccount" RENAME TO "SourceAccount";
CREATE UNIQUE INDEX "SourceAccount_username_key" ON "SourceAccount"("username");
CREATE INDEX "SourceAccount_archivedAt_idx" ON "SourceAccount"("archivedAt");
CREATE INDEX "SourceAccount_collectorIdentityId_enabled_idx" ON "SourceAccount"("collectorIdentityId", "enabled");
CREATE TABLE "new_SourcePost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "platformPostId" TEXT NOT NULL,
    "sourceAccountId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "postedAt" DATETIME NOT NULL,
    "mediaType" TEXT NOT NULL,
    "discoveryKind" TEXT NOT NULL DEFAULT 'PROFILE',
    "status" TEXT NOT NULL DEFAULT 'QUEUED_FOR_DOWNLOAD',
    "collectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "reviewNotes" TEXT,
    "internalTags" TEXT,
    "duplicateGroupId" TEXT,
    "duplicateReason" TEXT,
    "collectedByIdentityId" TEXT,
    CONSTRAINT "SourcePost_sourceAccountId_fkey" FOREIGN KEY ("sourceAccountId") REFERENCES "SourceAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SourcePost_collectedByIdentityId_fkey" FOREIGN KEY ("collectedByIdentityId") REFERENCES "BrowserIdentity" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SourcePost_duplicateGroupId_fkey" FOREIGN KEY ("duplicateGroupId") REFERENCES "DuplicateGroup" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SourcePost" ("collectedAt", "collectedByIdentityId", "createdAt", "discoveryKind", "duplicateGroupId", "duplicateReason", "id", "internalTags", "mediaType", "platformPostId", "postedAt", "reviewNotes", "sourceAccountId", "sourceUrl", "status", "text", "updatedAt") SELECT "collectedAt", "collectedByIdentityId", "createdAt", "discoveryKind", "duplicateGroupId", "duplicateReason", "id", "internalTags", "mediaType", "platformPostId", "postedAt", "reviewNotes", "sourceAccountId", "sourceUrl", "status", "text", "updatedAt" FROM "SourcePost";
DROP TABLE "SourcePost";
ALTER TABLE "new_SourcePost" RENAME TO "SourcePost";
CREATE UNIQUE INDEX "SourcePost_platformPostId_key" ON "SourcePost"("platformPostId");
CREATE UNIQUE INDEX "SourcePost_sourceUrl_key" ON "SourcePost"("sourceUrl");
CREATE INDEX "SourcePost_sourceAccountId_postedAt_idx" ON "SourcePost"("sourceAccountId", "postedAt");
CREATE INDEX "SourcePost_status_idx" ON "SourcePost"("status");
CREATE INDEX "SourcePost_discoveryKind_idx" ON "SourcePost"("discoveryKind");
CREATE INDEX "SourcePost_duplicateGroupId_idx" ON "SourcePost"("duplicateGroupId");
CREATE INDEX "SourcePost_collectedByIdentityId_idx" ON "SourcePost"("collectedByIdentityId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
