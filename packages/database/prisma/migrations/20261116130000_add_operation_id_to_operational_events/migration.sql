-- AlterTable
ALTER TABLE "OperationalEvent" ADD COLUMN "operationId" TEXT;

-- CreateIndex
CREATE INDEX "OperationalEvent_operationId_createdAt_idx" ON "OperationalEvent"("operationId", "createdAt");
