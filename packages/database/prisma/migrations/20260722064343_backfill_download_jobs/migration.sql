-- Queue Phase 01 posts that existed before durable download jobs were introduced.
INSERT INTO "DownloadJob" ("id", "sourcePostId", "status", "attemptCount", "createdAt", "updatedAt")
SELECT lower(hex(randomblob(16))), source."id", 'PENDING', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "SourcePost" AS source
WHERE source."status" = 'QUEUED_FOR_DOWNLOAD'
  AND NOT EXISTS (SELECT 1 FROM "DownloadJob" AS job WHERE job."sourcePostId" = source."id");
