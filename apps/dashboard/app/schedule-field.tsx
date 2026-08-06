"use client";

import { useEffect, useState } from "react";
import { scheduleParts, timeZoneOffset } from "./lib/schedule";

function timeValue(hour: string, minute: string): string {
  return `${hour}:${minute}`;
}

export function ScheduleField({ value = null, timeZone, optional = false }: { value?: string | null; timeZone: string; optional?: boolean }) {
  const [parts, setParts] = useState(() => scheduleParts(value, timeZone));

  useEffect(() => {
    setParts(scheduleParts(value, timeZone));
  }, [value, timeZone]);

  const { date, hour, minute } = parts;

  return <div className="grid min-w-0 gap-1.5">
    <input type="hidden" name="scheduledDate" value={date} />
    <input type="hidden" name="scheduledHour" value={hour} />
    <input type="hidden" name="scheduledMinute" value={minute} />
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
      <label className="grid min-w-0 gap-1 text-xs font-semibold text-muted">Date<input className="min-w-0 rounded-sm border border-line bg-surface px-3 py-2 text-sm text-ink" type="date" value={date} onChange={(event) => setParts((prev) => ({ ...prev, date: event.target.value }))} /></label>
      <label className="grid min-w-0 gap-1 text-xs font-semibold text-muted">Time<input className="min-w-0 rounded-sm border border-line bg-surface px-3 py-2 text-sm text-ink" type="time" value={timeValue(hour, minute)} onChange={(event) => { const next = event.target.value.split(":"); setParts({ date, hour: next[0] ?? "", minute: next[1] ?? "" }); }} /></label>
      {optional && <button className="small-button justify-self-start" type="button" onClick={() => setParts({ date: "", hour: "", minute: "" })}>Manual only</button>}
    </div>
    <small className="[overflow-wrap:anywhere] text-[10px] text-muted">{timeZone} ({timeZoneOffset(timeZone)})</small>
  </div>;
}