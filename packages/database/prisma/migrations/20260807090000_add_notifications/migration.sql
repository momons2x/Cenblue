CREATE TABLE "OperationalEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "meta" TEXT,
    "dedupeKey" TEXT,
    "dedupeUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "NotificationOutbox" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channel" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "claimToken" TEXT,
    "nextAttemptAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "OperationalEvent_severity_createdAt_idx" ON "OperationalEvent"("severity", "createdAt");
CREATE INDEX "OperationalEvent_dedupeKey_idx" ON "OperationalEvent"("dedupeKey");
CREATE INDEX "NotificationOutbox_status_nextAttemptAt_idx" ON "NotificationOutbox"("status", "nextAttemptAt");
