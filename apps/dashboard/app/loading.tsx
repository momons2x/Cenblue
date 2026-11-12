import Link from "next/link";
import { Navigation } from "./controls";
import { navGroups } from "./ui";

export default function Loading() {
  return (
    <div className="app-shell" aria-busy="true">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="sidebar">
        <Link className="brand" href="/"><span className="brand-mark" aria-hidden="true">C</span><span><strong>Cenblue</strong><small>Editorial operations</small></span></Link>
        <Navigation groups={navGroups} />
        <div className="side-foot"><span className="pulse" aria-hidden="true" />Loading workspace…</div>
      </aside>
      <main id="main-content" className="main compact">
        <header className="page-head">
          <div className="page-title-group"><p className="eyebrow">Cenblue / loading</p><h1>Reading<span aria-hidden="true">.</span></h1><p className="page-description">Fetching the latest local state.</p></div>
        </header>
        <div className="skeleton-stack" aria-hidden="true">
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-stat" />
          <div className="skeleton skeleton-block" />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line" />
        </div>
        <span className="sr-only" role="status">Loading dashboard</span>
      </main>
    </div>
  );
}
