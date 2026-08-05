import { getOverview } from "./lib/data";
import { Badge, Empty, Shell, Stat } from "./ui";
import { ExpandableText } from "./expandable-text";

export const dynamic = "force-dynamic";

function formatDate(value: Date | null, timeZone: string) { return value ? new Intl.DateTimeFormat("en", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(value) : "Never"; }

export default async function Home() {
  const data = await getOverview();
  const reminder = data.todayPosts < data.dailyMinimum ? `${data.todayPosts} of ${data.dailyMinimum} minimum posts completed today.` : data.todayPosts < data.dailyPreferred ? `Daily minimum reached. ${data.todayPosts} of ${data.dailyPreferred} preferred posts completed.` : data.todayPosts === data.dailyPreferred ? `Preferred daily goal reached: ${data.todayPosts} posts.` : `${data.todayPosts} posts today, above the preferred goal of ${data.dailyPreferred}.`;
  return <Shell title="Overview" eyebrow="Cenblue / control room">
    <section className="hero"><div className="min-w-0"><p className="kicker">Local-first repost pipeline</p><h2 className="[overflow-wrap:anywhere]">Keep the signal moving.</h2><p className="muted [overflow-wrap:anywhere]">{reminder}</p></div><div className="hero-orbit" aria-hidden="true"><span /><span /><span /></div></section>
    <div className="mb-5 grid grid-cols-2 gap-3 max-[360px]:grid-cols-1 lg:grid-cols-4"><Stat label="Published today" value={data.todayPosts} detail={`goal ${data.dailyMinimum}-${data.dailyPreferred}`} accent="mint" /><Stat label="Enabled sources" value={data.enabledSources} detail="configured accounts" accent="blue" /><Stat label="Pending downloads" value={data.pendingDownloads} detail={`${data.failedDownloads} failed`} accent="orange" /><Stat label="Scheduled publishes" value={data.scheduledPublishes} detail={`${data.failedPublishes} need attention`} accent="mint" /></div>
    <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,.7fr)]">
      <section className="panel min-w-0"><div className="panel-head"><div><p className="eyebrow">Recent output</p><h3>Published posts</h3></div><a className="text-link" href="/published">View all →</a></div>{data.recentPublished.length === 0 ? <Empty>No published posts yet.</Empty> : <div className="grid min-w-0">{data.recentPublished.map((record) => <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 border-t border-line py-4" key={record.id}><div className="feed-icon" aria-hidden="true">↗</div><div className="min-w-0"><ExpandableText className="text-sm font-semibold text-ink" lines={2}>{record.publishJob.sourcePost.text || "Untitled post"}</ExpandableText><small className="mt-1 block text-xs text-muted">{formatDate(record.publishedAt, data.timezone)}</small></div><Badge value="PUBLISHED" /></div>)}</div>}</section>
      <section className="panel min-w-0"><div className="panel-head"><div><p className="eyebrow">Activity summary</p><h3>Local runtime</h3></div><Badge value={data.browserBusy ? "RUNNING" : "AVAILABLE"} /></div><div className="grid min-w-0 gap-4"><RuntimeLine tone="blue" label="Collector" value={data.collectionRun ? `${data.collectionRun.status.replaceAll("_", " ")} · ${data.collectionRun.completedSources}/${data.collectionRun.totalSources}` : `Last success ${formatDate(data.lastCollectedAt, data.timezone)}`} /><RuntimeLine tone="good" label="Publisher" value={data.publisherBrowserBusy ? "Publisher browser active" : data.browserBusy ? "Collector browser active" : "Browser profiles available"} /><RuntimeLine label="Goal" value={reminder} /></div></section>
    </div>
    <section className="panel"><div className="panel-head"><div><p className="eyebrow">Identity health</p><h3>Isolated X accounts</h3></div><a className="text-link" href="/settings">Manage identities →</a></div><div className="identity-health-grid">{data.identityHealth.map((identity) => <article className={identity.role === "COLLECTOR" ? "identity-health collector-health" : "identity-health publisher-health"} key={identity.id}><span>{identity.role === "COLLECTOR" ? "↓ Collector" : "↑ Publisher"}</span><strong>{identity.label}</strong><small>@{identity.expectedUsername ?? "unassigned"}</small><Badge value={identity.busy ? "RUNNING" : identity.verified ? "VERIFIED" : "NEEDS_VERIFY"} /></article>)}</div></section>
  </Shell>;
}

function RuntimeLine({ tone = "", label, value }: { tone?: string; label: string; value: string }) {
  return <div className="grid min-w-0 grid-cols-[12px_minmax(0,1fr)] items-center gap-x-2 text-xs text-muted"><span className={`health-dot row-span-2 ${tone}`} />{label}<strong className="[overflow-wrap:anywhere] text-sm text-ink">{value}</strong></div>;
}
