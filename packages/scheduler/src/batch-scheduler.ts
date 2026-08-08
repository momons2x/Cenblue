import { Temporal } from "@js-temporal/polyfill";

export type BatchScheduleInput = {
  jobs: Array<{ id: string }>;
  timeZone: string;
  activeStart: string;
  activeEnd: string;
  jitterMinutes: number;
  minGapMinutes: number;
  postsPerDay?: number;
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

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function dayWindow(day: Temporal.PlainDate, timeZone: string, start: { hour: number; minute: number }, end: { hour: number; minute: number }): { startMs: number; endMs: number } {
  const startMs = day.toZonedDateTime({ timeZone, plainTime: new Temporal.PlainTime(start.hour, start.minute) }).epochMilliseconds;
  const endDay = start.hour * 60 + start.minute < end.hour * 60 + end.minute ? day : day.add({ days: 1 });
  const endMs = endDay.toZonedDateTime({ timeZone, plainTime: new Temporal.PlainTime(end.hour, end.minute) }).epochMilliseconds;
  return { startMs, endMs };
}

function assignSlots(count: number, startMs: number, endMs: number, minGapMs: number, jitterMs: number, random: () => number): number[] {
  const windowMs = endMs - startMs;
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
  return times;
}

export function buildBatchSchedule(input: BatchScheduleInput): ScheduledJob[] {
  const jobs = input.jobs;
  if (jobs.length === 0) return [];
  const random = input.random ?? Math.random;
  const start = parseTime(input.activeStart);
  const end = parseTime(input.activeEnd);
  if (start.hour * 60 + start.minute === end.hour * 60 + end.minute) throw new Error("The schedule active window start and end must be different times.");

  const day = Temporal.PlainDate.from(input.targetDay);
  const { startMs: dayStartMs, endMs: dayEndMs } = dayWindow(day, input.timeZone, start, end);
  const windowMs = dayEndMs - dayStartMs;
  const minGapMs = Math.max(0, input.minGapMinutes) * 60_000;
  const jitterMs = Math.max(0, input.jitterMinutes) * 60_000;
  const perDayCap = Math.max(1, Math.min(input.postsPerDay ?? Infinity, windowMs <= 0 || minGapMs === 0 ? Infinity : Math.floor(windowMs / minGapMs)));

  const shuffled = shuffle(jobs, random);
  const result: ScheduledJob[] = [];
  let remaining = shuffled;
  let dayOffset = 0;
  while (remaining.length > 0) {
    if (dayOffset > 366) throw new Error("The selected posts do not fit within a year of scheduling days.");
    const window = dayWindow(day.add({ days: dayOffset }), input.timeZone, start, end);
    const slots = Math.min(perDayCap, remaining.length);
    const times = assignSlots(slots, window.startMs, window.endMs, minGapMs, jitterMs, random);
    for (let index = 0; index < slots; index += 1) {
      result.push({ jobId: remaining[index].id, scheduledFor: new Date(times[index]) });
    }
    remaining = remaining.slice(slots);
    dayOffset += 1;
  }
  return result;
}
