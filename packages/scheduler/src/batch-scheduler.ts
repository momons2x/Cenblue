import { Temporal } from "@js-temporal/polyfill";

export type BatchScheduleInput = {
  jobs: Array<{ id: string }>;
  timeZone: string;
  activeStart: string;
  activeEnd: string;
  jitterMinutes: number;
  minGapMinutes: number;
  countOverride?: number;
  targetDay: string;
  random?: () => number;
};

export type ScheduledJob = { jobId: string; scheduledFor: Date };

function parseTime(value: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error(`Invalid schedule time: ${value}. Use HH:MM.`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) throw new Error(`Invalid schedule time: ${value}. Use HH:MM.`);
  return { hour, minute };
}

export function buildBatchSchedule(input: BatchScheduleInput): ScheduledJob[] {
  const jobs = input.jobs;
  if (jobs.length === 0) return [];
  const random = input.random ?? Math.random;
  const count = Math.max(1, Math.min(input.countOverride ?? jobs.length, jobs.length));
  const start = parseTime(input.activeStart);
  const end = parseTime(input.activeEnd);
  if (start.hour * 60 + start.minute >= end.hour * 60 + end.minute) throw new Error("The schedule active window must start before it ends.");

  const day = Temporal.PlainDate.from(input.targetDay);
  const startZoned = day.toZonedDateTime({ timeZone: input.timeZone, plainTime: new Temporal.PlainTime(start.hour, start.minute) });
  const endZoned = day.toZonedDateTime({ timeZone: input.timeZone, plainTime: new Temporal.PlainTime(end.hour, end.minute) });
  const startMs = startZoned.epochMilliseconds;
  const endMs = endZoned.epochMilliseconds;
  const windowMs = endMs - startMs;

  const shuffled = [...jobs];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  const selected = shuffled.slice(0, count);
  const jitterMs = Math.max(0, input.jitterMinutes) * 60_000;
  const minGapMs = Math.max(0, input.minGapMinutes) * 60_000;
  const idealGapMs = windowMs / count;

  const times: number[] = [];
  let previous = startMs - minGapMs;
  for (let index = 0; index < count; index += 1) {
    const nominal = startMs + index * idealGapMs;
    let candidate = nominal;
    const boundedJitter = Math.max(0, Math.min(jitterMs, Math.max(0, idealGapMs - minGapMs) / 2));
    if (boundedJitter > 0) candidate += (random() * 2 - 1) * boundedJitter;
    const earliest = previous + minGapMs;
    const latest = endMs - (count - index - 1) * Math.max(minGapMs, 0);
    if (candidate < earliest) candidate = earliest;
    if (candidate > latest) candidate = latest;
    times.push(candidate);
    previous = candidate;
  }
  if (times[times.length - 1] > endMs) times[times.length - 1] = endMs;

  return selected.map((job, index) => ({ jobId: job.id, scheduledFor: new Date(times[index]) }));
}
