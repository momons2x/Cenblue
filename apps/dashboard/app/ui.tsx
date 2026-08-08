import Link from "next/link";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "@cenblu/config";
import { Navigation, RefreshButton, ThemeToggle, DownloadProgress } from "./controls";
export { Badge, Empty, FormMessage, Stat } from "./ui-primitives";

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

async function appVersion(): Promise<string> {
  try {
    const manifest: { version?: string } = JSON.parse(await readFile(resolve(loadConfig().repositoryRoot, "package.json"), "utf8"));
    return manifest.version ?? "unknown";
  } catch { return "unknown"; }
}

export async function Shell({ children, title, eyebrow }: { children: React.ReactNode; title: string; eyebrow?: string }) {
  const version = await appVersion();
  return <div className="app-shell"><a className="skip-link" href="#main-content">Skip to content</a><aside className="sidebar"><Link className="brand" href="/"><span className="brand-mark" aria-hidden="true">C</span><span><strong>Cenblue</strong><small>Editorial operations</small></span></Link><p className="side-label">Workspace</p><Navigation items={navItems} /><div className="side-foot"><span className="pulse" aria-hidden="true" />Local workspace<br /><small>v{version} · SQLite · private by default</small></div></aside><main id="main-content" className="main"><header className="page-head min-w-0 gap-5 max-[850px]:flex-col"><div className="page-title-group min-w-0"><p className="eyebrow">{eyebrow ?? "Cenblue / local pipeline"}</p><h1 className="[overflow-wrap:anywhere]">{title}<span aria-hidden="true">.</span></h1><p className="page-description [overflow-wrap:anywhere]">{pageDescriptions[title] ?? "A focused workspace for the local publishing pipeline."}</p></div><div className="head-actions min-w-0 flex-wrap max-[850px]:w-full"><ThemeToggle /><RefreshButton /><div className="head-status max-[850px]:hidden"><span className="pulse" aria-hidden="true" />Dashboard ready</div></div></header><DownloadProgress />{children}</main></div>;
}
