-- CreateTable
CREATE TABLE "SourceAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "displayName" TEXT,
    "profileUrl" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "collectLimit" INTEGER NOT NULL DEFAULT 5,
    "lastCollectedAt" DATETIME,
    "lastCollectionFailedAt" DATETIME,
    "lastCollectionError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SourcePost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "platformPostId" TEXT NOT NULL,
    "sourceAccountId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "postedAt" DATETIME NOT NULL,
    "mediaType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED_FOR_DOWNLOAD',
    "collectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SourcePost_sourceAccountId_fkey" FOREIGN KEY ("sourceAccountId") REFERENCES "SourceAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "SourceAccount_username_key" ON "SourceAccount"("username");

-- CreateIndex
CREATE UNIQUE INDEX "SourcePost_platformPostId_key" ON "SourcePost"("platformPostId");

-- CreateIndex
CREATE UNIQUE INDEX "SourcePost_sourceUrl_key" ON "SourcePost"("sourceUrl");

-- CreateIndex
CREATE INDEX "SourcePost_sourceAccountId_postedAt_idx" ON "SourcePost"("sourceAccountId", "postedAt");

-- CreateIndex
CREATE INDEX "SourcePost_status_idx" ON "SourcePost"("status");
