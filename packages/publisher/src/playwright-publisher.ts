import { mkdir, stat, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright";
import type { Logger } from "pino";
import type { BrowserId } from "@cenblu/config";
import { pruneDiagnosticFiles } from "@cenblu/shared/diagnostics";
import type { ExclusiveLease } from "@cenblu/shared/lease";
import { detectXUsername } from "@cenblu/shared/x-identity";
import { xPublisherSelectors } from "./selectors";
import { PublisherError, type Publisher, type PublishInput, type PublishResult } from "./types";

export type PlaywrightPublisherOptions = {
  repositoryRoot?: string;
  profileDirectory: string;
  browserId?: BrowserId;
  browserChannel?: "msedge" | "chrome";
  browserExecutablePath?: string;
  browserProfileDirectory?: string;
  allowExternalProfile?: boolean;
  lease: ExclusiveLease;
  diagnosticsDirectory: string;
  headless: boolean;
  operationTimeoutMs?: number;
  minUploadMbps?: number;
  maxUploadTimeoutMs?: number;
  uploadTimeoutMs?: number;
  expectedUsername?: string;
};

const minimumUploadTimeoutMs = 5 * 60_000;

export function calculateUploadTimeoutMs(fileSize: number, durationSeconds: number, minUploadMbps = 2, maxUploadTimeoutMs = 45 * 60_000): number {
  const uploadMs = fileSize * 8 / (minUploadMbps * 1_000_000) * 1_000;
  const processingMs = Math.min(10 * 60_000, Math.max(2 * 60_000, durationSeconds * 100));
  return Math.round(Math.min(maxUploadTimeoutMs, Math.max(minimumUploadTimeoutMs, uploadMs * 1.5 + processingMs)));
}

function configuredPath(path: string, label: string, allowExternal = false, repositoryRoot = process.cwd()): string {
  const resolved = resolve(path);
  const relativePath = relative(resolve(repositoryRoot), resolved);
  if (!allowExternal && (relativePath.startsWith("..") || relativePath.includes(":"))) throw new Error(`${label} must be inside the repository`);
  return resolved;
}

export function persistentContextOptions(options: PlaywrightPublisherOptions, headless = options.headless) {
  const browserId = options.browserId ?? options.browserChannel ?? "msedge";
  if (!options.browserExecutablePath && !["msedge", "chrome", "chromium"].includes(browserId)) throw new Error(`${browserId} requires a configured browser executable`);
  return {
    headless,
    timeout: options.operationTimeoutMs ?? 20_000,
    ...(options.browserExecutablePath ? { executablePath: options.browserExecutablePath } : { channel: browserId }),
    args: options.browserProfileDirectory ? [`--profile-directory=${options.browserProfileDirectory}`] : undefined,
  };
}

export function classifyBrowserLaunchError(error: unknown, browserName = "Browser"): PublisherError {
  const message = error instanceof Error ? error.message : String(error);
  if (/profile.*in use|user data directory is already in use|processsingleton|opening in existing browser session|cannot create a process singleton/i.test(message)) {
    return new PublisherError("PROFILE_IN_USE", `${browserName} profile is in use. Close its Cenblue profile window, then retry.`, false, true, { cause: error });
  }
  return new PublisherError("BROWSER_LAUNCH_FAILED", `Could not launch the configured browser profile: ${message}`, false, true, { cause: error });
}

export type PublishButtonState = { visible: boolean; disabled: boolean; ariaDisabled: string | null };

export function publishButtonReady(state: PublishButtonState): boolean {
  return state.visible && !state.disabled && state.ariaDisabled !== "true";
}

export function isPointerInterceptionError(error: unknown): boolean {
  return /intercepts pointer events/i.test(error instanceof Error ? error.message : String(error));
}

export function keyboardFallbackAllowed(error: unknown, state: PublishButtonState, attachmentVisible: boolean, alert: string | null): boolean {
  return isPointerInterceptionError(error) && publishButtonReady(state) && attachmentVisible && !alert;
}

function comparableCaption(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[\u200B\u200E\u200F\u2060\uFEFF]/gu, "")
    .replace(/\uFE0E|\uFE0F/gu, "")
    .replace(/[\u2028\u2029]/gu, "\n")
    .replace(/\s+/gu, " ")
    .trim();
}

export function captionsMatch(actual: string, expected: string): boolean {
  return comparableCaption(actual) === comparableCaption(expected);
}

