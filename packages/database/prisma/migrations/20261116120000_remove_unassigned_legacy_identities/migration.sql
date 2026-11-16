-- Remove the legacy placeholder identities seeded by 20260804220000 when they
-- never received an X username and no work references them. Fresh installs
-- have no pre-identity AppSetting rows, so those seeds arrive empty.
DELETE FROM "BrowserIdentity"
WHERE "id" IN ('legacy-collector', 'legacy-publisher')
  AND "expectedUsername" IS NULL
  AND "verifiedUsername" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "SourceAccount" WHERE "collectorIdentityId" = "BrowserIdentity"."id")
  AND NOT EXISTS (SELECT 1 FROM "SourcePost" WHERE "collectedByIdentityId" = "BrowserIdentity"."id")
  AND NOT EXISTS (SELECT 1 FROM "DownloadJob" WHERE "collectorIdentityId" = "BrowserIdentity"."id")
  AND NOT EXISTS (SELECT 1 FROM "CollectionRun" WHERE "collectorIdentityId" = "BrowserIdentity"."id")
  AND NOT EXISTS (SELECT 1 FROM "PublishJob" WHERE "publisherIdentityId" = "BrowserIdentity"."id");
