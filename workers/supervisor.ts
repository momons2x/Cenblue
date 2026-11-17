import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const pidPath = resolve(root, "storage/temp/supervisor.pid");
const production = process.env.CENBLU_PROD === "1";
const healthUrl = "http://127.0.0.1:3000/api/health";

const MAX_RESTARTS = 3;
const RESTART_DELAYS_MS = [5_000, 15_000, 60_000];
const HEALTHY_UPTIME_MS = 5 * 60_000;

type ChildName = "dashboard" | "pipeline";
type ManagedChild = {
  name: ChildName;
  script: string;
  child: ChildProcess | null;
  restarts: number;
  lastStartedAt: number;
};

const children: ManagedChild[] = [
  { name: "dashboard", script: production ? "start" : "dev", child: null, restarts: 0, lastStartedAt: 0 },
  { name: "pipeline", script: "pipeline", child: null, restarts: 0, lastStartedAt: 0 },
];

let shuttingDown = false;

function log(name: ChildName | "supervisor", message: string): void {
  process.stdout.write(`[${name}] ${message}\n`);
}

function pipeOutput(name: ChildName, child: ChildProcess): void {
  const attach = (stream: NodeJS.ReadableStream | null, target: NodeJS.WritableStream) => {
    if (!stream) return;
    let buffer = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) target.write(`[${name}] ${line}\n`);
    });
    stream.on("end", () => {
      if (buffer) target.write(`[${name}] ${buffer}\n`);
      buffer = "";
    });
  };
  attach(child.stdout, process.stdout);
  attach(child.stderr, process.stderr);
}

function killTree(pid: number): void {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
  }
}

function startChild(entry: ManagedChild): void {
  if (shuttingDown) return;
  entry.lastStartedAt = Date.now();
  log("supervisor", `starting ${entry.name} (pnpm ${entry.script})`);
  const child = process.platform === "win32"
    ? spawn("cmd.exe", ["/d", "/s", "/c", `pnpm ${entry.script}`], { cwd: root, env: process.env, windowsHide: true })
    : spawn("pnpm", [entry.script], { cwd: root, env: process.env, detached: true });
  entry.child = child;
  pipeOutput(entry.name, child);
  child.on("error", (error) => {
    log(entry.name, `failed to start: ${error.message}`);
    handleExit(entry, child);
  });
  child.on("exit", (code, signal) => {
    log(entry.name, `exited (code=${code ?? "unknown"}, signal=${signal ?? "none"})`);
    handleExit(entry, child);
  });
}

function handleExit(entry: ManagedChild, child: ChildProcess): void {
  if (entry.child !== child) return;
  entry.child = null;
  if (shuttingDown) return;
  if (Date.now() - entry.lastStartedAt >= HEALTHY_UPTIME_MS) entry.restarts = 0;
  if (entry.restarts >= MAX_RESTARTS) {
    log("supervisor", `${entry.name} failed ${MAX_RESTARTS} times in a row; shutting everything down`);
    void shutdown(1);
    return;
  }
  const delay = RESTART_DELAYS_MS[entry.restarts] ?? RESTART_DELAYS_MS[RESTART_DELAYS_MS.length - 1];
  entry.restarts += 1;
  log("supervisor", `restarting ${entry.name} in ${delay / 1_000}s (attempt ${entry.restarts} of ${MAX_RESTARTS})`);
  setTimeout(() => startChild(entry), delay);
}

async function waitForDashboard(timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !shuttingDown) {
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(3_000) });
      if (response.ok) {
        log("supervisor", `dashboard ready at ${healthUrl.replace("/api/health", "")}`);
        return;
      }
    } catch {
      // Not listening yet; keep polling.
    }
    await new Promise((done) => setTimeout(done, 2_000));
  }
  if (!shuttingDown) log("supervisor", "dashboard did not report healthy within 120s");
}

function shutdown(exitCode: number): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log("supervisor", "stopping dashboard and pipeline…");
  for (const entry of children) {
    if (entry.child?.pid) killTree(entry.child.pid);
    entry.child = null;
  }
  try { rmSync(pidPath, { force: true }); } catch { /* best effort */ }
  setTimeout(() => process.exit(exitCode), 2_000);
}

function main(): void {
  mkdirSync(resolve(root, "storage/temp"), { recursive: true });
  writeFileSync(pidPath, String(process.pid));
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
  log("supervisor", `starting in ${production ? "production" : "development"} mode (dashboard + pipeline)`);
  for (const entry of children) startChild(entry);
  void waitForDashboard();
}

main();
