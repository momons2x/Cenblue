import { resolve } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { BrowserIdentityRepository, prisma, PublishRepository, SourceAccountRepository, SourcePostRepository } from "@cenblu/database";

describe("browser identity ownership", () => {
  beforeEach(async () => {
    await prisma.publishedPost.deleteMany();
    await prisma.publishJob.deleteMany();
    await prisma.mediaAsset.deleteMany();
    await prisma.downloadJob.deleteMany();
    await prisma.sourcePost.deleteMany();
    await prisma.sourceAccount.deleteMany();
    await prisma.collectionRun.deleteMany();
    await prisma.browserIdentity.deleteMany();
  });

  it("creates independent Publisher targets for one reviewed post", async () => {
    const identities = new BrowserIdentityRepository(prisma);
    const publisherA = await identities.create({ role: "PUBLISHER", label: "Publisher A", expectedUsername: "publisher_a", browserId: "chrome", executablePath: "C:/chrome.exe", profileRoot: resolve("storage/browser-profiles") });
    const publisherB = await identities.create({ role: "PUBLISHER", label: "Publisher B", expectedUsername: "publisher_b", browserId: "brave", executablePath: "C:/brave.exe", profileRoot: resolve("storage/browser-profiles") });
    const source = await new SourceAccountRepository(prisma).create({ username: "identity_source" });
    await new SourcePostRepository(prisma).persistNew(source.id, [{ platformPostId: "991001", sourceUrl: "https://x.com/identity_source/status/991001", text: "caption", postedAt: new Date(), mediaType: "VIDEO" }], new Date());
    const post = await prisma.sourcePost.findUniqueOrThrow({ where: { platformPostId: "991001" } });
    const media = await prisma.mediaAsset.create({ data: { sourcePostId: post.id, filePath: "video.mp4", mimeType: "video/mp4", fileSize: 10, durationSeconds: 1, width: 1, height: 1, checksum: "identity-checksum" } });
    const review = await prisma.publishJob.create({ data: { sourcePostId: post.id, mediaAssetId: media.id, caption: "frozen caption", status: "READY_FOR_REVIEW" } });

    const targets = await new PublishRepository(prisma).approveTargets(review.id, [publisherA.id, publisherB.id], null, "frozen caption");
    expect(targets).toHaveLength(2);
    expect(await prisma.publishJob.findMany({ where: { sourcePostId: post.id }, select: { publisherIdentityId: true, status: true, caption: true }, orderBy: { publisherIdentityId: "asc" } })).toEqual(expect.arrayContaining([
      { publisherIdentityId: publisherA.id, status: "APPROVED", caption: "frozen caption" },
      { publisherIdentityId: publisherB.id, status: "APPROVED", caption: "frozen caption" },
    ]));
  });

  it("prevents a Publisher from claiming another identity's job", async () => {
    const identities = new BrowserIdentityRepository(prisma);
    const publisherA = await identities.create({ role: "PUBLISHER", label: "Publisher A", expectedUsername: "claim_a", browserId: "chrome", executablePath: "C:/chrome.exe", profileRoot: resolve("storage/browser-profiles") });
    const publisherB = await identities.create({ role: "PUBLISHER", label: "Publisher B", expectedUsername: "claim_b", browserId: "chrome", executablePath: "C:/chrome.exe", profileRoot: resolve("storage/browser-profiles") });
    const source = await new SourceAccountRepository(prisma).create({ username: "claim_source" });
    await new SourcePostRepository(prisma).persistNew(source.id, [{ platformPostId: "991002", sourceUrl: "https://x.com/claim_source/status/991002", text: "caption", postedAt: new Date(), mediaType: "VIDEO" }], new Date());
    const post = await prisma.sourcePost.findUniqueOrThrow({ where: { platformPostId: "991002" } });
    const media = await prisma.mediaAsset.create({ data: { sourcePostId: post.id, filePath: "video.mp4", mimeType: "video/mp4", fileSize: 10, durationSeconds: 1, width: 1, height: 1, checksum: "claim-checksum" } });
    const job = await prisma.publishJob.create({ data: { sourcePostId: post.id, mediaAssetId: media.id, publisherIdentityId: publisherA.id, caption: "caption", status: "APPROVED" } });
    await expect(new PublishRepository(prisma).claimById(job.id, new Date(), new Date(0), publisherB.id)).rejects.toThrow("different Publisher identity");
  });

  it("retains Collector provenance on posts and download jobs", async () => {
    const collector = await new BrowserIdentityRepository(prisma).create({ role: "COLLECTOR", label: "Collector", expectedUsername: "collector_owner", browserId: "msedge", executablePath: "C:/edge.exe", profileRoot: resolve("storage/browser-profiles") });
    const source = await new SourceAccountRepository(prisma).create({ username: "collector_source", collectorIdentityId: collector.id });
    await new SourcePostRepository(prisma).persistNew(source.id, [{ platformPostId: "991003", sourceUrl: "https://x.com/collector_source/status/991003", text: "caption", postedAt: new Date(), mediaType: "VIDEO" }], new Date(), collector.id);
    const post = await prisma.sourcePost.findUniqueOrThrow({ where: { platformPostId: "991003" }, include: { downloadJob: true } });
    expect(post.collectedByIdentityId).toBe(collector.id);
    expect(post.downloadJob?.collectorIdentityId).toBe(collector.id);
  });

  it("reclaims a username held by a deleted browser identity", async () => {
    const identities = new BrowserIdentityRepository(prisma);
    const deleted = await identities.create({ role: "COLLECTOR", label: "Deleted", expectedUsername: "reclaimed_user", browserId: "chromium", executablePath: "C:/chromium.exe", profileRoot: resolve("storage/browser-profiles") });
    await prisma.browserIdentity.update({ where: { id: deleted.id }, data: { enabled: false, profileDeletedAt: new Date() } });
    const current = await identities.create({ role: "COLLECTOR", label: "Current", browserId: "msedge", executablePath: "C:/edge.exe", profileRoot: resolve("storage/browser-profiles") });
    await identities.setVerification(current.id, "reclaimed_user", "fingerprint");
    expect(await identities.find(current.id)).toMatchObject({ expectedUsername: "reclaimed_user", verifiedUsername: "reclaimed_user" });
    expect(await identities.find(deleted.id)).toMatchObject({ expectedUsername: null, verifiedUsername: null });
  });

  it("assigns a source to a disabled Collector and unassigns it", async () => {
    const identities = new BrowserIdentityRepository(prisma);
    const collector = await identities.create({ role: "COLLECTOR", label: "Paused Collector", expectedUsername: "paused_col", browserId: "msedge", executablePath: "C:/edge.exe", profileRoot: resolve("storage/browser-profiles") });
    await identities.setEnabled(collector.id, false);
    const accounts = new SourceAccountRepository(prisma);
    const source = await accounts.create({ username: "reassign_source" });
    await accounts.update(source.id, { collectorIdentityId: collector.id });
    expect((await accounts.findById(source.id))?.collectorIdentityId).toBe(collector.id);
    await accounts.update(source.id, { collectorIdentityId: null });
    expect((await accounts.findById(source.id))?.collectorIdentityId).toBeNull();
  });

  it("detaches publish jobs when a Publisher identity is deleted", async () => {
    const identities = new BrowserIdentityRepository(prisma);
    const publisher = await identities.create({ role: "PUBLISHER", label: "Publisher Gone", expectedUsername: "publisher_gone", browserId: "chrome", executablePath: "C:/chrome.exe", profileRoot: resolve("storage/browser-profiles") });
    const source = await new SourceAccountRepository(prisma).create({ username: "detach_source" });
    await new SourcePostRepository(prisma).persistNew(source.id, [{ platformPostId: "991004", sourceUrl: "https://x.com/detach_source/status/991004", text: "caption", postedAt: new Date(), mediaType: "VIDEO" }], new Date());
    const post = await prisma.sourcePost.findUniqueOrThrow({ where: { platformPostId: "991004" } });
    const media = await prisma.mediaAsset.create({ data: { sourcePostId: post.id, filePath: "video.mp4", mimeType: "video/mp4", fileSize: 10, durationSeconds: 1, width: 1, height: 1, checksum: "detach-checksum" } });
    await prisma.publishJob.create({ data: { sourcePostId: post.id, mediaAssetId: media.id, publisherIdentityId: publisher.id, caption: "caption", status: "APPROVED" } });

    await prisma.$transaction([
      prisma.publishJob.updateMany({ where: { publisherIdentityId: publisher.id }, data: { publisherIdentityId: null } }),
      prisma.browserIdentity.delete({ where: { id: publisher.id } }),
    ]);
    const remaining = await prisma.publishJob.findFirstOrThrow({ where: { sourcePostId: post.id } });
    expect(remaining.publisherIdentityId).toBeNull();
    expect(await prisma.browserIdentity.findUnique({ where: { id: publisher.id } })).toBeNull();
  });
});

afterAll(async () => prisma.$disconnect());
