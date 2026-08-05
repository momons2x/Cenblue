import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { chromium } from "playwright";
import type { BrowserId } from "@cenblu/config";

export type BrowserInstallation = {
  id: BrowserId;
  name: string;
  executablePath: string;
};

const names: Record<BrowserId, string> = {
  msedge: "Microsoft Edge",
  chrome: "Google Chrome",
  brave: "Brave",
  chromium: "Chromium",
  vivaldi: "Vivaldi",
  opera: "Opera",
  custom: "Custom Chromium browser",
};

function windowsCandidates(): Array<Omit<BrowserInstallation, "executablePath"> & { paths: Array<string | undefined> }> {
  const local = process.env.LOCALAPPDATA;
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env["ProgramFiles(x86)"];
  return [
    { id: "msedge", name: names.msedge, paths: [local && `${local}/Microsoft/Edge/Application/msedge.exe`, programFiles && `${programFiles}/Microsoft/Edge/Application/msedge.exe`, programFilesX86 && `${programFilesX86}/Microsoft/Edge/Application/msedge.exe`] },
    { id: "chrome", name: names.chrome, paths: [local && `${local}/Google/Chrome/Application/chrome.exe`, programFiles && `${programFiles}/Google/Chrome/Application/chrome.exe`, programFilesX86 && `${programFilesX86}/Google/Chrome/Application/chrome.exe`] },
    { id: "brave", name: names.brave, paths: [local && `${local}/BraveSoftware/Brave-Browser/Application/brave.exe`, programFiles && `${programFiles}/BraveSoftware/Brave-Browser/Application/brave.exe`, programFilesX86 && `${programFilesX86}/BraveSoftware/Brave-Browser/Application/brave.exe`] },
    { id: "chromium", name: names.chromium, paths: [local && `${local}/Chromium/Application/chrome.exe`, programFiles && `${programFiles}/Chromium/Application/chrome.exe`, programFilesX86 && `${programFilesX86}/Chromium/Application/chrome.exe`] },
    { id: "vivaldi", name: names.vivaldi, paths: [local && `${local}/Vivaldi/Application/vivaldi.exe`, programFiles && `${programFiles}/Vivaldi/Application/vivaldi.exe`] },
    { id: "opera", name: names.opera, paths: [local && `${local}/Programs/Opera/launcher.exe`, local && `${local}/Programs/Opera GX/launcher.exe`] },
  ];
}

export function browserName(id: BrowserId): string {
  return names[id];
}

export async function discoverInstalledChromiumBrowsers(): Promise<BrowserInstallation[]> {
  if (process.platform !== "win32") return [];
  const installations: BrowserInstallation[] = [];
  for (const candidate of windowsCandidates()) {
    const executablePath = candidate.paths.filter((path): path is string => Boolean(path)).find(existsSync);
    if (executablePath) installations.push({ id: candidate.id, name: candidate.name, executablePath: resolve(executablePath) });
  }
  return installations;
}

export async function validateChromiumExecutable(executablePath: string): Promise<string> {
  const path = resolve(executablePath.trim().replace(/^"|"$/g, ""));
  const metadata = await stat(path).catch(() => null);
  if (!metadata?.isFile() || (process.platform === "win32" && !basename(path).toLowerCase().endsWith(".exe"))) throw new Error("Choose an existing Chromium browser executable.");
  const browser = await chromium.launch({ executablePath: path, headless: true, timeout: 20_000 }).catch((error) => {
    throw new Error(`The selected executable could not be controlled by Playwright: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  });
  await browser.close();
  return path;
}

export async function openChromiumProfile(executablePath: string, userDataDirectory: string, profileDirectory?: string, url = "https://x.com/login"): Promise<void> {
  if (process.platform !== "win32") throw new Error("Dashboard browser setup is currently supported on Windows only.");
  const executable = await validateChromiumExecutable(executablePath);
  const child = spawn(executable, [
    `--user-data-dir=${resolve(userDataDirectory)}`,
    ...(profileDirectory ? [`--profile-directory=${profileDirectory}`] : []),
    url,
  ], { detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
}
