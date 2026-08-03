ALTER TABLE "SourceAccount" ADD COLUMN "captionTemplate" TEXT;
ALTER TABLE "SourceAccount" ADD COLUMN "attributionTemplate" TEXT;
ALTER TABLE "SourceAccount" ADD COLUMN "hashtagRules" TEXT;

ALTER TABLE "SourcePost" ADD COLUMN "reviewNotes" TEXT;
ALTER TABLE "SourcePost" ADD COLUMN "internalTags" TEXT;
ALTER TABLE "SourcePost" ADD COLUMN "duplicateGroupId" TEXT;
ALTER TABLE "SourcePost" ADD COLUMN "duplicateReason" TEXT;

ALTER TABLE "MediaAsset" ADD COLUMN "perceptualHash" TEXT;

CREATE TABLE "DuplicateGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "canonicalSourcePostId" TEXT NOT NULL,
    "detectionKind" TEXT NOT NULL,
    "similarity" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "SourcePost_duplicateGroupId_idx" ON "SourcePost"("duplicateGroupId");
CREATE INDEX "DuplicateGroup_canonicalSourcePostId_idx" ON "DuplicateGroup"("canonicalSourcePostId");
