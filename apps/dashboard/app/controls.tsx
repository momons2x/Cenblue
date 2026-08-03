"use client";

import { startTransition, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cancelCollection, fetchPostPerformance } from "./actions";
import type { PostMetrics } from "@cenblu/collector";

export function RefreshButton() {
  const router = useRouter();
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const refresh = () => startTransition(() => {
    router.refresh();
    setRefreshedAt(new Date());
  });

  return <button className="refresh-button" type="button" onClick={refresh}>↻ Refresh <small>{refreshedAt ? refreshedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "manual"}</small></button>;
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

export function Navigation({ items }: { items: readonly (readonly [string, string])[] }) {
  const pathname = usePathname();
  return <nav aria-label="Main navigation">{items.map(([label, href]) => <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} className={pathname === href ? "active" : undefined}><span className="nav-dot" aria-hidden="true" />{label}</Link>)}</nav>;
}

export function SubmitButton({ children, className = "small-button", pending = "Working…" }: { children: React.ReactNode; className?: string; pending?: string }) {
  const { pending: isPending } = useFormStatus();
  return <button className={className} type="submit" disabled={isPending}>{isPending ? pending : children}</button>;
}

export function ConfirmSubmitButton({ children, message, className = "small-button danger-button", pendingLabel = "Working…", ...props }: { children: React.ReactNode; message: string; className?: string; pendingLabel?: string } & React.ComponentPropsWithoutRef<"button">) {
  const { pending } = useFormStatus();
  return <details className="confirm-submit"><summary className={className}>{children}</summary><small className="confirm-hint">{message}</small><button {...props} className={className} type="submit" disabled={pending}>{pending ? pendingLabel : "Confirm action"}</button></details>;
}

type CollectionRun = { id: string; status: string; totalSources: number; completedSources: number; failedSources: number; currentSource: string | null; lastError: string | null; cancelRequestedAt: string | null; targetNew: number; newFound: number; eligibleExamined: number; knownSkipped: number; inserted: number; sources: { status: string; targetNew: number; newFound: number; eligibleExamined: number; knownSkipped: number; sourceAccount: { username: string } }[] };
type CollectionStatus = { active: CollectionRun | null; latest: CollectionRun | null };

export function CollectionProgress() {
  const [status, setStatus] = useState<CollectionStatus | null>(null);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try { const response = await fetch("/api/collection-status", { cache: "no-store" }); if (active) setStatus(await response.json()); } catch { /* The page remains usable if polling fails. */ }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, 1_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  const run = status?.active ?? status?.latest;
  if (!run) return null;
  const percent = run.totalSources === 0 ? 0 : Math.round(run.completedSources / run.totalSources * 100);
  if (run.status === "RUNNING") {
    const source = run.sources.find((item) => item.status === "RUNNING");
    const sourcePercent = source ? Math.min(100, Math.round(source.newFound / Math.max(source.targetNew, 1) * 100)) : 0;
    return <div className="collection-progress" role="status"><div><strong>{run.cancelRequestedAt ? "Cancelling" : "Collecting"} {run.completedSources}/{run.totalSources} sources</strong><small>{run.currentSource ? `Reading @${run.currentSource}` : "Opening X session"}</small></div><div className="progress-track" role="progressbar" aria-label="Source progress" aria-valuemin={0} aria-valuemax={run.totalSources} aria-valuenow={run.completedSources}><span style={{ width: `${percent}%` }} /></div>{source && <div className="post-progress"><strong>@{source.sourceAccount.username}: {source.newFound} / {source.targetNew} new posts</strong><small>{source.eligibleExamined} eligible examined · {source.knownSkipped} previously collected</small><div className="progress-track" role="progressbar" aria-label="New post progress" aria-valuemin={0} aria-valuemax={source.targetNew} aria-valuenow={source.newFound}><span style={{ width: `${sourcePercent}%` }} /></div></div>}<small className="collection-totals">{run.newFound} / {run.targetNew} new posts · {run.knownSkipped} previously collected · {run.inserted} inserted</small>{!run.cancelRequestedAt && <form action={cancelCollection}><input type="hidden" name="runId" value={run.id} /><button className="small-button danger-button" type="submit">Cancel after current source</button></form>}</div>;
  }
  if (run.status === "BUSY") return <p className="error-line">{run.lastError}</p>;
  return null;
}

