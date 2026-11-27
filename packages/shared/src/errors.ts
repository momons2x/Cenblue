import { ZodError } from "zod";
import { ResourceBusyError } from "./lease";

export type AppErrorCode =
  | "VALIDATION"
  | "RESOURCE_BUSY"
  | "NOT_FOUND"
  | "IDENTITY_REQUIRED"
  | "IDENTITY_UNVERIFIED"
  | "MEDIA_MISSING"
  | "STALE_STATE"
  | "PUBLISH_BLOCKED"
  | "SESSION_EXPIRED"
  | "INTERNAL";

const USER_MESSAGES: Record<AppErrorCode, string> = {
  VALIDATION: "Check the details you entered and try again.",
  RESOURCE_BUSY: "The browser is busy with another operation. Wait for it to finish, then try again.",
  NOT_FOUND: "That item no longer exists. Refresh the page and try again.",
  IDENTITY_REQUIRED: "Choose an enabled identity before continuing.",
  IDENTITY_UNVERIFIED: "Verify the selected identity under Settings before using it.",
  MEDIA_MISSING: "The local media file for this item is missing.",
  STALE_STATE: "This item changed while you were working on it. Refresh the page and try again.",
  PUBLISH_BLOCKED: "This job cannot be published yet. Check the Queue for the blocking condition.",
  SESSION_EXPIRED: "The browser session is no longer signed in to X. Open the profile from Settings, sign in, then try again.",
  INTERNAL: "Something went wrong while handling that request. Check the Logs page for details.",
};

const PUBLISHER_MESSAGES: Record<string, string> = {
  NOT_LOGGED_IN: USER_MESSAGES.SESSION_EXPIRED,
  ACCOUNT_INTERVENTION: "The X account needs manual attention (a challenge or restriction). Open the profile from Settings and complete the check, then try again.",
  PROFILE_IN_USE: USER_MESSAGES.RESOURCE_BUSY,
  BROWSER_LAUNCH_FAILED: "The publisher browser could not start. Check the browser executable under Settings, then try again.",
  LEASE_LOST: USER_MESSAGES.RESOURCE_BUSY,
  MISSING_MEDIA: USER_MESSAGES.MEDIA_MISSING,
  UPLOAD_REJECTED: "X rejected the upload. Check the caption and media under Review, then try again.",
  PROCESSING_TIMEOUT: "X is still processing the video. Wait a few minutes, then retry from the Queue.",
  COMPOSER_SELECTOR: USER_MESSAGES.INTERNAL,
  SUBMISSION_FAILED: "X did not accept the submission. Check the Queue for the job's last error, then retry.",
  CONFIRMATION_FAILED: "The post may have published, but confirmation failed. Check the Published page before retrying.",
  INVALID_CAPTION: "The caption is not valid for X. Edit it under Review, then approve again.",
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly userMessage: string;

  constructor(code: AppErrorCode, options?: { userMessage?: string; cause?: unknown }) {
    const userMessage = options?.userMessage ?? USER_MESSAGES[code];
    super(userMessage, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.userMessage = userMessage;
  }
}

export function userError(message: string, code: AppErrorCode = "VALIDATION", cause?: unknown): AppError {
  return new AppError(code, cause !== undefined ? { userMessage: message, cause } : { userMessage: message });
}

function codeOf(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error && typeof (error as { code: unknown }).code === "string") {
    return (error as { code: string }).code;
  }
  return null;
}

/** Return true when a Chromium launch error indicates the profile directory is already locked by another browser process. */
export function isBrowserProfileInUseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /profile.*in use|user data directory is already in use|processsingleton|opening in existing browser session|cannot create a process singleton/i.test(message);
}

/** Return true when a filesystem error indicates an open file or directory lock (common on Windows when a browser holds profile files). */
export function isFileLockError(error: unknown): boolean {
  const code = codeOf(error);
  if (code === "EPERM" || code === "EBUSY" || code === "EACCES") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /\b(EPERM|EBUSY|EACCES)\b|operation not permitted|resource busy or locked/i.test(message);
}

export function toUserMessage(error: unknown): string {
  if (error instanceof AppError) return error.userMessage;
  if (error instanceof ResourceBusyError) return USER_MESSAGES.RESOURCE_BUSY;
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    if (issue?.message) return issue.message;
    return USER_MESSAGES.VALIDATION;
  }
  const code = codeOf(error);
  if (code === "ENOENT") return USER_MESSAGES.MEDIA_MISSING;
  if (code === "P2025" || code === "P2016") return USER_MESSAGES.NOT_FOUND;
  if (code === "P2002") return "That value is already in use. Choose a different one.";
  if (code === "P2003") return "That change would affect related records and was not saved.";
  if (error && typeof error === "object" && "kind" in error && typeof (error as { kind: unknown }).kind === "string") {
    const mapped = PUBLISHER_MESSAGES[(error as { kind: string }).kind];
    if (mapped) return mapped;
  }
  return USER_MESSAGES.INTERNAL;
}
