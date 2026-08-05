import { describe, expect, it } from "vitest";
import { pastDueWarning } from "../apps/dashboard/app/lib/publish-alerts";

const now = new Date("2026-08-04T19:10:00.000Z");
const earlier = new Date("2026-08-04T18:56:00.000Z");
const later = new Date("2026-08-04T20:00:00.000Z");

const settings = {
  publishMode: "AUTOMATIC",
  identities: [{ id: "pub-1", label: "Publisher A", enabled: true, automaticEnabled: true, verified: true }],
};

describe("pastDueWarning", () => {
  it("returns null for jobs that are not approved", () => {
    expect(pastDueWarning({ status: "READY_FOR_REVIEW", scheduledFor: earlier, nextAttemptAt: null, publisherIdentityId: "pub-1" }, settings, now)).toBeNull();
    expect(pastDueWarning({ status: "COMPLETED", scheduledFor: earlier, nextAttemptAt: null, publisherIdentityId: "pub-1" }, settings, now)).toBeNull();
  });

  it("returns null for approved jobs scheduled in the future", () => {
    expect(pastDueWarning({ status: "APPROVED", scheduledFor: later, nextAttemptAt: null, publisherIdentityId: "pub-1" }, settings, now)).toBeNull();
  });

  it("returns null when everything is healthy even if the time has passed", () => {
    expect(pastDueWarning({ status: "APPROVED", scheduledFor: earlier, nextAttemptAt: null, publisherIdentityId: "pub-1" }, settings, now)).toBeNull();
  });

  it("flags when publish mode is not automatic", () => {
    const result = pastDueWarning({ status: "APPROVED", scheduledFor: earlier, nextAttemptAt: null, publisherIdentityId: "pub-1" }, { ...settings, publishMode: "ASSISTED" }, now);
    expect(result).toContain("Publish mode");
  });

  it("flags when no publisher identity is assigned", () => {
    const result = pastDueWarning({ status: "APPROVED", scheduledFor: earlier, nextAttemptAt: null, publisherIdentityId: null }, settings, now);
    expect(result).toContain("No Publisher identity assigned");
  });

  it("flags a paused publisher", () => {
    const result = pastDueWarning({ status: "APPROVED", scheduledFor: earlier, nextAttemptAt: null, publisherIdentityId: "pub-1" }, { publishMode: "AUTOMATIC", identities: [{ id: "pub-1", label: "Publisher A", enabled: false, automaticEnabled: true, verified: true }] }, now);
    expect(result).toContain("paused");
  });

  it("flags a publisher without automatic publishing enabled", () => {
    const result = pastDueWarning({ status: "APPROVED", scheduledFor: earlier, nextAttemptAt: null, publisherIdentityId: "pub-1" }, { publishMode: "AUTOMATIC", identities: [{ id: "pub-1", label: "Publisher A", enabled: true, automaticEnabled: false, verified: true }] }, now);
    expect(result).toContain("not enabled for automatic publishing");
  });

  it("flags an unverified publisher", () => {
    const result = pastDueWarning({ status: "APPROVED", scheduledFor: earlier, nextAttemptAt: null, publisherIdentityId: "pub-1" }, { publishMode: "AUTOMATIC", identities: [{ id: "pub-1", label: "Publisher A", enabled: true, automaticEnabled: true, verified: false }] }, now);
    expect(result).toContain("not verified");
  });

  it("flags a missing publisher identity", () => {
    const result = pastDueWarning({ status: "APPROVED", scheduledFor: earlier, nextAttemptAt: null, publisherIdentityId: "gone" }, settings, now);
    expect(result).toContain("no longer exists");
  });

  it("respects a pending retry wait", () => {
    const pending = new Date("2026-08-04T19:20:00.000Z");
    expect(pastDueWarning({ status: "RETRY_WAIT", scheduledFor: earlier, nextAttemptAt: pending, publisherIdentityId: "pub-1" }, settings, now)).toBeNull();
    const result = pastDueWarning({ status: "RETRY_WAIT", scheduledFor: earlier, nextAttemptAt: earlier, publisherIdentityId: "pub-1" }, settings, now);
    expect(result).toBeNull();
  });
});