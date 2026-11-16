import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@cenblu/database";
import { afterAll, describe, expect, it } from "vitest";

const databaseUrl = "file:../../../storage/temp/cenblu-fresh-install-test.db";
const databaseFile = resolve("storage/temp/cenblu-fresh-install-test.db");

function removeDatabaseFiles(): void {
  for (const suffix of ["", "-journal", "-shm", "-wal"]) rmSync(`${databaseFile}${suffix}`, { force: true });
}

function migrateDeploy(): void {
  const result = spawnSync("pnpm", ["exec", "prisma", "migrate", "deploy", "--schema", "packages/database/prisma/schema.prisma"], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: databaseUrl },
    shell: process.platform === "win32",
    windowsHide: true,
    timeout: 120_000,
  });
  if (result.status !== 0) throw new Error(`prisma migrate deploy exited with ${result.status}\n${result.stdout}\n${result.stderr}`);
}

describe("fresh install", () => {
  afterAll(removeDatabaseFiles);

  it("migrates to an empty BrowserIdentity table without placeholder identities", async () => {
    removeDatabaseFiles();
    migrateDeploy();
    const client = new PrismaClient({ datasourceUrl: databaseUrl });
    try {
      const identities = await client.browserIdentity.findMany({ select: { id: true, label: true, expectedUsername: true } });
      expect(identities).toEqual([]);
    } finally {
      await client.$disconnect();
    }
  }, 180_000);
});
