-- CreateIndex
CREATE INDEX "MediaAsset_createdAt_idx" ON "MediaAsset"("createdAt");

-- CreateIndex
CREATE INDEX "PublishJob_status_updatedAt_idx" ON "PublishJob"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "PublishedPost_publishedAt_idx" ON "PublishedPost"("publishedAt");
