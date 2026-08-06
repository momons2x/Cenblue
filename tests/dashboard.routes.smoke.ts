import { spawn, spawnSync, type ChildProcess } from "node:child_process";

const port = "3107";
const routes = ["/", "/sources", "/compose", "/review", "/queue", "/downloads", "/videos", "/published", "/logs", "/settings", "/api/health"];
let server: ChildProcess | undefined;

async function waitForServer(url: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Dashboard did not start at ${url}`);
}

try {
  server = spawn("cmd.exe", ["/d", "/s", "/c", `pnpm --filter @cenblu/dashboard start -p ${port}`], { cwd: process.cwd(), stdio: "ignore", windowsHide: true });
  await waitForServer(`http://127.0.0.1:${port}/`);
  for (const route of routes) {
    const response = await fetch(`http://127.0.0.1:${port}${route}`);
    if (!response.ok) throw new Error(`${route} returned HTTP ${response.status}`);
  }
  console.log(`Dashboard route smoke test passed: ${routes.length} routes responded successfully.`);
} finally {
  if (server?.pid) spawnSync("taskkill.exe", ["/pid", String(server.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
}
