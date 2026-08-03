import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import pino, { type DestinationStream, type Logger } from "pino";

export type LoggerOptions = { directory: string; component: string; maxBytes?: number; retainedFiles?: number; level?: string };

class RotatingDestination implements DestinationStream {
  private size: number;
  private readonly path: string;

  constructor(directory: string, component: string, private readonly maxBytes: number, private readonly retainedFiles: number) {
    mkdirSync(directory, { recursive: true });
    this.path = resolve(directory, `${component}.log`);
    this.size = existsSync(this.path) ? statSync(this.path).size : 0;
  }

  private rotate(): void {
    for (let index = this.retainedFiles - 1; index >= 1; index -= 1) {
      const source = `${this.path}.${index}`;
      const destination = `${this.path}.${index + 1}`;
      if (existsSync(destination)) rmSync(destination, { force: true });
      if (existsSync(source)) renameSync(source, destination);
    }
    if (existsSync(`${this.path}.1`)) rmSync(`${this.path}.1`, { force: true });
    if (existsSync(this.path)) renameSync(this.path, `${this.path}.1`);
    this.size = 0;
  }

  write(message: string): void {
    const bytes = Buffer.byteLength(message);
    if (this.size > 0 && this.size + bytes > this.maxBytes) this.rotate();
    appendFileSync(this.path, message, { encoding: "utf8" });
    this.size += bytes;
  }
}

export function createLogger(options: LoggerOptions): Logger {
  const destination = new RotatingDestination(options.directory, options.component, options.maxBytes ?? 5_000_000, options.retainedFiles ?? 5);
  return pino({
    level: options.level ?? process.env.LOG_LEVEL ?? "info",
    base: { component: options.component },
    redact: {
      paths: ["cookie", "cookies", "token", "accessToken", "refreshToken", "authorization", "password", "headers.authorization", "*.cookie", "*.token"],
      censor: "[REDACTED]",
    },
  }, destination);
}
