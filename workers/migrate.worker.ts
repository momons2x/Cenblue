import { stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { loadConfig } from "@cenblu/config";
import { prisma } from "@cenblu/database";
import { StorageMaintenance } from "@cenblu/operations";

function databaseFilePath(databaseUrl: string, repositoryRoot: string): string | null {
  if (!databaseUrl.startsWith("file:")) return null;
  const relative = databaseUrl.slice("file:".length);
  return resolve(repositoryRoot, "packages", "database", "prisma", relative);
}

async function existsNonEmpty(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile() && info.size > 0;
  } catch { return false; }
}

function run(command: string, arguments_: string[], cwd: string): Promise<void> {
  const shellArguments = process.platform === "win32"
    ? arguments_.map((argument) => argument.includes(" ") ? `"${argument}"` : argument)
    : arguments_;
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, shellArguments, { cwd, stdio: "inherit", windowsHide: true, shell: process.platform === "win32" });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolvePromise() : reject(new Error(`${command} exited with code ${code}`)));
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const databasePath = databaseFilePath(config.databaseUrl, config.repositoryRoot);
  let snapshot: string | null = null;
  if (databasePath && await existsNonEmpty(databasePath)) {
    snapshot = await new StorageMaintenance(prisma).backup(config.backupStoragePath);
    console.log(`Pre-migration backup created: ${snapshot}`);
  } else {
    console.log("No existing database to back up before migration.");
  }
  const schema = resolve(config.repositoryRoot, "packages", "database", "prisma", "schema.prisma");
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  try {
    await run(pnpm, ["exec", "prisma", "migrate", "deploy", "--schema", schema], config.repositoryRoot);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }
  if (snapshot) console.log(`Migrations applied. Backup retained at ${snapshot}`);
}

main().finally(async () => prisma.$disconnect());
