import { Temporal } from "@js-temporal/polyfill";

export function scheduleParts(value: string | null, timeZone: string): { date: string; hour: string; minute: string } {
  if (!value) return { date: "", hour: "09", minute: "00" };
  const zoned = Temporal.Instant.from(value).toZonedDateTimeISO(timeZone);
  return {
    date: `${zoned.year.toString().padStart(4, "0")}-${zoned.month.toString().padStart(2, "0")}-${zoned.day.toString().padStart(2, "0")}`,
    hour: zoned.hour.toString().padStart(2, "0"),
    minute: zoned.minute.toString().padStart(2, "0"),
  };
}

export function scheduleFromFields(formData: FormData, timeZone: string, optional: boolean): Date | null {
  const date = String(formData.get("scheduledDate") ?? "").trim();
  if (!date) {
    if (optional) return null;
    throw new Error("Choose a schedule date.");
  }
  const hour = Number(formData.get("scheduledHour"));
  const minute = Number(formData.get("scheduledMinute"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) throw new Error("Choose a valid schedule date and 24-hour time.");
  try {
    const scheduled = Temporal.ZonedDateTime.from(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}[${timeZone}]`, { disambiguation: "reject" });
    return new Date(scheduled.epochMilliseconds);
  } catch {
    throw new Error(`That date and time is not valid in ${timeZone}. Choose another time.`);
  }
}

export function formatInTimeZone(value: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(new Date(value));
}

export function timeZoneOffset(timeZone: string): string {
  return new Intl.DateTimeFormat("en", { timeZone, timeZoneName: "shortOffset" }).formatToParts(new Date()).find((part) => part.type === "timeZoneName")?.value ?? timeZone;
}
