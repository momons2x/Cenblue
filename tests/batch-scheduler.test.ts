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

  it("clamps the count override to the number of jobs", () => {
    const result = buildBatchSchedule({ ...base, jobs: jobs(3), countOverride: 10 });
    expect(result).toHaveLength(3);
    const fewer = buildBatchSchedule({ ...base, jobs: jobs(6), countOverride: 2 });
    expect(fewer).toHaveLength(2);
  });

  it("applies random jitter within bounds", () => {
    const result = buildBatchSchedule({ ...base, jobs: jobs(4), jitterMinutes: 30, minGapMinutes: 5 });
    for (const entry of result) {
      const hour = Number(hourOf(entry.scheduledFor, timeZone));
      expect(hour).toBeGreaterThanOrEqual(9);
      expect(hour).toBeLessThanOrEqual(22);
    }
  });

  it("keeps slots at least minGapMinutes apart", () => {
    const result = buildBatchSchedule({ ...base, jobs: jobs(8), jitterMinutes: 10, minGapMinutes: 15 });
    const sorted = [...result.map((entry) => entry.scheduledFor.getTime())].sort((a, b) => a - b);
    for (let index = 1; index < sorted.length; index += 1) {
      expect(sorted[index] - sorted[index - 1]).toBeGreaterThanOrEqual(15 * 60_000);
    }
  });

  it("returns an empty list for no jobs", () => {
    expect(buildBatchSchedule({ ...base, jobs: [] })).toEqual([]);
  });

  it("rejects an inverted active window", () => {
    expect(() => buildBatchSchedule({ ...base, activeStart: "22:00", activeEnd: "09:00", jobs: jobs(2) })).toThrow(/must start before/);
  });
});
