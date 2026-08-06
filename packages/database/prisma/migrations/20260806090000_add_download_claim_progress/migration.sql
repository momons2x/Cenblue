ALTER TABLE "DownloadJob" ADD COLUMN "heartbeatAt" DATETIME;
ALTER TABLE "DownloadJob" ADD COLUMN "claimToken" TEXT;

CREATE INDEX "DownloadJob_status_heartbeatAt_idx" ON "DownloadJob"("status", "heartbeatAt");
