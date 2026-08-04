import { describe, expect, it } from "vitest";
import { formatInTimeZone, scheduleFromFields, scheduleParts } from "../apps/dashboard/app/lib/schedule";

function fields(date: string, hour: string, minute: string): FormData {
  const form = new FormData();
  form.set("scheduledDate", date);
  form.set("scheduledHour", hour);
  form.set("scheduledMinute", minute);
  return form;
}

describe("timezone-safe scheduling", () => {
  it("converts APP_TIMEZONE wall time to an absolute instant", () => {
    const scheduled = scheduleFromFields(fields("2026-08-04", "09", "15"), "Asia/Jakarta", false);
    expect(scheduled?.toISOString()).toBe("2026-08-04T02:15:00.000Z");
    expect(scheduleParts(scheduled!.toISOString(), "Asia/Jakarta")).toEqual({ date: "2026-08-04", hour: "09", minute: "15" });
    expect(formatInTimeZone(scheduled!, "Asia/Jakarta")).toMatch(/0?9:15/);
  });

  it("accepts custom minutes and rejects invalid or nonexistent wall times", () => {
    expect(scheduleFromFields(fields("2026-08-04", "23", "47"), "Asia/Jakarta", false)?.toISOString()).toBe("2026-08-04T16:47:00.000Z");
    expect(() => scheduleFromFields(fields("2026-08-04", "24", "00"), "Asia/Jakarta", false)).toThrow("24-hour");
    expect(() => scheduleFromFields(fields("2026-08-04", "09", "60"), "Asia/Jakarta", false)).toThrow("24-hour");
    expect(() => scheduleFromFields(fields("2026-03-08", "02", "15"), "America/New_York", false)).toThrow("not valid");
    expect(() => scheduleFromFields(fields("2026-11-01", "01", "15"), "America/New_York", false)).toThrow("not valid");
  });

  it("allows an empty optional schedule for manual-only approval", () => {
    expect(scheduleFromFields(fields("", "09", "00"), "Asia/Jakarta", true)).toBeNull();
  });
});
