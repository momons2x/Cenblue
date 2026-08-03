import { prisma, SettingsRepository, SourceAccountRepository } from "@cenblu/database";

try {
  await prisma.appSetting.deleteMany();
  await prisma.sourceAccount.deleteMany();
  const sources = new SourceAccountRepository(prisma);
  await sources.create({ username: "dashboard_smoke" });
  const settings = new SettingsRepository(prisma);
  await settings.setMany({ POSTS_PER_SOURCE: "7", PUBLISH_MODE: "ASSISTED" });
  const stored = await settings.getAll();
  const sourceCount = await prisma.sourceAccount.count({ where: { enabled: true } });
  if (stored.POSTS_PER_SOURCE !== "7" || stored.PUBLISH_MODE !== "ASSISTED" || sourceCount !== 1) throw new Error("Dashboard smoke test failed");
  console.log("Dashboard smoke test passed: source data and settings persist through SQLite.");
} finally { await prisma.$disconnect(); }
