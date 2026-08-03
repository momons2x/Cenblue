import Link from "next/link";
import { Navigation, RefreshButton, ThemeToggle } from "./controls";

export const navItems = [
  ["Overview", "/"], ["Sources", "/sources"], ["Compose", "/compose"], ["Review", "/review"], ["Queue", "/queue"], ["Downloads", "/downloads"], ["Videos", "/videos"], ["Published", "/published"], ["Logs", "/logs"], ["Settings", "/settings"],
] as const;

const pageDescriptions: Record<string, string> = {
  Overview: "A clear view of what Cenblue is doing right now.",
  Sources: "Accounts, collection rules, and incoming material.",
  Compose: "Publish an original text or image post without leaving the workspace.",
  "Content review": "Shape each post before it enters the publishing queue.",
  Queue: "Durable download and publishing work, ordered and accountable.",
  Downloads: "Validated media held in the local workspace.",
  "Video vault": "Browse the local archive or let chance choose the next five.",
  Published: "A permanent record of output and post performance.",
  Logs: "Operational detail for collection, processing, and publishing.",
  Settings: "Control cadence, identity, captions, and runtime behavior.",
};

export function Shell({ children, title, eyebrow }: { children: React.ReactNode; title: string; eyebrow?: string }) {
  return <div className="app-shell"><a className="skip-link" href="#main-content">Skip to content</a><aside className="sidebar"><Link className="brand" href="/"><span className="brand-mark" aria-hidden="true">C</span><span><strong>Cenblue</strong><small>Editorial operations</small></span></Link><p className="side-label">Workspace</p><Navigation items={navItems} /><div className="side-foot"><span className="pulse" aria-hidden="true" />Local workspace<br /><small>SQLite · private by default</small></div></aside><main id="main-content" className="main"><header className="page-head"><div className="page-title-group"><p className="eyebrow">{eyebrow ?? "Cenblue / local pipeline"}</p><h1>{title}<span aria-hidden="true">.</span></h1><p className="page-description">{pageDescriptions[title] ?? "A focused workspace for the local publishing pipeline."}</p></div><div className="head-actions"><ThemeToggle /><RefreshButton /><div className="head-status"><span className="pulse" aria-hidden="true" />Dashboard ready</div></div></header>{children}</main></div>;
}

export function Badge({ value }: { value: string | null | undefined }) {
  const toneByStatus: Record<string, string> = {
    FAILED: "danger", MANUAL_ATTENTION: "danger", REJECTED: "danger", ERROR: "danger", CANCELLED: "neutral",
    PENDING: "warn", RETRY_WAIT: "warn", RUNNING: "warn", DOWNLOADING: "warn", PUBLISHING: "warn", READY_FOR_REVIEW: "warn", APPROVED: "warn", WARN: "warn",
    COMPLETED: "good", DOWNLOADED: "good", PUBLISHED: "good", ENABLED: "good", AVAILABLE: "good",
  };
  const tone = toneByStatus[value ?? ""] ?? "neutral";
  return <span className={`badge ${tone}`}>{(value ?? "unknown").replaceAll("_", " ")}</span>;
}

export function Stat({ label, value, detail, accent = "blue" }: { label: string; value: number | string; detail?: string; accent?: string }) {
  return <div className={`stat-card ${accent}`}><p>{label}</p><strong>{value}</strong>{detail && <small>{detail}</small>}</div>;
}

export function Empty({ children }: { children: React.ReactNode }) { return <div className="empty"><span className="empty-icon">∅</span><p>{children}</p></div>; }

export function FormMessage({ children }: { children: React.ReactNode }) { return <p className="form-note">{children}</p>; }
