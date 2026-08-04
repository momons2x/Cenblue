"use client";

import { useId, useRef, useState } from "react";
import { scheduleParts, timeZoneOffset } from "./lib/schedule";

function monthDays(month: Date): Date[] {
  const first = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + index)));
}

function dateValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function displayDate(value: string): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

export function ScheduleField({ value = null, timeZone, optional = false }: { value?: string | null; timeZone: string; optional?: boolean; compact?: boolean }) {
  const initial = scheduleParts(value, timeZone);
  const [date, setDate] = useState(initial.date);
  const [hour, setHour] = useState(initial.hour);
  const [minute, setMinute] = useState(initial.minute);
  const [draftDate, setDraftDate] = useState(initial.date);
  const [draftHour, setDraftHour] = useState(initial.hour);
  const [draftMinute, setDraftMinute] = useState(initial.minute);
  const initialMonth = initial.date ? new Date(`${initial.date}T00:00:00Z`) : new Date();
  const [month, setMonth] = useState(new Date(Date.UTC(initialMonth.getUTCFullYear(), initialMonth.getUTCMonth(), 1)));
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const days = monthDays(month);

  const open = () => {
    setDraftDate(date);
    setDraftHour(hour);
    setDraftMinute(minute);
    setError(null);
    if (date) {
      const selected = new Date(`${date}T00:00:00Z`);
      setMonth(new Date(Date.UTC(selected.getUTCFullYear(), selected.getUTCMonth(), 1)));
    }
    dialogRef.current?.showModal();
  };

  const apply = () => {
    const nextHour = Number(draftHour);
    const nextMinute = Number(draftMinute);
    if (!draftDate || !Number.isInteger(nextHour) || nextHour < 0 || nextHour > 23 || !Number.isInteger(nextMinute) || nextMinute < 0 || nextMinute > 59) {
      setError("Choose a date and enter a valid 24-hour time from 00:00 to 23:59.");
      return;
    }
    setDate(draftDate);
    setHour(String(nextHour).padStart(2, "0"));
    setMinute(String(nextMinute).padStart(2, "0"));
    dialogRef.current?.close();
  };

  const clear = () => {
    setDate("");
    setDraftDate("");
    setError(null);
    dialogRef.current?.close();
  };

  return <div className="grid min-w-0 gap-1.5">
    <input type="hidden" name="scheduledDate" value={date} />
    <input type="hidden" name="scheduledHour" value={hour} />
    <input type="hidden" name="scheduledMinute" value={minute} />
    <button className="flex min-h-10 min-w-0 items-center justify-between gap-3 rounded-sm border border-line bg-surface px-3 py-2 text-left text-xs text-ink hover:border-accent-text" type="button" aria-haspopup="dialog" onClick={open}><span className="min-w-0 truncate">{date ? `${displayDate(date)} · ${hour}:${minute}` : optional ? "Manual only · choose schedule" : "Choose date and time"}</span><span className="shrink-0 text-accent-text" aria-hidden="true">Calendar</span></button>
    <small className="[overflow-wrap:anywhere] text-[10px] text-muted">{timeZone} ({timeZoneOffset(timeZone)})</small>
    <dialog ref={dialogRef} className="m-auto max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] overflow-auto rounded-sm border border-line bg-surface p-0 text-ink backdrop:bg-black/70" aria-labelledby={headingId} onCancel={() => dialogRef.current?.close()}>
      <div className="w-[min(94vw,29rem)] bg-surface p-5 text-ink sm:p-6">
        <header className="mb-4 flex items-center justify-between gap-3"><button className="small-button" type="button" aria-label="Previous month" onClick={() => setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1)))}>Previous</button><h2 id={headingId} className="m-0 text-xl">{new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(month)}</h2><button className="small-button" type="button" aria-label="Next month" onClick={() => setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1)))}>Next</button></header>
        <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day} className="py-1">{day}</span>)}</div>
        <div className="grid grid-cols-7 gap-1">{days.map((day) => { const value_ = dateValue(day); const inMonth = day.getUTCMonth() === month.getUTCMonth(); const selected = value_ === draftDate; return <button key={value_} type="button" className={`aspect-square rounded-sm border text-sm ${selected ? "border-accent bg-accent text-on-accent" : "border-transparent bg-transparent text-ink hover:border-line hover:bg-subtle"} ${inMonth ? "" : "opacity-40"}`} aria-pressed={selected} aria-label={new Intl.DateTimeFormat("en", { dateStyle: "full", timeZone: "UTC" }).format(day)} onClick={() => setDraftDate(value_)}>{day.getUTCDate()}</button>; })}</div>
        <section className="mt-5 border-t border-line pt-5"><div className="mb-2 flex items-end justify-between gap-3"><div><p className="m-0 text-xs font-semibold uppercase tracking-wider text-muted">Time</p><strong className="text-sm">24-hour format</strong></div><span className="text-xs text-muted">{draftDate ? displayDate(draftDate) : "Choose a date"}</span></div><div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3"><label className="grid gap-1 text-xs font-semibold text-muted">Hour<input className="w-full rounded-sm border border-line bg-surface px-3 py-3 text-center text-2xl font-semibold tabular-nums text-ink" inputMode="numeric" maxLength={2} placeholder="HH" value={draftHour} onChange={(event) => setDraftHour(event.target.value.replace(/\D/g, "").slice(0, 2))} /></label><span className="pt-5 text-2xl font-semibold text-muted">:</span><label className="grid gap-1 text-xs font-semibold text-muted">Minute<input className="w-full rounded-sm border border-line bg-surface px-3 py-3 text-center text-2xl font-semibold tabular-nums text-ink" inputMode="numeric" maxLength={2} placeholder="MM" value={draftMinute} onChange={(event) => setDraftMinute(event.target.value.replace(/\D/g, "").slice(0, 2))} /></label></div></section>
        {error && <p className="mt-3 text-xs text-danger" role="alert">{error}</p>}
        <footer className="mt-5 flex flex-wrap justify-end gap-2 border-t border-line pt-4">{optional && <button className="small-button mr-auto" type="button" onClick={clear}>Manual only</button>}<button className="small-button" type="button" onClick={() => dialogRef.current?.close()}>Cancel</button><button className="small-button accent-button" type="button" onClick={apply}>Apply schedule</button></footer>
      </div>
    </dialog>
  </div>;
}