type DownloadStatus = {
  run: { status: string; processed: number; limit: number } | null;
  active: { id: string; sourcePost: { platformPostId: string; sourceAccount: { username: string } } }[];
};

export function DownloadProgress() {
  const [status, setStatus] = useState<DownloadStatus | null>(null);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try { const response = await fetch("/api/download-status", { cache: "no-store" }); if (active) setStatus(await response.json()); } catch { /* The queue remains usable if polling fails. */ }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, 1_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  if (!status?.run || status.run.status !== "RUNNING") return null;
  const percent = Math.min(100, Math.round(status.run.processed / Math.max(status.run.limit, 1) * 100));
  return <div className="collection-progress download-progress" role="status"><div><strong>Downloading {status.run.processed} / {status.run.limit}</strong><small>{status.active.length > 0 ? `${status.active.length} active` : "Preparing next download"}</small></div><div className="progress-track" role="progressbar" aria-label="Download progress" aria-valuemin={0} aria-valuemax={status.run.limit} aria-valuenow={status.run.processed}><span style={{ width: `${percent}%` }} /></div>{status.active.length > 0 && <small className="collection-totals">{status.active.map((job) => `@${job.sourcePost.sourceAccount.username} · ${job.sourcePost.platformPostId}`).join("  |  ")}</small>}</div>;
}

export function CollectionButton({ children, className = "small-button accent-button" }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try { const response = await fetch("/api/collection-status", { cache: "no-store" }); const status: CollectionStatus = await response.json(); if (active) setBusy(status.active?.status === "RUNNING"); } catch { /* Preserve action availability on transient polling failures. */ }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, 1_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  return <button className={className} type="submit" disabled={pending || busy}>{pending ? "Collecting…" : busy ? "Browser busy" : children}</button>;
}

type Action = (formData: FormData) => Promise<void>;
export function ActionForm({ action, children, className, success, id }: { action: Action; children: React.ReactNode; className?: string; success?: string; id?: string }) {
  return <form id={id} action={action} className={className}>{children}{success && <span className="sr-only">{success}</span>}</form>;
}

export function PostPerformanceReport({ publishedPostId, result }: { publishedPostId: string; result?: { error?: string; metrics?: PostMetrics; fetchedAt?: string } }) {
  const format = (value: number | null) => value === null ? "—" : new Intl.NumberFormat().format(value);
  return <div className="post-report">
    <form action={fetchPostPerformance}><input type="hidden" name="publishedPostId" value={publishedPostId} /><SubmitButton pending="Fetching…">{result?.metrics ? "Refresh performance" : "Fetch performance"}</SubmitButton></form>
    {result?.error && <div className="toast error" role="alert">{result.error}</div>}
    {result?.metrics && <><dl className="post-metrics"><div><dt>Replies</dt><dd>{format(result.metrics.replies)}</dd></div><div><dt>Reposts</dt><dd>{format(result.metrics.reposts)}</dd></div><div><dt>Likes</dt><dd>{format(result.metrics.likes)}</dd></div><div><dt>Bookmarks</dt><dd>{format(result.metrics.bookmarks)}</dd></div><div><dt>Views</dt><dd>{format(result.metrics.views)}</dd></div></dl><small>Fetched {result.fetchedAt ? new Date(result.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "now"} · not stored</small></>}
  </div>;
}

export function DiagnosticGallery({ images }: { images: string[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  return <><div className="diagnostic-grid">{images.map((image) => <button className="diagnostic-thumb" type="button" key={image} onClick={() => setSelected(image)}><img src={`/diagnostics/${encodeURIComponent(image)}`} alt={`Diagnostic screenshot ${image}`} /><small>{image}</small></button>)}</div>{selected && <div className="lightbox" role="dialog" aria-modal="true" aria-label={`Diagnostic screenshot ${selected}`} onClick={() => setSelected(null)}><button className="lightbox-close" type="button" onClick={() => setSelected(null)}>Close preview</button><img src={`/diagnostics/${encodeURIComponent(selected)}`} alt={`Diagnostic screenshot ${selected}`} onClick={(event) => event.stopPropagation()} /></div>}</>;
}
