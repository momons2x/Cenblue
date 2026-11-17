import { toUserMessage } from "@cenblu/shared/errors";

export type PublishAlertSettings = {
  publishMode: string;
  identities: { id: string; label: string; enabled: boolean; automaticEnabled: boolean; verified: boolean }[];
};

export type PublishAlertJob = {
  status: string;
  scheduledFor: Date | null;
  nextAttemptAt: Date | null;
  publisherIdentityId: string | null;
  lastError?: string | null;
};

export type PublishBlockState = { state: "BLOCKED" | "SESSION_EXPIRED"; message: string };

const SESSION_ERROR_KINDS = ["NOT_LOGGED_IN", "ACCOUNT_INTERVENTION", "PROFILE_IN_USE"];

export function pastDueWarning(job: PublishAlertJob, settings: PublishAlertSettings, now: Date = new Date()): string | null {
  if (!["APPROVED", "RETRY_WAIT"].includes(job.status)) return null;
  if (!job.scheduledFor || job.scheduledFor > now) return null;
  if (job.status === "RETRY_WAIT" && job.nextAttemptAt && job.nextAttemptAt > now) return null;
  if (settings.publishMode !== "AUTOMATIC") return "Auto-publishing is off (Publish mode is not Automatic).";
  if (!job.publisherIdentityId) return "No Publisher identity assigned — auto-publishing cannot run this job.";
  const identity = settings.identities.find((candidate) => candidate.id === job.publisherIdentityId);
  if (!identity) return "Assigned Publisher identity no longer exists.";
  if (!identity.enabled) return `${identity.label} is paused — auto-publishing skipped.`;
  if (!identity.automaticEnabled) return `${identity.label} is not enabled for automatic publishing.`;
  if (!identity.verified) return `${identity.label} is not verified — auto-publishing skipped.`;
  return null;
}

export function publishBlockState(job: PublishAlertJob, settings: PublishAlertSettings, now: Date = new Date()): PublishBlockState | null {
  const lastError = job.lastError ?? "";
  const sessionKind = SESSION_ERROR_KINDS.find((kind) => lastError.startsWith(`${kind}:`));
  if (sessionKind && ["FAILED", "MANUAL_ATTENTION", "RETRY_WAIT"].includes(job.status)) {
    return { state: "SESSION_EXPIRED", message: toUserMessage({ kind: sessionKind }) };
  }
  const warning = pastDueWarning(job, settings, now);
  return warning ? { state: "BLOCKED", message: warning } : null;
}
