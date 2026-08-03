ALTER TABLE "PublishJob" ADD COLUMN "heartbeatAt" DATETIME;
ALTER TABLE "PublishJob" ADD COLUMN "claimToken" TEXT;
ALTER TABLE "PublishJob" ADD COLUMN "phase" TEXT;

CREATE INDEX "PublishJob_status_heartbeatAt_idx" ON "PublishJob"("status", "heartbeatAt");
