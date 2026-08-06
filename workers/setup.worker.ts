import { access, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const root = resolve(import.meta.dirname, "..");
const environmentPath = resolve(root, ".env");

function run(command: string, arguments_: string[], stdio: "ignore" | "inherit" = "inherit"): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, { cwd: root, stdio, windowsHide: stdio === "ignore" });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolvePromise() : reject(new Error(`${command} exited with code ${code}`)));
  });
}

async function available(command: string): Promise<boolean> {
  try { await run(command, ["--version"], "ignore"); return true; }
  catch { return false; }
}

function quote(value: string): string {
  return `"${value.replaceAll("\\", "/").replaceAll("\"", "\\\"")}"`;
}

async function main(): Promise<void> {
  const terminal = createInterface({ input, output });
  try {
    let existing = false;
    try { await access(environmentPath); existing = true; } catch { /* first setup */ }
    if (existing) {
      const answer = (await terminal.question(".env already exists. Replace it with guided setup values? [y/N] ")).trim().toLowerCase();
      if (answer !== "y" && answer !== "yes") {
        console.log("Setup cancelled without changing configuration.");
        return;
      }
    }

    const browserAnswer = (await terminal.question("Browser channel [msedge/chrome] (msedge): ")).trim().toLowerCase();
    const browser = browserAnswer === "chrome" ? "chrome" : "msedge";
    const timezone = (await terminal.question("Application timezone (Asia/Jakarta): ")).trim() || "Asia/Jakarta";
    try { new Intl.DateTimeFormat("en", { timeZone: timezone }); } catch { throw new Error(`Invalid IANA timezone: ${timezone}`); }
    const binaries: Record<string, string> = {};
    for (const binary of ["yt-dlp", "ffmpeg", "ffprobe"]) {
      if (await available(binary)) binaries[binary] = binary;
      else {
        const path = (await terminal.question(`${binary} was not found on PATH. Enter its executable path: `)).trim();
        if (!path || !await available(path)) throw new Error(`${binary} could not be executed from ${path || "the supplied path"}`);
        binaries[binary] = path;
      }
    }

    const directories = ["storage", "storage/videos", "storage/thumbnails", "storage/temp", "storage/logs", "storage/backups"];
    await Promise.all(directories.map((directory) => mkdir(resolve(root, directory), { recursive: true })));
    const environment = [
      `CENBLU_ROOT=${quote(root)}`,
      "DATABASE_URL=\"file:../../../storage/cenblu.db\"",
      `APP_TIMEZONE=${quote(timezone)}`,
      "PLAYWRIGHT_HEADLESS=false",
      `PLAYWRIGHT_BROWSER_CHANNEL=${quote(browser)}`,
      "PLAYWRIGHT_ALLOW_EXTERNAL_PROFILE=false",
      `YTDLP_BINARY=${quote(binaries["yt-dlp"])}`,
      `FFMPEG_BINARY=${quote(binaries.ffmpeg)}`,
      `FFPROBE_BINARY=${quote(binaries.ffprobe)}`,
      "",
    ].join("\n");
    const temporaryPath = `${environmentPath}.setup.part`;
    await rm(temporaryPath, { force: true });
    await writeFile(temporaryPath, environment, { encoding: "utf8", flag: "wx" });
    const previousPath = `${environmentPath}.previous`;
    if (existing) {
      await rm(previousPath, { force: true });
      await rename(environmentPath, previousPath);
    }
    try { await rename(temporaryPath, environmentPath); }
    catch (error) {
      if (existing) await rename(previousPath, environmentPath);
      throw error;
    }

    const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    await run(pnpm, ["db:migrate"]);
    console.log("Local configuration, storage, and database are ready.");
    console.log("Add Collector and Publisher identities and log into X from the dashboard:");
    console.log("  Settings → Isolated X identities");
    console.log("Setup complete. Start Cenblue with: pnpm dev");
  } finally {
    terminal.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
