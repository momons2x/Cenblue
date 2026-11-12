import { getLogs, getRuntimeSettings } from "../lib/data";
import { formatInTimeZone } from "../lib/schedule";
import { DiagnosticGallery } from "../controls";
import { Badge, Empty, Shell } from "../ui";

export const dynamic = "force-dynamic";

export default async function LogsPage({ searchParams }: { searchParams: Promise<{ level?: string; component?: string }> }) {
  const params = await searchParams;
  const [{ entries, images, components }, settings] = await Promise.all([getLogs(params), getRuntimeSettings()]);
  const errorCount = entries.filter((entry) => entry.level === "ERROR").length;
  const warnCount = entries.filter((entry) => entry.level === "WARN").length;
  return <Shell title="Logs" eyebrow="Cenblue / diagnostics">
    <form className="queue-filters" method="get"><label>Level<select name="level" defaultValue={params.level ?? ""}><option value="">All levels</option><option value="ERROR">Error</option><option value="WARN">Warning</option><option value="INFO">Info</option><option value="DEBUG">Debug</option></select></label><label>Component<select name="component" defaultValue={params.component ?? ""}><option value="">All components</option>{components.map((component) => <option key={component} value={component}>{component}</option>)}</select></label><button className="small-button accent-button" type="submit">Filter logs</button>{(params.level || params.component) && <a className="small-button" href="/logs">Clear</a>}</form>
    <section className="panel">
      <div className="panel-head"><div><p className="eyebrow">Bounded local records</p><h3>Recent diagnostics</h3></div><span className="count-chip">{errorCount} errors · {warnCount} warnings · latest 250</span></div>
      {entries.length === 0 ? <Empty>No matching log events found.</Empty> : <div className="structured-logs">{entries.map((entry, index) => <article key={`${entry.file}-${index}`} className={`log-entry ${entry.level.toLowerCase()}`}><Badge value={entry.level} /><div><strong>{entry.message}</strong><small>{entry.component}{entry.operation ? ` · ${entry.operation}` : ""} · {entry.timestamp ? formatInTimeZone(entry.timestamp, settings.timezone) : entry.file}</small></div></article>)}</div>}
    </section>
    {images.length > 0 && <section className="panel"><div className="panel-head"><div><p className="eyebrow">Playwright evidence</p><h3>Diagnostic screenshots</h3></div></div><DiagnosticGallery images={images} /></section>}
  </Shell>;
}
