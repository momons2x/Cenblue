"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cancelCollection, fetchPostPerformance } from "./actions";
import type { PostMetrics } from "@cenblu/collector";
import { useStatusPoll, type StatusCounts } from "./lib/status-store";
import { formatNumber } from "./lib/format";

export type NavItem = { label: string; href: string; count?: keyof StatusCounts };

export function RefreshButton() {
  const router = useRouter();
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const refresh = () => startTransition(() => {
    router.refresh();
    setRefreshedAt(new Date());
  });

  return <button className="refresh-button" type="button" onClick={refresh}>↻ Refresh <small>{refreshedAt ? refreshedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "manual"}</small></button>;
}

export function LiveRefresh() {
  const router = useRouter();
  const status = useStatusPoll();
  const busy = status.collection?.active?.status === "RUNNING" || status.downloads?.run?.status === "RUNNING";
  const previous = useRef<boolean | null>(null);

  useEffect(() => {
    if (previous.current === null) {
      previous.current = busy;
      return;
    }
    if (previous.current && !busy) router.refresh();
    previous.current = busy;
  }, [busy, router]);

  return null;
}

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.dataset.theme === "dark");
  }, []);

  const toggleTheme = () => {
    const nextDark = !dark;
    document.documentElement.dataset.theme = nextDark ? "dark" : "light";
    document.documentElement.style.colorScheme = nextDark ? "dark" : "light";
    localStorage.setItem("cenblu-theme", nextDark ? "dark" : "light");
    setDark(nextDark);
  };

  return <button className="theme-toggle" type="button" aria-pressed={dark} aria-label={`Switch to ${dark ? "light" : "dark"} mode`} onClick={toggleTheme}><span aria-hidden="true">{dark ? "☀" : "◐"}</span>{dark ? "Light" : "Dark"}</button>;
}

export function Navigation({ groups }: { groups: readonly { label: string; items: readonly NavItem[] }[] }) {
  const pathname = usePathname();
  const counts = useStatusPoll().counts;
  return <nav aria-label="Main navigation">{groups.map((group) => <div className="side-group" key={group.label}><p className="side-label">{group.label}</p>{group.items.map((item) => {
    const count = item.count ? counts?.[item.count] ?? 0 : 0;
    return <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined} className={pathname === item.href ? "active" : undefined}><span className="nav-dot" aria-hidden="true" />{item.label}{count > 0 && <span className="nav-count" title={`${count} pending`}>{count > 99 ? "99+" : count}</span>}</Link>;
  })}</div>)}</nav>;
}

