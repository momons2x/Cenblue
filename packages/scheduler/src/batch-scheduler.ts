import { Temporal } from "@js-temporal/polyfill";

export type BatchScheduleInput = {
  jobs: Array<{ id: string }>;
  timeZone: string;
  activeWindows: Array<{ start: string; end: string }>;
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

function toMinutes(time: { hour: number; minute: number }): number {
  return time.hour * 60 + time.minute;
}

function dayWindow(day: Temporal.PlainDate, timeZone: string, start: { hour: number; minute: number }, end: { hour: number; minute: number }): { startMs: number; endMs: number } {
  const startMs = day.toZonedDateTime({ timeZone, plainTime: new Temporal.PlainTime(start.hour, start.minute) }).epochMilliseconds;
  const endDay = start.hour * 60 + start.minute < end.hour * 60 + end.minute ? day : day.add({ days: 1 });
  const endMs = endDay.toZonedDateTime({ timeZone, plainTime: new Temporal.PlainTime(end.hour, end.minute) }).epochMilliseconds;
  return { startMs, endMs };
}

function assignSlots(count: number, startMs: number, endMs: number, minGapMs: number, jitterMs: number, random: () => number): number[] {
  if (count === 0) return [];
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

function distributeProportionally(totalCount: number, windowMinutes: number[], totalMinutes: number): number[] {
  if (totalCount === 0) return windowMinutes.map(() => 0);
  const raw = windowMinutes.map((m) => m / totalMinutes * totalCount);
  const assigned = raw.map((r) => Math.floor(r));
  let remaining = totalCount - assigned.reduce((a, b) => a + b, 0);
  const fractional = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  for (const entry of fractional) {
    if (remaining <= 0) break;
    assigned[entry.i] += 1;
    remaining -= 1;
  }
  return assigned;
}

export function buildBatchSchedule(input: BatchScheduleInput): ScheduledJob[] {
  const jobs = input.jobs;
  if (jobs.length === 0) return [];
  const random = input.random ?? Math.random;
  const windows = input.activeWindows;
  if (windows.length === 0 || windows.length > 2) throw new Error("Schedule must have 1 or 2 active windows.");

  const parsedWindows = windows.map((w) => ({ start: parseTime(w.start), end: parseTime(w.end) }));
  for (const w of parsedWindows) {
    if (toMinutes(w.start) === toMinutes(w.end)) throw new Error(`Active window start and end must be different times (${w.start.hour}:${String(w.start.minute).padStart(2, "0")}).`);
  }
  if (parsedWindows.length === 2) {
    const a = parsedWindows[0];
    const b = parsedWindows[1];
    const aStart = toMinutes(a.start);
    const aEnd = toMinutes(a.end) <= aStart ? toMinutes(a.end) + 1440 : toMinutes(a.end);
    const bStart = toMinutes(b.start);
    const bEnd = toMinutes(b.end) <= bStart ? toMinutes(b.end) + 1440 : toMinutes(b.end);
    if (aStart < bEnd && bStart < aEnd) throw new Error("Active windows must not overlap.");
  }

  const day = Temporal.PlainDate.from(input.targetDay);
  const minGapMs = Math.max(0, input.minGapMinutes) * 60_000;
  const jitterMs = Math.max(0, input.jitterMinutes) * 60_000;

  const dayWindowsAll = parsedWindows.map((w) => dayWindow(day, input.timeZone, w.start, w.end));
  const windowMinutes = dayWindowsAll.map((dw) => (dw.endMs - dw.startMs) / 60_000);
  const totalMinutes = windowMinutes.reduce((a, b) => a + b, 0);
  const totalWindowMs = totalMinutes * 60_000;
  const perDayCap = Math.max(1, Math.min(
    input.postsPerDay ?? Infinity,
    totalWindowMs <= 0 || minGapMs === 0 ? Infinity : Math.floor(totalWindowMs / minGapMs),
  ));

  const shuffled = shuffle(jobs, random);
  const result: ScheduledJob[] = [];
  let remaining = shuffled;
  let dayOffset = 0;
  while (remaining.length > 0) {
    if (dayOffset > 366) throw new Error("The selected posts do not fit within a year of scheduling days.");
    const todayWindows = parsedWindows.map((w) => dayWindow(day.add({ days: dayOffset }), input.timeZone, w.start, w.end));
    const todayMinutes = todayWindows.map((dw) => (dw.endMs - dw.startMs) / 60_000);
    const todayTotalMs = todayMinutes.reduce((a, b) => a + b, 0) * 60_000;
    const todayCap = Math.max(1, Math.min(perDayCap, todayTotalMs <= 0 || minGapMs === 0 ? Infinity : Math.floor(todayTotalMs / minGapMs)));
    const slots = Math.min(todayCap, remaining.length);
    const perWindow = distributeProportionally(slots, todayMinutes, todayMinutes.reduce((a, b) => a + b, 0));
    let jobIndex = 0;
    for (let wIdx = 0; wIdx < todayWindows.length; wIdx += 1) {
      const winSlots = perWindow[wIdx];
      const win = todayWindows[wIdx];
      const times = assignSlots(winSlots, win.startMs, win.endMs, minGapMs, jitterMs, random);
      for (let sIdx = 0; sIdx < times.length; sIdx += 1) {
        result.push({ jobId: remaining[jobIndex].id, scheduledFor: new Date(times[sIdx]) });
        jobIndex += 1;
      }
    }
    remaining = remaining.slice(slots);
    dayOffset += 1;
  }
  return result;
}
