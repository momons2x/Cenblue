import { getLogs, getOperationalEvents, getRuntimeSettings } from "../lib/data";
import { formatInTimeZone } from "../lib/schedule";
import { DiagnosticGallery } from "../controls";
import { Badge, Empty, Shell } from "../ui";

export const dynamic = "force-dynamic";

export default async function LogsPage({ searchParams }: { searchParams: Promise<{ level?: string; component?: string }> }) {
  const params = await searchParams;
  const [{ entries, images, components }, events, settings] = await Promise.all([getLogs(params), getOperationalEvents(params), getRuntimeSettings()]);
  const errorCount = entries.filter((entry) => entry.level === "ERROR").length;
  const warnCount = entries.filter((entry) => entry.level === "WARN").length;
  const eventErrors = events.filter((event) => event.severity === "ERROR" || event.severity === "CRITICAL").length;
  return <Shell title="Logs" eyebrow="Cenblue / diagnostics">
    <form className="queue-filters" method="get"><label>Level<select name="level" defaultValue={params.level ?? ""}><option value="">All levels</option><option value="ERROR">Error</option><option value="WARN">Warning</option><option value="INFO">Info</option><option value="DEBUG">Debug</option></select></label><label>Component<select name="component" defaultValue={params.component ?? ""}><option value="">All components</option>{components.map((component) => <option key={component} value={component}>{component}</option>)}</select></label><button className="small-button accent-button" type="submit">Filter logs</button>{(params.level || params.component) && <a className="small-button" href="/logs">Clear</a>}</form>
    <section className="panel">
      <div className="panel-head"><div><p className="eyebrow">Correlated records</p><h3>Operational events</h3></div><span className="count-chip">{events.length} latest · {eventErrors} failed</span></div>
      {events.length === 0 ? <Empty>No operational events recorded yet. Publish attempts and other tracked operations appear here.</Empty> : <div className="structured-logs">{events.map((event) => <article key={event.id} className={`log-entry ${event.severity === "CRITICAL" || event.severity === "ERROR" ? "error" : event.severity === "WARN" ? "warn" : "info"}`}><Badge value={event.severity} /><div><strong>{event.type}</strong><p className="whitespace-pre-line text-xs leading-relaxed">{event.message}</p><small>{event.component}{event.operationId ? ` · operation ${event.operationId}` : ""} · {formatInTimeZone(event.createdAt, settings.timezone)}</small></div></article>)}</div>}
    </section>
    <section className="panel">
      <div className="panel-head"><div><p className="eyebrow">Bounded local records</p><h3>Recent diagnostics</h3></div><span className="count-chip">{errorCount} errors · {warnCount} warnings · latest 250</span></div>
      {entries.length === 0 ? <Empty>No matching log events found.</Empty> : <div className="structured-logs">{entries.map((entry, index) => <article key={`${entry.file}-${index}`} className={`log-entry ${entry.level.toLowerCase()}`}><Badge value={entry.level} /><div><strong>{entry.message}</strong><small>{entry.component}{entry.operation ? ` · ${entry.operation}` : ""} · {entry.timestamp ? formatInTimeZone(entry.timestamp, settings.timezone) : entry.file}</small></div></article>)}</div>}
    </section>
    {images.length > 0 && <section className="panel"><div className="panel-head"><div><p className="eyebrow">Playwright evidence</p><h3>Diagnostic screenshots</h3></div></div><DiagnosticGallery images={images} /></section>}
  </Shell>;
}
