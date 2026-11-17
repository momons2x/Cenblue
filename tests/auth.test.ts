import { describe, expect, it } from "vitest";
import { AUTH_MAX_AGE_MS, authPassword, checkPassword, issueAuthValue, LoginRateLimiter, safeNext, verifyAuthValue } from "../apps/dashboard/app/lib/auth";

const password = "correct-horse";
const now = Date.parse("2026-08-04T19:10:00.000Z");

describe("auth cookie values", () => {
  it("round-trips a fresh cookie", async () => {
    const value = await issueAuthValue(now, password);
    expect(await verifyAuthValue(value, password, now + 1_000)).toBe(Math.floor(now));
  });

  it("rejects tampered timestamps and signatures", async () => {
    const value = await issueAuthValue(now, password);
    const [, issuedAt, signature] = value.split(".");
    expect(await verifyAuthValue(`v1.${Number(issuedAt) + 60_000}.${signature}`, password, now + 1_000)).toBeNull();
    expect(await verifyAuthValue(`v1.${issuedAt}.${"0".repeat(64)}`, password, now + 1_000)).toBeNull();
    expect(await verifyAuthValue(`${value}x`, password, now + 1_000)).toBeNull();
    expect(await verifyAuthValue(`v1.${issuedAt}`, password, now + 1_000)).toBeNull();
  });

  it("rejects a cookie signed with a different password", async () => {
    expect(await verifyAuthValue(await issueAuthValue(now, "other-password"), password, now + 1_000)).toBeNull();
  });

  it("rejects expired and future cookies", async () => {
    const value = await issueAuthValue(now, password);
    expect(await verifyAuthValue(value, password, now + AUTH_MAX_AGE_MS + 1)).toBeNull();
    expect(await verifyAuthValue(value, password, now - 120_000)).toBeNull();
  });

  it("returns null without a password or value", async () => {
    expect(await verifyAuthValue(undefined, password, now)).toBeNull();
    expect(await verifyAuthValue(await issueAuthValue(now, password), null, now)).toBeNull();
  });
});

describe("authPassword", () => {
  it("reads DASHBOARD_PASSWORD and treats empty as disabled", () => {
    expect(authPassword({ DASHBOARD_PASSWORD: "secret" } as NodeJS.ProcessEnv)).toBe("secret");
    expect(authPassword({} as NodeJS.ProcessEnv)).toBeNull();
    expect(authPassword({ DASHBOARD_PASSWORD: "" } as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe("checkPassword", () => {
  it("matches the configured password only", async () => {
    expect(await checkPassword("secret", "secret")).toBe(true);
    expect(await checkPassword("secret", "different")).toBe(false);
    expect(await checkPassword("secret", null)).toBe(false);
  });
});

describe("safeNext", () => {
  it("keeps local paths and rejects open redirects", () => {
    expect(safeNext("/queue")).toBe("/queue");
    expect(safeNext("/queue?status=FAILED")).toBe("/queue?status=FAILED");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("queue")).toBe("/");
    expect(safeNext(null)).toBe("/");
    expect(safeNext("")).toBe("/");
  });
});

describe("LoginRateLimiter", () => {
  it("locks after repeated failures within the window", () => {
    const limiter = new LoginRateLimiter(3, 60_000);
    expect(limiter.verdict("ip", now).ok).toBe(true);
    limiter.failure("ip", now);
    limiter.failure("ip", now + 1_000);
    expect(limiter.verdict("ip", now + 2_000).ok).toBe(true);
    limiter.failure("ip", now + 2_000);
    const locked = limiter.verdict("ip", now + 3_000);
    expect(locked.ok).toBe(false);
    if (!locked.ok) expect(locked.retryAfterMs).toBeGreaterThan(0);
    expect(limiter.verdict("ip", now + 61_000).ok).toBe(true);
  });

  it("clears failures after a successful sign-in", () => {
    const limiter = new LoginRateLimiter(2, 60_000);
    limiter.failure("ip", now);
    limiter.failure("ip", now + 1_000);
    expect(limiter.verdict("ip", now + 2_000).ok).toBe(false);
    limiter.success("ip");
    expect(limiter.verdict("ip", now + 3_000).ok).toBe(true);
  });

  it("tracks keys independently", () => {
    const limiter = new LoginRateLimiter(1, 60_000);
    limiter.failure("a", now);
    expect(limiter.verdict("a", now + 1).ok).toBe(false);
    expect(limiter.verdict("b", now + 1).ok).toBe(true);
  });
});
