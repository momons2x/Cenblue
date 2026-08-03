import { getLogs } from "../lib/data";
import { Badge, Empty, Shell } from "../ui";
import { DiagnosticGallery } from "../controls";

export const dynamic = "force-dynamic";

export default async function LogsPage({ searchParams }: { searchParams: Promise<{ level?: string; component?: string }> }) {
  const params = await searchParams;
  const { entries, images, components } = await getLogs(params);
  return <Shell title="Logs" eyebrow="Cenblue / diagnostics"><form className="queue-filters" method="get"><label>Level<select name="level" defaultValue={params.level ?? ""}><option value="">All levels</option><option value="ERROR">Error</option><option value="WARN">Warning</option><option value="INFO">Info</option><option value="DEBUG">Debug</option></select></label><label>Component<select name="component" defaultValue={params.component ?? ""}><option value="">All components</option>{components.map((component) => <option key={component} value={component}>{component}</option>)}</select></label><button className="small-button accent-button" type="submit">Filter logs</button>{(params.level || params.component) && <a className="small-button" href="/logs">Clear</a>}</form><section className="panel"><div className="panel-head"><div><p className="eyebrow">Bounded local records</p><h3>Recent diagnostics</h3></div><span className="count-chip">latest 250 events</span></div>{entries.length === 0 ? <Empty>No matching log events found.</Empty> : <div className="structured-logs">{entries.map((entry, index) => <article key={`${entry.file}-${index}`} className={`log-entry ${entry.level.toLowerCase()}`}><Badge value={entry.level} /><div><strong>{entry.message}</strong><small>{entry.component}{entry.operation ? ` · ${entry.operation}` : ""} · {entry.timestamp ? new Date(entry.timestamp).toLocaleString() : entry.file}</small></div></article>)}</div>}</section>{images.length > 0 && <section className="panel"><div className="panel-head"><div><p className="eyebrow">Playwright evidence</p><h3>Diagnostic screenshots</h3></div></div><DiagnosticGallery images={images} /></section>}</Shell>;
}
