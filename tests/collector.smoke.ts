import pino from "pino";
import { CollectionService, XPlaywrightCollector, type RawTimelinePost, type TimelineBrowser } from "@cenblu/collector";
import { prisma, SourceAccountRepository, SourcePostRepository } from "@cenblu/database";

const fixture: RawTimelinePost = {
  statusHref: "/cenblu_smoke/status/10001",
  text: "Collector smoke fixture",
  datetime: "2026-07-20T10:15:30.000Z",
  hasVideo: true,
  isReply: false,
  isRepost: false,
};

const browser: TimelineBrowser = {
  read: async () => [fixture],
};

const client = prisma;
const logger = pino({ level: "silent" });

try {
  await client.sourcePost.deleteMany();
  await client.sourceAccount.deleteMany();
  const accounts = new SourceAccountRepository(client);
  const posts = new SourcePostRepository(client);
  await accounts.create({ username: "cenblu_smoke" });
  const service = new CollectionService(accounts, posts, new XPlaywrightCollector(browser), logger, 3, 5);

  const firstRun = await service.runOnce();
  const secondRun = await service.runOnce();
  const persisted = await client.sourcePost.findMany();

  if (firstRun.postsInserted !== 1 || secondRun.duplicatesIgnored !== 1 || persisted.length !== 1) {
    throw new Error(`Smoke test failed: ${JSON.stringify({ firstRun, secondRun, persisted: persisted.length })}`);
  }

  console.log("Collector smoke test passed: one eligible post persisted and duplicate rerun ignored.");
} finally {
  await client.$disconnect();
}
