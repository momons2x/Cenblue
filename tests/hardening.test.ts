import { readdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { applyStoredSettings, browserBindingFingerprint, loadConfig } from "@cenblu/config";
import { withDatabaseRetry } from "@cenblu/database";
import { createLogger } from "@cenblu/shared/logger";

describe("hardening", () => {
  const root = resolve(".");
  it("retries transient SQLite failures with bounded attempts", async () => {
    let attempts = 0;
    const result = await withDatabaseRetry(async () => {
      attempts += 1;
      if (attempts < 3) throw Object.assign(new Error("database is locked"), { code: "P1008" });
      return "ok";
    });
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  it("rejects storage paths outside the repository and validates persisted settings", () => {
    expect(() => loadConfig({ CENBLU_ROOT: root, DATABASE_URL: "file:test.db", LOG_STORAGE_PATH: "../outside" })).toThrow("inside the repository");
    const config = loadConfig({ CENBLU_ROOT: root, DATABASE_URL: "file:test.db" });
    expect(applyStoredSettings(config, { PUBLISH_MODE: "AUTOMATIC", DOWNLOAD_CONCURRENCY: "2", DOWNLOAD_BATCH_LIMIT: "20" })).toMatchObject({ publishMode: "AUTOMATIC", downloadConcurrency: 2, downloadBatchLimit: 20 });
    expect(applyStoredSettings(config, { VIDEO_STORAGE_PATH: "C:/untrusted/videos" }).videoStoragePath).toBe(config.videoStoragePath);
    expect(() => applyStoredSettings(config, { DOWNLOAD_CONCURRENCY: "20" })).toThrow();
    expect(() => applyStoredSettings(config, { DOWNLOAD_BATCH_LIMIT: "0" })).toThrow();
    expect(() => loadConfig({ CENBLU_ROOT: root, DATABASE_URL: "file:test.db", APP_TIMEZONE: "Not/A-Timezone" })).toThrow("IANA timezone");
  });

  it("requires explicit opt-in before using an external browser profile", () => {
    const externalProfile = "C:/Users/user/AppData/Local/Microsoft/Edge/User Data";
    expect(() => loadConfig({ CENBLU_ROOT: root, DATABASE_URL: "file:test.db", PLAYWRIGHT_PROFILE_PATH: externalProfile, PLAYWRIGHT_BROWSER_CHANNEL: "msedge", PLAYWRIGHT_PROFILE_DIRECTORY: "Profile 1" })).toThrow("inside the repository");
    expect(loadConfig({ CENBLU_ROOT: root, DATABASE_URL: "file:test.db", PLAYWRIGHT_PROFILE_PATH: externalProfile, PLAYWRIGHT_BROWSER_CHANNEL: "msedge", PLAYWRIGHT_PROFILE_DIRECTORY: "Profile 1", PLAYWRIGHT_ALLOW_EXTERNAL_PROFILE: "true" })).toMatchObject({
      playwrightBrowserChannel: "msedge",
      playwrightProfileDirectory: "Profile 1",
      playwrightAllowExternalProfile: true,
    });
  });

  it("keeps collector and publisher browser profiles isolated", () => {
    const config = loadConfig({ CENBLU_ROOT: root, DATABASE_URL: "file:test.db", PLAYWRIGHT_PROFILE_PATH: "./storage/browser-profile-collector", PUBLISHER_PROFILE_PATH: "./storage/browser-profile-publisher" });
    expect(config.playwrightProfilePath).toBe(resolve(root, "storage/browser-profile-collector"));
    expect(config.publisherProfilePath).toBe(resolve(root, "storage/browser-profile-publisher"));
    expect(config.publisherProfilePath).not.toBe(config.playwrightProfilePath);
    expect(() => loadConfig({ CENBLU_ROOT: root, DATABASE_URL: "file:test.db", PLAYWRIGHT_PROFILE_PATH: "./storage/same-profile", PUBLISHER_PROFILE_PATH: "./storage/same-profile" })).toThrow("must use different directories");
  });

  it("applies independent device browser bindings to managed profiles", () => {
    const base = loadConfig({ CENBLU_ROOT: root, DATABASE_URL: "file:test.db" });
    const config = applyStoredSettings(base, {
      DEVICE_COLLECTOR_BROWSER_ID: "brave",
      DEVICE_COLLECTOR_BROWSER_EXECUTABLE: "C:/Browsers/Brave/brave.exe",
      DEVICE_PUBLISHER_BROWSER_ID: "chrome",
      DEVICE_PUBLISHER_BROWSER_EXECUTABLE: "C:/Browsers/Chrome/chrome.exe",
    });
    expect(config).toMatchObject({ collectorBrowserId: "brave", publisherBrowserId: "chrome" });
    expect(config.playwrightProfilePath).toBe(resolve(root, "storage/browser-profiles/collector/brave"));
    expect(config.publisherProfilePath).toBe(resolve(root, "storage/browser-profiles/publisher/chrome"));
    expect(browserBindingFingerprint(config, "collector")).toContain("brave.exe");
    expect(browserBindingFingerprint(config, "publisher")).not.toBe(browserBindingFingerprint(config, "collector"));
  });

  it("rejects unknown device browser identifiers", () => {
    const config = loadConfig({ CENBLU_ROOT: root, DATABASE_URL: "file:test.db" });
    expect(() => applyStoredSettings(config, { DEVICE_COLLECTOR_BROWSER_ID: "firefox" })).toThrow();
  });

  it("applies repository path protection to the publisher profile", () => {
    const externalProfile = "C:/Users/user/AppData/Local/Microsoft/Edge/Publisher";
    expect(() => loadConfig({ CENBLU_ROOT: root, DATABASE_URL: "file:test.db", PUBLISHER_PROFILE_PATH: externalProfile })).toThrow("inside the repository");
  });

  it("rejects the bundled Chromium browser channel", () => {
    expect(() => loadConfig({ CENBLU_ROOT: root, DATABASE_URL: "file:test.db", PLAYWRIGHT_BROWSER_CHANNEL: "chromium" })).toThrow();
  });

  it("resolves relative storage paths from CENBLU_ROOT rather than process.cwd", () => {
    const config = loadConfig({ CENBLU_ROOT: root, DATABASE_URL: "file:test.db", PLAYWRIGHT_PROFILE_PATH: "./storage/browser-profile-edge" });
    expect(config.playwrightProfilePath).toBe(resolve(root, "storage/browser-profile-edge"));
    expect(config.publisherProfilePath).toBe(resolve(root, "storage/browser-profile-publisher"));
    expect(config.logStoragePath).toBe(resolve(root, "storage/logs"));
  });

  it("rotates bounded structured logs and redacts secrets", async () => {
    const directory = resolve("storage/temp/hardening-log-test");
    await rm(directory, { recursive: true, force: true });
    const logger = createLogger({ directory, component: "test", maxBytes: 200, retainedFiles: 2 });
    for (let index = 0; index < 12; index += 1) logger.info({ operation: "test.log", token: "secret-token", index, content: "x".repeat(40) }, "test message");
    const files = (await readdir(directory)).filter((name) => name.startsWith("test.log"));
    expect(files.length).toBeLessThanOrEqual(3);
    const contents = await Promise.all(files.map((name) => readFile(resolve(directory, name), "utf8")));
    expect(contents.join("\n")).not.toContain("secret-token");
    expect(contents.join("\n")).toContain("[REDACTED]");
  });
});
