CREATE TABLE "RuntimeStatus" (
    "component" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "currentOperation" TEXT,
    "lastError" TEXT,
    "updatedAt" DATETIME NOT NULL
);