export function selectVisiblePublishButton(dialog: Locator): Locator {
  return dialog.locator(xPublisherSelectors.publishButton).first();
}

function statusResult(href: string | null): PublishResult {
  if (!href) return { platformPostId: null, platformUrl: null };
  const url = new URL(href, "https://x.com");
  const match = /\/status\/(\d+)/.exec(url.pathname);
  return match ? { platformPostId: match[1], platformUrl: `https://x.com${url.pathname}` } : { platformPostId: null, platformUrl: null };
}

export class XPlaywrightPublisher implements Publisher {
  private readonly operationTimeoutMs: number;
  private readonly uploadTimeoutMs: number;
  private readonly profileDirectory: string;
  private readonly diagnosticsDirectory: string;

  constructor(private readonly options: PlaywrightPublisherOptions, private readonly logger: Logger) {
    this.operationTimeoutMs = options.operationTimeoutMs ?? 20_000;
    this.uploadTimeoutMs = options.uploadTimeoutMs ?? 0;
    this.profileDirectory = configuredPath(options.profileDirectory, "Browser profile path", options.allowExternalProfile, options.repositoryRoot);
    this.diagnosticsDirectory = configuredPath(options.diagnosticsDirectory, "Diagnostics path", false, options.repositoryRoot);
  }

  private async context(headless = this.options.headless): Promise<BrowserContext> {
    if (this.options.browserProfileDirectory) {
      await stat(resolve(this.profileDirectory, "Local State")).catch(() => { throw new PublisherError("BROWSER_LAUNCH_FAILED", `Publisher browser Local State is missing from ${this.profileDirectory}`, false, true); });
      await stat(resolve(this.profileDirectory, this.options.browserProfileDirectory)).catch(() => { throw new PublisherError("BROWSER_LAUNCH_FAILED", `Publisher browser profile ${this.options.browserProfileDirectory} is missing from ${this.profileDirectory}`, false, true); });
    } else if (!this.options.allowExternalProfile) await mkdir(this.profileDirectory, { recursive: true });
    const browserId = this.options.browserId ?? this.options.browserChannel ?? "msedge";
    this.logger.info({ operation: "publisher.browser.launch.start", browserId, profileDirectory: this.profileDirectory, browserProfileDirectory: this.options.browserProfileDirectory ?? null }, "Launching publisher browser profile");
    try {
      const context = await chromium.launchPersistentContext(this.profileDirectory, persistentContextOptions(this.options, headless));
      this.logger.info({ operation: "publisher.browser.launch.complete", browserId }, "Publisher browser profile launched");
      return context;
    }
    catch (error) { throw classifyBrowserLaunchError(error, browserId); }
  }

