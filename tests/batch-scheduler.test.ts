import { describe, expect, it } from "vitest";
import { buildBatchSchedule } from "@cenblu/scheduler";

const timeZone = "Asia/Jakarta";
const jobs = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `job-${index}` }));
const base = {
  timeZone,
  activeStart: "09:00",
  activeEnd: "22:00",
  jitterMinutes: 0,
  minGapMinutes: 0,
  targetDay: "2026-08-10",
};

function hourOf(date: Date, zone: string): number {
  return Number(new Intl.DateTimeFormat("en", { timeZone: zone, hour: "2-digit", hour12: false }).format(date));
}

function dayOf(date: Date, zone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(date);
}

function nightOf(date: Date, zone: string): string {
  const hour = Number(hourOf(date, zone));
  const calendar = dayOf(date, zone);
  if (hour >= 14) return calendar;
  return dayOf(new Date(date.getTime() - 24 * 3_600_000), zone);
}

describe("buildBatchSchedule", () => {
  it("schedules every job within the active window", () => {
    const result = buildBatchSchedule({ ...base, jobs: jobs(5) });
    expect(result).toHaveLength(5);
    for (const entry of result) {
      const hour = Number(hourOf(entry.scheduledFor, timeZone));
      expect(hour).toBeGreaterThanOrEqual(9);
      expect(hour).toBeLessThanOrEqual(22);
    }
  });

  it("shuffles the job order with a deterministic random source", () => {
    const random = () => 0.2;
    const first = buildBatchSchedule({ ...base, jobs: jobs(6), random }).map((entry) => entry.jobId);
    const second = buildBatchSchedule({ ...base, jobs: jobs(6), random }).map((entry) => entry.jobId);
    expect(first).not.toEqual([...jobs(6)].map((job) => job.id));
    expect(first).toEqual(second);
  });

  it("spills overflow across the following days when no per-day cap is given", () => {
    const result = buildBatchSchedule({ ...base, jobs: jobs(55), minGapMinutes: 15 });
    expect(result).toHaveLength(55);
    const days = new Set(result.map((entry) => dayOf(entry.scheduledFor, timeZone)));
    expect(days.size).toBe(2);
    for (const entry of result) {
      const hour = Number(hourOf(entry.scheduledFor, timeZone));
      expect(hour).toBeGreaterThanOrEqual(9);
      expect(hour).toBeLessThanOrEqual(22);
    }
  });

  it("respects a posts-per-day cap and spills the rest to following days", () => {
    const result = buildBatchSchedule({ ...base, jobs: jobs(5), postsPerDay: 2 });
    expect(result).toHaveLength(5);
    const counts: Record<string, number> = {};
    for (const entry of result) {
      const day = dayOf(entry.scheduledFor, timeZone);
      counts[day] = (counts[day] ?? 0) + 1;
    }
    expect(Object.values(counts).sort((a, b) => a - b)).toEqual([1, 2, 2]);
  });

  it("clamps a per-day cap to the active window capacity", () => {
    const result = buildBatchSchedule({ ...base, jobs: jobs(60), minGapMinutes: 15, postsPerDay: 100 });
    expect(result).toHaveLength(60);
    const days = new Set(result.map((entry) => dayOf(entry.scheduledFor, timeZone)));
    expect(days.size).toBe(2);
  });

  it("applies random jitter within bounds", () => {
    const result = buildBatchSchedule({ ...base, jobs: jobs(4), jitterMinutes: 30, minGapMinutes: 5 });
    for (const entry of result) {
      const hour = Number(hourOf(entry.scheduledFor, timeZone));
      expect(hour).toBeGreaterThanOrEqual(9);
      expect(hour).toBeLessThanOrEqual(22);
    }
  });

  it("keeps slots at least minGapMinutes apart within each day", () => {
    const result = buildBatchSchedule({ ...base, jobs: jobs(8), jitterMinutes: 10, minGapMinutes: 15 });
    const byDay = new Map<string, number[]>();
    for (const entry of result) {
      const day = dayOf(entry.scheduledFor, timeZone);
      const times = byDay.get(day) ?? [];
      times.push(entry.scheduledFor.getTime());
      byDay.set(day, times);
    }
    for (const times of byDay.values()) {
      const sorted = times.sort((a, b) => a - b);
      for (let index = 1; index < sorted.length; index += 1) {
        expect(sorted[index] - sorted[index - 1]).toBeGreaterThanOrEqual(15 * 60_000);
      }
    }
  });

  it("returns an empty list for no jobs", () => {
    expect(buildBatchSchedule({ ...base, jobs: [] })).toEqual([]);
  });

  it("supports a midnight-crossing active window", () => {
    const result = buildBatchSchedule({ ...base, activeStart: "14:25", activeEnd: "04:00", jobs: jobs(5), jitterMinutes: 5, minGapMinutes: 25 });
    expect(result).toHaveLength(5);
    const sorted = [...result.map((entry) => entry.scheduledFor.getTime())].sort((a, b) => a - b);
    for (let index = 1; index < sorted.length; index += 1) {
      expect(sorted[index] - sorted[index - 1]).toBeGreaterThanOrEqual(25 * 60_000);
    }
    for (const entry of result) {
      const hour = Number(hourOf(entry.scheduledFor, timeZone));
      expect(hour >= 14 || hour <= 4).toBe(true);
    }
  });

  it("spills an overnight window across following nights", () => {
    const result = buildBatchSchedule({ ...base, activeStart: "14:25", activeEnd: "04:00", jobs: jobs(40), minGapMinutes: 25 });
    expect(result).toHaveLength(40);
    const nights = new Set(result.map((entry) => nightOf(entry.scheduledFor, timeZone)));
    expect(nights.size).toBe(2);
    const sorted = [...result.map((entry) => entry.scheduledFor.getTime())].sort((a, b) => a - b);
    for (let index = 1; index < sorted.length; index += 1) {
      expect(sorted[index] - sorted[index - 1]).toBeGreaterThanOrEqual(25 * 60_000);
    }
  });

  it("rejects an empty (equal-time) active window", () => {
    expect(() => buildBatchSchedule({ ...base, activeStart: "22:00", activeEnd: "22:00", jobs: jobs(2) })).toThrow(/must be different times/);
  });
});
