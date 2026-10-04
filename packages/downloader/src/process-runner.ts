import { spawn } from "node:child_process";

export type ProcessResult = { stdout: string; stdoutBytes?: Buffer; stderr: string };

export class ProcessExecutionError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly stderr: string) {
    super(message);
  }
}

export interface ProcessRunner {
  run(command: string, arguments_: string[], timeoutMs: number): Promise<ProcessResult>;
}

const FORCE_KILL_GRACE_MS = 5_000;
const STDIO_DRAIN_MS = 1_000;

export class NodeProcessRunner implements ProcessRunner {
  run(command: string, arguments_: string[], timeoutMs: number): Promise<ProcessResult> {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(command, arguments_, { windowsHide: true });
      const stdout: Buffer[] = [];
      let stderr = "";
      let settled = false;
      let timedOut = false;
      let exitCode: number | null | undefined;
      let exitSignal: NodeJS.Signals | null | undefined;
      let timeoutTimer: NodeJS.Timeout | undefined;
      let killTimer: NodeJS.Timeout | undefined;
      let drainTimer: NodeJS.Timeout | undefined;

      const clearTimers = (): void => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (killTimer) clearTimeout(killTimer);
        if (drainTimer) clearTimeout(drainTimer);
      };

      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimers();
        if (timedOut) {
          reject(new ProcessExecutionError(`${command} timed out after ${timeoutMs}ms`, true, stderr.slice(-4_000)));
          return;
        }
        if (exitCode === 0) {
          const stdoutBytes = Buffer.concat(stdout);
          resolvePromise({ stdout: stdoutBytes.toString(), stdoutBytes, stderr });
          return;
        }
        reject(new ProcessExecutionError(`${command} exited with ${exitCode ?? exitSignal ?? "unknown"}`, true, stderr.slice(-4_000)));
      };

      const fail = (message: string, retryable: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimers();
        reject(new ProcessExecutionError(message, retryable, stderr.slice(-4_000)));
      };

      const forceKill = (): void => {
        if (child.pid === undefined) return;
        try {
          const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
          killer.on("error", () => undefined);
        } catch {
          // The process is already gone.
        }
      };

      if (timeoutMs > 0) {
        timeoutTimer = setTimeout(() => {
          timedOut = true;
          try { child.kill(); } catch { /* Already gone. */ }
          killTimer = setTimeout(forceKill, FORCE_KILL_GRACE_MS);
        }, timeoutMs);
      }

      child.stdout.on("data", (data: Buffer) => { stdout.push(data); });
      child.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

      child.on("error", (error) => { fail(`Could not start ${command}: ${error.message}`, false); });

      // Settling on `exit` rather than `close` matters: a grandchild such as ffmpeg
      // can inherit stdio and keep the pipes open forever after the parent exited,
      // which would leave the download job claimed with no result to persist.
      child.on("exit", (code, signal) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        exitCode = code;
        exitSignal = signal;
        drainTimer = setTimeout(finish, STDIO_DRAIN_MS);
      });

      child.on("close", () => finish());
    });
  }
}
