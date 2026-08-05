PRAGMA foreign_keys=OFF;

CREATE TABLE "BrowserIdentity" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "role" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "expectedUsername" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "automaticEnabled" BOOLEAN NOT NULL DEFAULT false,
  "browserId" TEXT NOT NULL,
  "executablePath" TEXT,
  "profilePath" TEXT NOT NULL,
  "profileDirectory" TEXT,
  "verifiedUsername" TEXT,
  "verifiedAt" DATETIME,
  "verifiedFingerprint" TEXT,
  "verificationError" TEXT,
  "profileDeletedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

INSERT INTO "BrowserIdentity" ("id", "role", "label", "expectedUsername", "enabled", "automaticEnabled", "browserId", "executablePath", "profilePath", "verifiedUsername", "verifiedAt", "createdAt", "updatedAt")
VALUES
  ('legacy-collector', 'COLLECTOR', 'Primary Collector', NULLIF(REPLACE(COALESCE((SELECT "value" FROM "AppSetting" WHERE "key"='COLLECTOR_BROWSER_SESSION_ACCOUNT'), ''), '@', ''), ''), true, true, COALESCE((SELECT "value" FROM "AppSetting" WHERE "key"='DEVICE_COLLECTOR_BROWSER_ID'), 'msedge'), (SELECT "value" FROM "AppSetting" WHERE "key"='DEVICE_COLLECTOR_BROWSER_EXECUTABLE'), CASE WHEN (SELECT "value" FROM "AppSetting" WHERE "key"='DEVICE_COLLECTOR_BROWSER_ID') IS NULL THEN 'storage/browser-profile-collector' ELSE 'storage/browser-profiles/collector/' || (SELECT "value" FROM "AppSetting" WHERE "key"='DEVICE_COLLECTOR_BROWSER_ID') END, NULLIF(REPLACE(COALESCE((SELECT "value" FROM "AppSetting" WHERE "key"='COLLECTOR_BROWSER_SESSION_ACCOUNT'), ''), '@', ''), ''), (SELECT "value" FROM "AppSetting" WHERE "key"='COLLECTOR_BROWSER_SESSION_VERIFIED_AT'), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('legacy-publisher', 'PUBLISHER', 'Primary Publisher', NULLIF(REPLACE(COALESCE((SELECT "value" FROM "AppSetting" WHERE "key"='PUBLISHER_BROWSER_SESSION_ACCOUNT'), ''), '@', ''), ''), true, false, COALESCE((SELECT "value" FROM "AppSetting" WHERE "key"='DEVICE_PUBLISHER_BROWSER_ID'), 'msedge'), (SELECT "value" FROM "AppSetting" WHERE "key"='DEVICE_PUBLISHER_BROWSER_EXECUTABLE'), CASE WHEN (SELECT "value" FROM "AppSetting" WHERE "key"='DEVICE_PUBLISHER_BROWSER_ID') IS NULL THEN 'storage/browser-profile-publisher' ELSE 'storage/browser-profiles/publisher/' || (SELECT "value" FROM "AppSetting" WHERE "key"='DEVICE_PUBLISHER_BROWSER_ID') END, NULLIF(REPLACE(COALESCE((SELECT "value" FROM "AppSetting" WHERE "key"='PUBLISHER_BROWSER_SESSION_ACCOUNT'), ''), '@', ''), ''), (SELECT "value" FROM "AppSetting" WHERE "key"='PUBLISHER_BROWSER_SESSION_VERIFIED_AT'), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

ALTER TABLE "SourceAccount" ADD COLUMN "collectorIdentityId" TEXT REFERENCES "BrowserIdentity"("id") ON DELETE SET NULL;
UPDATE "SourceAccount" SET "collectorIdentityId"='legacy-collector' WHERE "managedSource"=true;
ALTER TABLE "SourcePost" ADD COLUMN "collectedByIdentityId" TEXT REFERENCES "BrowserIdentity"("id") ON DELETE SET NULL;
UPDATE "SourcePost" SET "collectedByIdentityId"='legacy-collector';
ALTER TABLE "DownloadJob" ADD COLUMN "collectorIdentityId" TEXT REFERENCES "BrowserIdentity"("id") ON DELETE SET NULL;
UPDATE "DownloadJob" SET "collectorIdentityId"='legacy-collector';
ALTER TABLE "CollectionRun" ADD COLUMN "collectorIdentityId" TEXT REFERENCES "BrowserIdentity"("id") ON DELETE SET NULL;
UPDATE "CollectionRun" SET "collectorIdentityId"='legacy-collector';

CREATE TABLE "new_PublishJob" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sourcePostId" TEXT NOT NULL,
  "mediaAssetId" TEXT NOT NULL,
  "publisherIdentityId" TEXT,
  "caption" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "scheduledFor" DATETIME,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" DATETIME,
  "lastError" TEXT,
  "startedAt" DATETIME,
  "heartbeatAt" DATETIME,
  "claimToken" TEXT,
  "phase" TEXT,
  "publishedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "PublishJob_sourcePostId_fkey" FOREIGN KEY ("sourcePostId") REFERENCES "SourcePost"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PublishJob_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PublishJob_publisherIdentityId_fkey" FOREIGN KEY ("publisherIdentityId") REFERENCES "BrowserIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_PublishJob" ("id","sourcePostId","mediaAssetId","publisherIdentityId","caption","status","scheduledFor","attemptCount","nextAttemptAt","lastError","startedAt","heartbeatAt","claimToken","phase","publishedAt","createdAt","updatedAt")
SELECT "id","sourcePostId","mediaAssetId",CASE WHEN "status"='READY_FOR_REVIEW' THEN NULL ELSE 'legacy-publisher' END,"caption","status","scheduledFor","attemptCount","nextAttemptAt","lastError","startedAt","heartbeatAt","claimToken","phase","publishedAt","createdAt","updatedAt" FROM "PublishJob";
DROP TABLE "PublishJob";
ALTER TABLE "new_PublishJob" RENAME TO "PublishJob";

CREATE UNIQUE INDEX "BrowserIdentity_role_expectedUsername_key" ON "BrowserIdentity"("role", "expectedUsername");
CREATE UNIQUE INDEX "BrowserIdentity_profilePath_key" ON "BrowserIdentity"("profilePath");
CREATE INDEX "BrowserIdentity_role_enabled_idx" ON "BrowserIdentity"("role", "enabled");
CREATE INDEX "SourceAccount_collectorIdentityId_enabled_idx" ON "SourceAccount"("collectorIdentityId", "enabled");
CREATE INDEX "SourcePost_collectedByIdentityId_idx" ON "SourcePost"("collectedByIdentityId");
CREATE INDEX "DownloadJob_collectorIdentityId_status_idx" ON "DownloadJob"("collectorIdentityId", "status");
CREATE INDEX "CollectionRun_collectorIdentityId_status_idx" ON "CollectionRun"("collectorIdentityId", "status");
CREATE INDEX "PublishJob_status_scheduledFor_nextAttemptAt_idx" ON "PublishJob"("status", "scheduledFor", "nextAttemptAt");
CREATE INDEX "PublishJob_status_heartbeatAt_idx" ON "PublishJob"("status", "heartbeatAt");
CREATE INDEX "PublishJob_publisherIdentityId_status_scheduledFor_idx" ON "PublishJob"("publisherIdentityId", "status", "scheduledFor");
CREATE UNIQUE INDEX "PublishJob_sourcePostId_publisherIdentityId_key" ON "PublishJob"("sourcePostId", "publisherIdentityId");
CREATE UNIQUE INDEX "PublishJob_mediaAssetId_publisherIdentityId_key" ON "PublishJob"("mediaAssetId", "publisherIdentityId");

PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