  private async assertLoggedIn(page: Page, navigateToProfile = false): Promise<string | null> {
    await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: this.operationTimeoutMs });
    const accountMenu = page.locator(xPublisherSelectors.accountMenuButton).first();
    await Promise.race([
      accountMenu.waitFor({ state: "visible", timeout: this.operationTimeoutMs }),
      page.locator(xPublisherSelectors.loginLink).first().waitFor({ state: "visible", timeout: this.operationTimeoutMs }),
    ]).catch(() => undefined);
    const intervention = page.getByText(/verify your identity|your account is locked|account suspended|unusual activity|complete (the )?captcha|security challenge/i).first();
    if (await intervention.isVisible().catch(() => false)) {
      throw new PublisherError("ACCOUNT_INTERVENTION", "Publisher account requires manual intervention", false, true);
    }
    if (!await accountMenu.isVisible().catch(() => false)) {
      throw new PublisherError("NOT_LOGGED_IN", "Publisher browser profile is not logged in", false, true);
    }
    const activeUsername = await detectXUsername(page, xPublisherSelectors.accountMenuButton, navigateToProfile);
    if (this.options.expectedUsername) {
      if (!activeUsername || activeUsername !== this.options.expectedUsername.toLowerCase()) throw new PublisherError("ACCOUNT_INTERVENTION", `Publisher identity mismatch. Expected @${this.options.expectedUsername}.`, false, true);
    }
    return activeUsername;
  }

  async checkSession(): Promise<string | null> {
    return this.options.lease.run(() => this.checkSessionWithProfile());
  }

  private async checkSessionWithProfile(): Promise<string | null> {
    this.logger.info({ operation: "publisher.session.check.start" }, "Checking publisher session without publishing");
    const context = await this.context(false);
    const page = context.pages()[0] ?? await context.newPage();
    try {
      const activeUsername = await this.assertLoggedIn(page, true);
      const account = activeUsername ? `@${activeUsername}` : null;
      this.logger.info({ operation: "publisher.session.check", browserId: this.options.browserId ?? this.options.browserChannel, browserProfileDirectory: this.options.browserProfileDirectory ?? null, account }, "Publisher session is authenticated");
      return account;
    } finally { await context.close().catch(() => undefined); }
  }

  private async diagnostic(page: Page, input: PublishInput, error: unknown, activationMethod: "none" | "mouse" | "keyboard"): Promise<void> {
    try {
      await mkdir(this.diagnosticsDirectory, { recursive: true });
      await pruneDiagnosticFiles(this.diagnosticsDirectory, "publisher-", 50);
      const prefix = `publisher-${input.platformPostId}-${Date.now()}`;
      const buttonStates = await page.locator(xPublisherSelectors.publishButtonAny).evaluateAll((buttons) => buttons.map((button) => {
        const element = button as HTMLButtonElement;
        const bounds = element.getBoundingClientRect();
        return { testId: element.getAttribute("data-testid"), visible: bounds.width > 0 && bounds.height > 0, disabled: element.disabled, ariaDisabled: element.getAttribute("aria-disabled"), text: element.textContent?.trim() ?? "" };
      })).catch(() => []);
      const cause = error instanceof Error && error.cause ? (error.cause instanceof Error ? error.cause.message : String(error.cause)) : null;
      await page.screenshot({ path: resolve(this.diagnosticsDirectory, `${prefix}.png`), fullPage: true, timeout: this.operationTimeoutMs });
      const attemptedActivation = activationMethod !== "none" ? activationMethod : error instanceof Error && error.message.startsWith("Keyboard submission fallback") ? "keyboard" : error instanceof Error && error.message.startsWith("Publish submission failed") ? "mouse" : "none";
      await writeFile(resolve(this.diagnosticsDirectory, `${prefix}.json`), JSON.stringify({
        operation: "publisher.publish", jobId: input.jobId, postId: input.platformPostId,
        pageUrl: page.url(), title: await page.title().catch(() => ""),
        error: error instanceof Error ? error.message : String(error),
        cause,
        activationMethod: attemptedActivation,
        buttonStates,
      }, null, 2));
    } catch (diagnosticError) {
      this.logger.error({ operation: "publisher.diagnostic.failed", jobId: input.jobId, postId: input.platformPostId, error: diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError) }, "Failed to save publisher diagnostics");
    }
  }

  private uploadTimeout(input: PublishInput): number {
    return this.uploadTimeoutMs || calculateUploadTimeoutMs(input.fileSize, input.durationSeconds, this.options.minUploadMbps, this.options.maxUploadTimeoutMs);
  }

  private assertActive(signal: AbortSignal): void {
    if (signal.aborted) throw new PublisherError("LEASE_LOST", "Publisher lost its job or browser lease while uploading", true, false, { cause: signal.reason });
  }

  private async waitForAttachment(page: Page, attachment: Locator, timeoutMs: number, signal: AbortSignal): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      this.assertActive(signal);
      const alert = (await page.locator(xPublisherSelectors.alert).last().textContent().catch(() => null))?.trim();
      if (alert) throw new PublisherError("UPLOAD_REJECTED", `X rejected the media: ${alert}`, false, true);
      if (await attachment.isVisible().catch(() => false)) return;
      await page.waitForTimeout(500);
    }
    throw new PublisherError("PROCESSING_TIMEOUT", "X did not attach the selected media before the adaptive upload deadline", true, false);
  }

  private async waitForPublishButton(page: Page, dialog: Locator, attachment: Locator | null, timeoutMs: number, signal: AbortSignal): Promise<Locator> {
    const button = selectVisiblePublishButton(dialog);
    const deadline = Date.now() + timeoutMs;
    let sawVisibleButton = false;
    let lastState: PublishButtonState = { visible: false, disabled: true, ariaDisabled: null };
    while (Date.now() < deadline) {
      this.assertActive(signal);
      const alert = (await page.locator(xPublisherSelectors.alert).last().textContent().catch(() => null))?.trim();
      if (alert) throw new PublisherError("UPLOAD_REJECTED", `X rejected the media: ${alert}`, false, true);
      if (attachment && !await attachment.isVisible().catch(() => false)) throw new PublisherError("UPLOAD_REJECTED", "The attached media disappeared while X was processing it", false, true);
      lastState = {
        visible: await button.isVisible().catch(() => false),
        disabled: await button.isDisabled().catch(() => true),
        ariaDisabled: await button.getAttribute("aria-disabled").catch(() => null),
      };
      sawVisibleButton ||= lastState.visible;
      if (publishButtonReady(lastState)) return button;
      await page.waitForTimeout(500);
    }
    if (!sawVisibleButton) throw new PublisherError("COMPOSER_SELECTOR", "The visible X Post button could not be located in the composer", true, false);
    throw new PublisherError("PROCESSING_TIMEOUT", `X kept the Post button disabled while processing the media (disabled=${lastState.disabled}, aria-disabled=${lastState.ariaDisabled ?? "unset"})`, true, false);
  }

  private async ensureCaption(composer: Locator, expected: string): Promise<void> {
    const current = await composer.innerText().catch(() => "");
    if (!captionsMatch(current, expected)) {
      await composer.fill(expected);
      await composer.page().waitForTimeout(250);
    }
    const verified = await composer.innerText().catch(() => "");
    if (!captionsMatch(verified, expected)) throw new PublisherError("INVALID_CAPTION", `Composer caption verification failed before submission (expected ${Array.from(expected).length} characters, found ${Array.from(verified).length})`, false, true);
  }

  private async activatePublishButton(page: Page, button: Locator, attachment: Locator | null): Promise<"mouse" | "keyboard"> {
    try {
      await button.click({ timeout: Math.min(this.operationTimeoutMs, 3_000) });
      return "mouse";
    } catch (error) {
      const alert = (await page.locator(xPublisherSelectors.alert).last().textContent().catch(() => null))?.trim() ?? null;
      const state: PublishButtonState = {
        visible: await button.isVisible().catch(() => false),
        disabled: await button.isDisabled().catch(() => true),
        ariaDisabled: await button.getAttribute("aria-disabled").catch(() => null),
      };
      const attachmentVisible = attachment ? await attachment.isVisible().catch(() => false) : true;
      if (!keyboardFallbackAllowed(error, state, attachmentVisible, alert)) {
        if (alert) throw new PublisherError("UPLOAD_REJECTED", `X rejected the media: ${alert}`, false, true, { cause: error });
        const detail = error instanceof Error ? error.message.split("\n")[0] : String(error);
        throw new PublisherError("SUBMISSION_FAILED", `Publish submission failed: ${detail}`, false, true, { cause: error });
      }
      const intervention = page.getByText(/verify your identity|your account is locked|account suspended|unusual activity|complete (the )?captcha|security challenge/i).first();
      if (await intervention.isVisible().catch(() => false)) throw new PublisherError("ACCOUNT_INTERVENTION", "Publisher account requires manual intervention", false, true, { cause: error });
      this.logger.warn({ operation: "publisher.submission.keyboard-fallback", blocker: "pointer-interception" }, "X modal backdrop blocked the Post button; activating the verified button with Enter");
      try {
        await button.focus({ timeout: this.operationTimeoutMs });
        await button.press("Enter", { timeout: this.operationTimeoutMs });
        return "keyboard";
      } catch (keyboardError) {
        const detail = keyboardError instanceof Error ? keyboardError.message.split("\n")[0] : String(keyboardError);
        throw new PublisherError("SUBMISSION_FAILED", `Keyboard submission fallback failed: ${detail}`, false, true, { cause: keyboardError });
      }
    }
  }

  async setupLogin(): Promise<void> {
    await this.options.lease.run(() => this.setupLoginWithProfile());
  }

  private async setupLoginWithProfile(): Promise<void> {
    const context = await this.context(false);
    const page = context.pages()[0] ?? await context.newPage();
    try {
      await page.goto("https://x.com/login", { waitUntil: "domcontentloaded", timeout: this.operationTimeoutMs });
      const terminal = createInterface({ input: process.stdin, output: process.stdout });
      await terminal.question("Complete login in the browser, then press Enter here to verify the session. ");
      terminal.close();
      await this.assertLoggedIn(page);
      this.logger.info({ operation: "publisher.login.complete" }, "Publisher browser profile is logged in");
    } finally { await context.close().catch(() => undefined); }
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    return this.options.lease.run((leaseSignal) => {
      const activeLeaseSignal = leaseSignal ?? new AbortController().signal;
      return this.publishWithProfile(input, input.signal ? AbortSignal.any([activeLeaseSignal, input.signal]) : activeLeaseSignal);
    });
  }

  private async publishWithProfile(input: PublishInput, signal: AbortSignal): Promise<PublishResult> {
    const context = await this.context();
    const page = context.pages()[0] ?? await context.newPage();
    page.setDefaultTimeout(this.operationTimeoutMs);
    let activationMethod: "none" | "mouse" | "keyboard" = "none";
    const uploadTimeoutMs = this.uploadTimeout(input);
    const startedAt = Date.now();
    try {
      this.logger.info({ operation: "publisher.upload.plan", jobId: input.jobId, postId: input.platformPostId, fileSize: input.fileSize, durationSeconds: input.durationSeconds, width: input.width, height: input.height, codec: input.codec, uploadTimeoutMs }, "Calculated adaptive upload deadline");
      this.assertActive(signal);
      await this.assertLoggedIn(page);
      await page.goto("https://x.com/compose/post", { waitUntil: "domcontentloaded", timeout: this.operationTimeoutMs });
      const composer = page.locator(xPublisherSelectors.composer).first();
      try { await composer.waitFor({ state: "visible", timeout: this.operationTimeoutMs }); }
      catch (error) { throw new PublisherError("COMPOSER_SELECTOR", "X composer could not be located", true, false, { cause: error }); }
      const dialog = page.locator(xPublisherSelectors.composerDialog).filter({ has: composer }).first();
      let attachment: Locator | null = null;
      if (input.mediaPath) {
        const mediaInput = dialog.locator(xPublisherSelectors.mediaInput).first();
        await input.reportProgress?.("UPLOADING");
        this.logger.info({ operation: "publisher.upload.started", jobId: input.jobId, postId: input.platformPostId, mediaKind: input.mediaKind, fileSize: input.fileSize, uploadTimeoutMs }, "Media upload started");
        await mediaInput.setInputFiles(input.mediaPath);
        attachment = dialog.locator(xPublisherSelectors.mediaAttachment).first();
        await this.waitForAttachment(page, attachment, uploadTimeoutMs, signal);
        await input.reportProgress?.("PROCESSING");
        this.logger.info({ operation: "publisher.processing.waiting", jobId: input.jobId, postId: input.platformPostId, elapsedMs: Date.now() - startedAt, uploadTimeoutMs }, "Waiting for X to enable submission");
        await page.waitForTimeout(500);
        if (!await attachment.isVisible().catch(() => false)) throw new PublisherError("UPLOAD_REJECTED", "The attached media disappeared before submission", false, true);
      }
      await this.ensureCaption(composer, input.caption);
      const remainingMs = Math.max(1_000, uploadTimeoutMs - (Date.now() - startedAt));
      const button = await this.waitForPublishButton(page, dialog, attachment, remainingMs, signal);
      await input.reportProgress?.("READY_TO_SUBMIT");
      await this.ensureCaption(composer, input.caption);
      await input.reportProgress?.("SUBMITTING");
      activationMethod = await this.activatePublishButton(page, button, attachment);
      this.logger.info({ operation: "publisher.submission.activated", activationMethod, jobId: input.jobId, postId: input.platformPostId, elapsedMs: Date.now() - startedAt }, "Post submission activated");
      await input.reportProgress?.("CONFIRMING");
      const toast = page.locator(xPublisherSelectors.toast).first();
      try {
        await Promise.race([
          toast.waitFor({ state: "visible", timeout: Math.min(uploadTimeoutMs, 5 * 60_000) }),
          dialog.waitFor({ state: "hidden", timeout: Math.min(uploadTimeoutMs, 5 * 60_000) }),
        ]);
      }
      catch (error) { throw new PublisherError("CONFIRMATION_FAILED", "Could not confirm whether X published the post", false, true, { cause: error }); }
      return statusResult(await toast.locator(xPublisherSelectors.statusLink).first().getAttribute("href").catch(() => null));
    } catch (error) {
      await this.diagnostic(page, input, error, activationMethod);
      if (signal.aborted) throw new PublisherError("LEASE_LOST", "Publisher lost its job or browser lease while uploading", true, false, { cause: signal.reason });
      if (error instanceof PublisherError) throw error;
      throw new PublisherError("COMPOSER_SELECTOR", "Unexpected Playwright publisher failure", true, false, { cause: error });
    } finally { await context.close().catch(() => undefined); }
  }
}
