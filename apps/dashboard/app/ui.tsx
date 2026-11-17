import Link from "next/link";
import { cookies } from "next/headers";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "@cenblu/config";
import { logout } from "./actions";
import { Navigation, RefreshButton, ThemeToggle, DownloadProgress, LiveRefresh, SubmitButton, type NavItem } from "./controls";
import { AUTH_COOKIE, authPassword, verifyAuthValue } from "./lib/auth";
import { formatNumber } from "./lib/format";
export { Badge, Empty, FlashNotice, FormMessage, Stat } from "./ui-primitives";

export const navGroups: { label: string; items: NavItem[] }[] = [
  { label: "Workspace", items: [{ label: "Overview", href: "/" }, { label: "Sources", href: "/sources" }, { label: "Compose", href: "/compose" }, { label: "Review", href: "/review", count: "review" }] },
  { label: "Operations", items: [{ label: "Queue", href: "/queue", count: "queue" }, { label: "Downloads", href: "/downloads" }, { label: "Videos", href: "/videos" }, { label: "Published", href: "/published" }] },
  { label: "System", items: [{ label: "Logs", href: "/logs" }, { label: "Settings", href: "/settings" }] },
];

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

async function appVersion(): Promise<string> {
  try {
    const manifest: { version?: string } = JSON.parse(await readFile(resolve(loadConfig().repositoryRoot, "package.json"), "utf8"));
    return manifest.version ?? "unknown";
  } catch { return "unknown"; }
}

export function Pagination({ page, pageSize, total, basePath, params = {} }: { page: number; pageSize: number; total: number; basePath: string; params?: Record<string, string | undefined> }) {
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  if (pages <= 1) return null;
  const href = (target: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
    if (target > 1) query.set("page", String(target));
    const search = query.toString();
    return search ? `${basePath}?${search}` : basePath;
  };
  return <nav className="queue-pagination" aria-label="Pagination">{page > 1 && <Link className="small-button" href={href(page - 1)}>Previous</Link>}<span>Page {Math.min(page, pages)} of {pages} · {formatNumber(total)} total</span>{page < pages && <Link className="small-button" href={href(page + 1)}>Next</Link>}</nav>;
}

export async function Shell({ children, title, eyebrow, variant = "compact" }: { children: React.ReactNode; title: string; eyebrow?: string; variant?: "editorial" | "compact" }) {
  const version = await appVersion();
  const password = authPassword();
  const signedIn = Boolean(password && await verifyAuthValue((await cookies()).get(AUTH_COOKIE)?.value, password));
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="sidebar">
        <Link className="brand" href="/"><span className="brand-mark" aria-hidden="true">C</span><span><strong>Cenblue</strong><small>Editorial operations</small></span></Link>
        <Navigation groups={navGroups} />
        <div className="side-foot"><span className="pulse" aria-hidden="true" />Local workspace<br /><small>v{version} · SQLite · private by default</small></div>
      </aside>
      <main id="main-content" className={variant === "editorial" ? "main" : "main compact"}>
        <header className="page-head min-w-0 gap-5 max-[850px]:flex-col">
          <div className="page-title-group min-w-0"><p className="eyebrow">{eyebrow ?? "Cenblue / local pipeline"}</p><h1 className="[overflow-wrap:anywhere]">{title}<span aria-hidden="true">.</span></h1><p className="page-description [overflow-wrap:anywhere]">{pageDescriptions[title] ?? "A focused workspace for the local publishing pipeline."}</p></div>
          <div className="head-actions min-w-0 flex-wrap max-[850px]:w-full">{signedIn && <form action={logout}><SubmitButton className="small-button" pending="Signing out…">Sign out</SubmitButton></form>}<ThemeToggle /><RefreshButton /><div className="head-status max-[850px]:hidden"><span className="pulse" aria-hidden="true" />Dashboard ready</div></div>
        </header>
        <DownloadProgress />
        <LiveRefresh />
        {children}
      </main>
    </div>
  );
}
