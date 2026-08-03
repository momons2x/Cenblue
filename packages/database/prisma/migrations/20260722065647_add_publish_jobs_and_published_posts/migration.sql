-- CreateTable
CREATE TABLE "PublishJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourcePostId" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "scheduledFor" DATETIME,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME,
    "lastError" TEXT,
    "startedAt" DATETIME,
    "publishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PublishJob_sourcePostId_fkey" FOREIGN KEY ("sourcePostId") REFERENCES "SourcePost" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PublishJob_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PublishedPost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "publishJobId" TEXT NOT NULL,
    "platformPostId" TEXT,
    "platformUrl" TEXT,
    "publishedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PublishedPost_publishJobId_fkey" FOREIGN KEY ("publishJobId") REFERENCES "PublishJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PublishJob_sourcePostId_key" ON "PublishJob"("sourcePostId");

-- CreateIndex
CREATE UNIQUE INDEX "PublishJob_mediaAssetId_key" ON "PublishJob"("mediaAssetId");

-- CreateIndex
CREATE INDEX "PublishJob_status_scheduledFor_nextAttemptAt_idx" ON "PublishJob"("status", "scheduledFor", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "PublishedPost_publishJobId_key" ON "PublishedPost"("publishJobId");

-- CreateIndex
CREATE UNIQUE INDEX "PublishedPost_platformPostId_key" ON "PublishedPost"("platformPostId");
