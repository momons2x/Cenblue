export const AUTH_COOKIE = "cenblu_auth";
export const AUTH_MAX_AGE_MS = 12 * 60 * 60 * 1000;
export const AUTH_MAX_AGE_SECONDS = AUTH_MAX_AGE_MS / 1000;
export const REAUTH_WINDOW_MS = 15 * 60 * 1000;

const encoder = new TextEncoder();

export function authPassword(environment: NodeJS.ProcessEnv = process.env): string | null {
  const value = environment.DASHBOARD_PASSWORD;
  return value && value.length > 0 ? value : null;
}

function timingSafeEqualHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
}

async function hmacHex(password: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function issueAuthValue(now: number, password: string): Promise<string> {
  const issuedAt = Math.floor(now);
  return `v1.${issuedAt}.${await hmacHex(password, `v1.${issuedAt}`)}`;
}

export async function verifyAuthValue(value: string | undefined | null, password: string | null, now = Date.now()): Promise<number | null> {
  if (!password || !value) return null;
  const match = /^v1\.(\d+)\.([0-9a-f]{64})$/.exec(value);
  if (!match) return null;
  const issuedAt = Number(match[1]);
  if (!Number.isSafeInteger(issuedAt) || issuedAt > now + 60_000 || now - issuedAt > AUTH_MAX_AGE_MS) return null;
  return timingSafeEqualHex(await hmacHex(password, `v1.${issuedAt}`), match[2]) ? issuedAt : null;
}

export async function checkPassword(input: string, password: string | null): Promise<boolean> {
  if (!password) return false;
  const [left, right] = await Promise.all([sha256Hex(input), sha256Hex(password)]);
  return timingSafeEqualHex(left, right);
}

export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}

export type LoginRateVerdict = { ok: true } | { ok: false; retryAfterMs: number };

export class LoginRateLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(private readonly maxAttempts = 5, private readonly windowMs = 15 * 60_000) {}

  verdict(key: string, now = Date.now()): LoginRateVerdict {
    const recent = (this.failures.get(key) ?? []).filter((at) => now - at < this.windowMs);
    if (recent.length >= this.maxAttempts) return { ok: false, retryAfterMs: recent[0] + this.windowMs - now };
    this.failures.set(key, recent);
    return { ok: true };
  }

  failure(key: string, now = Date.now()): void {
    const recent = (this.failures.get(key) ?? []).filter((at) => now - at < this.windowMs);
    recent.push(now);
    this.failures.set(key, recent);
  }

  success(key: string): void {
    this.failures.delete(key);
  }
}

export const loginRateLimiter = new LoginRateLimiter();
