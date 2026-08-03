"use client";

import { useId, useRef, useState } from "react";
import { scheduleMinutes, scheduleParts, timeZoneOffset } from "./lib/schedule";

function monthDays(month: Date): Date[] {
  const first = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + index)));
}

function dateValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function ScheduleField({ value = null, timeZone, optional = false, compact = false }: { value?: string | null; timeZone: string; optional?: boolean; compact?: boolean }) {
  const initial = scheduleParts(value, timeZone);
  const [date, setDate] = useState(initial.date);
  const [hour, setHour] = useState(initial.hour);
  const [minute, setMinute] = useState(initial.minute);
  const initialMonth = initial.date ? new Date(`${initial.date}T00:00:00Z`) : new Date();
  const [month, setMonth] = useState(new Date(Date.UTC(initialMonth.getUTCFullYear(), initialMonth.getUTCMonth(), 1)));
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const days = monthDays(month);

  const choose = (next: Date) => {
    setDate(dateValue(next));
    setMonth(new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), 1)));
    dialogRef.current?.close();
  };

  return <div className={`grid min-w-0 gap-2 ${compact ? "sm:grid-cols-[minmax(9rem,1fr)_auto_auto] sm:items-end" : ""}`}>
    <label className="grid min-w-0 gap-1 text-xs font-semibold text-muted"><span>Date</span><span className="flex min-w-0 gap-2"><input className="min-w-0 flex-1 rounded-sm border border-line bg-surface px-3 py-2 text-ink" name="scheduledDate" placeholder="Choose a date" value={date} readOnly /><button className="small-button shrink-0" type="button" aria-haspopup="dialog" onClick={() => dialogRef.current?.showModal()}>Calendar</button></span></label>
    <label className="grid gap-1 text-xs font-semibold text-muted"><span>Hour</span><select className="rounded-sm border border-line bg-surface px-3 py-2 text-ink" name="scheduledHour" value={hour} onChange={(event) => setHour(event.target.value)}>{Array.from({ length: 24 }, (_, value_) => String(value_).padStart(2, "0")).map((item) => <option key={item}>{item}</option>)}</select></label>
    <label className="grid gap-1 text-xs font-semibold text-muted"><span>Minute</span><select className="rounded-sm border border-line bg-surface px-3 py-2 text-ink" name="scheduledMinute" value={minute} onChange={(event) => setMinute(event.target.value)}>{scheduleMinutes.map((item) => <option key={item} value={String(item).padStart(2, "0")}>{String(item).padStart(2, "0")}</option>)}</select></label>
    <p className={`${compact ? "sm:col-span-3" : ""} m-0 text-[11px] text-muted`}>{timeZone} ({timeZoneOffset(timeZone)}){optional ? " · leave the date empty for manual-only publishing" : ""}</p>
    {optional && date && <button className="justify-self-start border-0 bg-transparent p-0 text-xs font-semibold text-accent-text underline underline-offset-4" type="button" onClick={() => setDate("")}>Clear schedule</button>}
    <dialog ref={dialogRef} className="m-auto max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] overflow-auto rounded-sm border border-line bg-surface p-0 text-ink backdrop:bg-black/70" aria-labelledby={headingId} onCancel={() => dialogRef.current?.close()}>
      <div className="w-[min(92vw,25rem)] bg-surface p-5 text-ink">
        <header className="mb-4 flex items-center justify-between gap-3"><button className="small-button" type="button" aria-label="Previous month" onClick={() => setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1)))}>Previous</button><h2 id={headingId} className="m-0 text-xl">{new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(month)}</h2><button className="small-button" type="button" aria-label="Next month" onClick={() => setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1)))}>Next</button></header>
        <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day} className="py-1">{day}</span>)}</div>
        <div className="grid grid-cols-7 gap-1">{days.map((day) => { const value_ = dateValue(day); const inMonth = day.getUTCMonth() === month.getUTCMonth(); const selected = value_ === date; return <button key={value_} type="button" className={`aspect-square rounded-sm border text-sm ${selected ? "border-accent bg-accent text-on-accent" : "border-transparent bg-transparent text-ink hover:border-line hover:bg-subtle"} ${inMonth ? "" : "opacity-40"}`} aria-pressed={selected} aria-label={new Intl.DateTimeFormat("en", { dateStyle: "full", timeZone: "UTC" }).format(day)} onClick={() => choose(day)}>{day.getUTCDate()}</button>; })}</div>
        <button className="small-button mt-4 w-full" type="button" onClick={() => dialogRef.current?.close()}>Close calendar</button>
      </div>
    </dialog>
  </div>;
}
