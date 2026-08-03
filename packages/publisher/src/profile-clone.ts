import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, stat } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const excludedNames = new Set([
  "Cache", "Code Cache", "GPUCache", "DawnCache", "GrShaderCache", "ShaderCache",
  "Crashpad", "BrowserMetrics", "DevToolsActivePort", "LOCK",
]);

function inside(directory: string, path: string): boolean {
  const value = relative(resolve(directory), resolve(path));
  return value !== "" && !value.startsWith("..") && !value.includes(":");
}

function includeProfileFile(path: string): boolean {
  const parts = resolve(path).split(sep);
  return !parts.some((part) => excludedNames.has(part) || part.startsWith("Singleton"))
    && !parts.join("/").includes("Service Worker/CacheStorage");
}

export async function assertEdgeClosed(): Promise<void> {
  if (process.platform !== "win32") return;
  try {
    await execFileAsync("powershell.exe", ["-NoProfile", "-Command", "if (Get-Process msedge -ErrorAction SilentlyContinue) { exit 2 }"], { windowsHide: true });
  } catch {
    throw new Error("Microsoft Edge is still running. Close all Edge windows and background processes before cloning the profile.");
  }
}

export async function cloneEdgeProfile(
  sourceUserDataDirectory: string,
  profileDirectory: string,
  destinationUserDataDirectory: string,
  ensureClosed: () => Promise<void> = assertEdgeClosed,
): Promise<void> {
  const sourceRoot = resolve(sourceUserDataDirectory);
  const sourceProfile = resolve(sourceRoot, profileDirectory);
  const destinationRoot = resolve(destinationUserDataDirectory);
  const destinationProfile = resolve(destinationRoot, profileDirectory);
  const repositoryRelative = relative(process.cwd(), destinationRoot);
  if (repositoryRelative.startsWith("..") || repositoryRelative.includes(":")) throw new Error("Cloned profile destination must be inside the repository");
  if (!inside(sourceRoot, sourceProfile) || basename(profileDirectory) !== profileDirectory) throw new Error("Invalid Edge profile directory");
  await stat(resolve(sourceRoot, "Local State"));
  await stat(sourceProfile);
  try {
    await stat(destinationProfile);
    throw new Error(`Clone destination already exists: ${destinationProfile}. Remove it manually before creating a fresh clone.`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Clone destination already exists")) throw error;
  }
  await ensureClosed();
  await mkdir(destinationRoot, { recursive: true });
  await cp(resolve(sourceRoot, "Local State"), resolve(destinationRoot, "Local State"), { errorOnExist: true });
  await cp(sourceProfile, destinationProfile, { recursive: true, errorOnExist: true, filter: includeProfileFile });
}

export async function openEdgeProfile(userDataDirectory: string, profileDirectory: string): Promise<void> {
  if (process.platform !== "win32") throw new Error("Normal Edge profile setup is currently supported on Windows only");
  await assertEdgeClosed();
  const candidates = [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ];
  const executable = candidates.find(existsSync);
  if (!executable) throw new Error("Microsoft Edge executable was not found");
  const child = spawn(executable, [
    `--user-data-dir=${resolve(userDataDirectory)}`,
    `--profile-directory=${profileDirectory}`,
    "https://x.com/home",
  ], { detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
}
