import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError, toUserMessage, userError } from "@cenblu/shared/errors";
import { ResourceBusyError } from "@cenblu/shared/lease";

describe("toUserMessage", () => {
  it("returns the explicit user message for AppError", () => {
    expect(toUserMessage(userError("Choose an enabled Collector identity."))).toBe("Choose an enabled Collector identity.");
    expect(toUserMessage(new AppError("SESSION_EXPIRED"))).toContain("signed in to X");
  });

  it("maps resource-busy and missing-file errors", () => {
    expect(toUserMessage(new ResourceBusyError())).toContain("busy with another operation");
    const enoent = Object.assign(new Error("ENOENT: no such file or directory, open 'C:\\secret\\video.mp4'"), { code: "ENOENT" });
    expect(toUserMessage(enoent)).toBe("The local media file for this item is missing.");
  });

  it("maps known Prisma codes and never leaks their internals", () => {
    const notFound = Object.assign(new Error("No PublishJob found in preflight validation."), { code: "P2025" });
    expect(toUserMessage(notFound)).toBe("That item no longer exists. Refresh the page and try again.");
    const unique = Object.assign(new Error("Unique constraint failed on the fields: (`username`)"), { code: "P2002" });
    expect(toUserMessage(unique)).toBe("That value is already in use. Choose a different one.");
    const foreignKey = Object.assign(new Error("Foreign key constraint failed"), { code: "P2003" });
    expect(toUserMessage(foreignKey)).toContain("related records");
  });

  it("maps publisher failure kinds to actionable text", () => {
    const notLoggedIn = Object.assign(new Error("Publisher browser profile is not logged in"), { kind: "NOT_LOGGED_IN" });
    expect(toUserMessage(notLoggedIn)).toContain("signed in to X");
    const intervention = Object.assign(new Error("Publisher account requires manual intervention"), { kind: "ACCOUNT_INTERVENTION" });
    expect(toUserMessage(intervention)).toContain("manual attention");
    const missingMedia = Object.assign(new Error("media gone"), { kind: "MISSING_MEDIA" });
    expect(toUserMessage(missingMedia)).toBe("The local media file for this item is missing.");
    const unknownKind = Object.assign(new Error("boom"), { kind: "SOMETHING_NEW" });
    expect(toUserMessage(unknownKind)).toBe("Something went wrong while handling that request. Check the Logs page for details.");
  });

  it("uses the first zod issue message when present", () => {
    const result = z.string().min(1, "Select at least one enabled source.").safeParse("");
    expect(result.success).toBe(false);
    if (!result.success) expect(toUserMessage(result.error)).toBe("Select at least one enabled source.");
  });

  it("sanitizes unknown errors to a generic message", () => {
    expect(toUserMessage(new Error("spawn ffmpeg ENOENT C:\\Users\\secret\\bin\\ffmpeg.exe"))).toBe("Something went wrong while handling that request. Check the Logs page for details.");
    expect(toUserMessage("plain string")).toBe("Something went wrong while handling that request. Check the Logs page for details.");
    expect(toUserMessage(undefined)).toBe("Something went wrong while handling that request. Check the Logs page for details.");
  });
});
