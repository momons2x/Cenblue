ALTER TABLE "SourceAccount" ADD COLUMN "managedSource" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SourcePost" ADD COLUMN "discoveryKind" TEXT NOT NULL DEFAULT 'PROFILE';
CREATE INDEX "SourcePost_discoveryKind_idx" ON "SourcePost"("discoveryKind");
