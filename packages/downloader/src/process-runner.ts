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

export class NodeProcessRunner implements ProcessRunner {
  run(command: string, arguments_: string[], timeoutMs: number): Promise<ProcessResult> {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(command, arguments_, { windowsHide: true });
      const stdout: Buffer[] = [];
      let stderr = "";
      const timeout = setTimeout(() => child.kill(), timeoutMs);
      child.stdout.on("data", (data: Buffer) => { stdout.push(data); });
      child.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(new ProcessExecutionError(`Could not start ${command}: ${error.message}`, false, stderr));
      });
      child.on("close", (code, signal) => {
        clearTimeout(timeout);
        if (code === 0) {
          const stdoutBytes = Buffer.concat(stdout);
          return resolvePromise({ stdout: stdoutBytes.toString(), stdoutBytes, stderr });
        }
        reject(new ProcessExecutionError(`${command} exited with ${code ?? signal}`, true, stderr.slice(-4_000)));
      });
    });
  }
}