export function SelectionSummary({ formId, itemLabel = "items" }: { formId: string; itemLabel?: string }) {
  const [state, setState] = useState({ selected: 0, total: 0 });
  useEffect(() => {
    const sync = () => {
      const boxes = Array.from(document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][form="${formId}"]`));
      setState({ selected: boxes.filter((box) => box.checked).length, total: boxes.length });
    };
    sync();
    document.addEventListener("change", sync);
    return () => document.removeEventListener("change", sync);
  }, [formId]);
  const allSelected = state.total > 0 && state.selected === state.total;
  const toggleAll = () => {
    document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][form="${formId}"]`).forEach((box) => { box.checked = !allSelected; });
    setState({ selected: allSelected ? 0 : state.total, total: state.total });
  };
  return <><span className="selection-count">{state.selected} of {state.total} {itemLabel} selected</span><button className="small-button" type="button" onClick={toggleAll} disabled={state.total === 0}>{allSelected ? "Clear selection" : "Select all"}</button></>;
}

export function SubmitButton({ children, className = "small-button", pending = "Working…", ...props }: { children: React.ReactNode; className?: string; pending?: string } & Omit<React.ComponentPropsWithoutRef<"button">, "type">) {
  const { pending: isPending } = useFormStatus();
  return <button {...props} className={className} type="submit" disabled={isPending || props.disabled}>{isPending ? pending : children}</button>;
}

export function ConfirmSubmitButton({ children, message, className = "small-button danger-button", pendingLabel = "Working…", ...props }: { children: React.ReactNode; message: string; className?: string; pendingLabel?: string } & React.ComponentPropsWithoutRef<"button">) {
  const { pending } = useFormStatus();
  const [confirming, setConfirming] = useState(false);
  if (!confirming) return <button className={className} type="button" disabled={pending || props.disabled} onClick={() => setConfirming(true)}>{children}</button>;
  return <span className="grid max-w-80 gap-2 rounded-sm border border-warning/40 bg-warning/10 p-3">
    <small className="whitespace-pre-line text-xs leading-relaxed text-warning">{message}</small>
    <span className="flex flex-wrap gap-2"><button {...props} className={className} type="submit" disabled={pending || props.disabled}>{pending ? pendingLabel : "Confirm action"}</button><button className="small-button" type="button" disabled={pending} onClick={() => setConfirming(false)}>Keep</button></span>
  </span>;
}

export function CollectionProgress() {
  const status = useStatusPoll().collection;
  const run = status?.active ?? status?.latest;
  if (!run) return null;
  const percent = run.totalSources === 0 ? 0 : Math.round(run.completedSources / run.totalSources * 100);
  if (run.status === "RUNNING") {
    const source = run.sources.find((item) => item.status === "RUNNING");
    const sourcePercent = source ? Math.min(100, Math.round(source.newFound / Math.max(source.targetNew, 1) * 100)) : 0;
    return <div className="collection-progress" role="status"><div><strong>{run.cancelRequestedAt ? "Cancelling" : "Collecting"} {run.completedSources}/{run.totalSources} sources{(status?.actives?.length ?? 0) > 1 ? ` · ${status!.actives!.length} Collectors active` : ""}</strong><small>{run.collectorIdentity ? `${run.collectorIdentity.label} · ` : ""}{run.currentSource ? `Reading @${run.currentSource}` : "Opening X session"}</small></div><div className="progress-track" role="progressbar" aria-label="Source progress" aria-valuemin={0} aria-valuemax={run.totalSources} aria-valuenow={run.completedSources}><span style={{ width: `${percent}%` }} /></div>{source && <div className="post-progress"><strong>@{source.sourceAccount.username}: {source.newFound} / {source.targetNew} new posts</strong><small>{source.eligibleExamined} eligible examined · {source.knownSkipped} previously collected</small><div className="progress-track" role="progressbar" aria-label="New post progress" aria-valuemin={0} aria-valuemax={source.targetNew} aria-valuenow={source.newFound}><span style={{ width: `${sourcePercent}%` }} /></div></div>}<small className="collection-totals">{run.newFound} / {run.targetNew} new posts · {run.knownSkipped} previously collected · {run.inserted} inserted</small>{!run.cancelRequestedAt && <form action={cancelCollection}><input type="hidden" name="runId" value={run.id} /><button className="small-button danger-button" type="submit">Cancel after current source</button></form>}</div>;
  }
  if (run.status === "BUSY") return <p className="error-line">{run.lastError}</p>;
  return null;
}

export function DownloadProgress() {
  const status = useStatusPoll().downloads;
  if (!status?.run || status.run.status !== "RUNNING") return null;
  const percent = Math.min(100, Math.round(status.run.processed / Math.max(status.run.limit, 1) * 100));
  return <div className="collection-progress download-progress" role="status"><div><strong>Downloading {status.run.processed} / {status.run.limit}</strong><small>{status.active.length > 0 ? `${status.active.length} active` : "Preparing next download"}</small></div><div className="progress-track" role="progressbar" aria-label="Download progress" aria-valuemin={0} aria-valuemax={status.run.limit} aria-valuenow={status.run.processed}><span style={{ width: `${percent}%` }} /></div>{status.active.length > 0 && <small className="collection-totals">{status.active.map((job) => `@${job.sourcePost.sourceAccount.username} · ${job.sourcePost.platformPostId}`).join("  |  ")}</small>}</div>;
}

export function CollectionButton({ children, className = "small-button accent-button" }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  const busy = useStatusPoll().collection?.active?.status === "RUNNING";
  return <button className={className} type="submit" disabled={pending || busy}>{pending ? "Collecting…" : busy ? "Browser busy" : children}</button>;
}

type Action = (formData: FormData) => Promise<void>;
export function ActionForm({ action, children, className, success, id }: { action: Action; children: React.ReactNode; className?: string; success?: string; id?: string }) {
  return <form id={id} action={action} className={className}>{children}{success && <span className="sr-only">{success}</span>}</form>;
}

export function PostPerformanceReport({ publishedPostId, result }: { publishedPostId: string; result?: { error?: string; metrics?: PostMetrics; fetchedAt?: string } }) {
  return <div className="post-report">
    <form action={fetchPostPerformance}><input type="hidden" name="publishedPostId" value={publishedPostId} /><SubmitButton pending="Fetching…">{result?.metrics ? "Refresh performance" : "Fetch performance"}</SubmitButton></form>
    {result?.error && <div className="toast error" role="alert">{result.error}</div>}
    {result?.metrics && <><dl className="mt-2 grid grid-cols-2 border border-line sm:grid-cols-5">{[["Replies", result.metrics.replies], ["Reposts", result.metrics.reposts], ["Likes", result.metrics.likes], ["Bookmarks", result.metrics.bookmarks], ["Views", result.metrics.views]].map(([label, value]) => <div className="min-w-0 border-b border-line p-2 text-center last:border-b-0 sm:border-r sm:border-b-0 sm:last:border-r-0" key={String(label)}><dt className="text-[9px] uppercase tracking-wide text-muted">{label}</dt><dd className="m-0 mt-1 [overflow-wrap:anywhere] text-sm font-bold text-ink">{value === null ? "—" : formatNumber(value as number)}</dd></div>)}</dl><small className="mt-2 block text-muted">Fetched {result.fetchedAt ? new Date(result.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "now"} · not stored</small></>}
  </div>;
}

export function DiagnosticGallery({ images }: { images: string[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (selected && dialog && !dialog.open) dialog.showModal();
    if (!selected && dialog?.open) dialog.close();
  }, [selected]);
  return <><div className="diagnostic-grid">{images.map((image) => <button className="diagnostic-thumb" type="button" key={image} onClick={() => setSelected(image)}><img src={`/diagnostics/${encodeURIComponent(image)}`} alt={`Diagnostic screenshot ${image}`} /><small className="[overflow-wrap:anywhere]">{image}</small></button>)}</div><dialog ref={dialogRef} className="m-auto max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] overflow-auto rounded-sm border border-line bg-surface p-0 text-ink backdrop:bg-black/70" aria-label={selected ? `Diagnostic screenshot ${selected}` : "Diagnostic screenshot"} onClose={() => setSelected(null)} onCancel={() => setSelected(null)}>{selected && <div className="grid gap-4 p-4"><button className="small-button justify-self-end" type="button" onClick={() => dialogRef.current?.close()}>Close preview</button><img className="max-h-[82dvh] max-w-full" src={`/diagnostics/${encodeURIComponent(selected)}`} alt={`Diagnostic screenshot ${selected}`} /></div>}</dialog></>;
}
