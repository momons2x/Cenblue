import { confirmPublishedAndRemoveMedia, recoverIncorrectPublishedPost } from "../actions";
import { ActionForm, ConfirmSubmitButton, PostPerformanceReport } from "../controls";
import { ExpandableText } from "../expandable-text";
import { getPublished, getSettings } from "../lib/data";
import { formatInTimeZone } from "../lib/schedule";
import { Empty, Shell } from "../ui";
import type { PostMetrics } from "@cenblu/collector";

export const dynamic = "force-dynamic";

type PublishedParams = { performance?: string; performanceError?: string; actionError?: string; fetchedAt?: string; replies?: string; reposts?: string; likes?: string; bookmarks?: string; views?: string };

export default async function PublishedPage({ searchParams }: { searchParams: Promise<PublishedParams> }) {
  const params = await searchParams;
  const [records, settings] = await Promise.all([getPublished(), getSettings()]);
  return <Shell title="Published" eyebrow="Cenblue / output archive">
    {params.actionError && <div className="toast error" role="alert">{params.actionError}</div>}
    <section className="panel">
      <div className="panel-head"><div><p className="eyebrow">Publication history</p><h3>{records.length} published post{records.length === 1 ? "" : "s"}</h3></div></div>
      {records.length === 0 ? <Empty>Successful publications will be archived here.</Empty> : <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,19rem),1fr))] gap-4">{records.map((record) => {
        const asset = record.publishJob.mediaAsset;
        const performance = params.performance === record.id ? { error: params.performanceError, fetchedAt: params.fetchedAt, metrics: params.performanceError ? undefined : ({ replies: parseMetric(params.replies), reposts: parseMetric(params.reposts), likes: parseMetric(params.likes), bookmarks: parseMetric(params.bookmarks), views: parseMetric(params.views) } satisfies PostMetrics) } : undefined;
        return <article className="grid min-w-0 content-start gap-4 rounded-sm border border-line bg-surface p-5 text-ink" key={record.id}>
          <header className="flex min-w-0 items-start justify-between gap-3 border-b border-line pb-3"><div className="min-w-0"><span className="block text-[9px] font-semibold uppercase tracking-[.12em] text-muted">Published</span><time className="mt-1 block [overflow-wrap:anywhere] text-sm font-semibold" dateTime={record.publishedAt.toISOString()}>{formatInTimeZone(record.publishedAt, settings.timezone)}</time></div>{record.platformUrl && <a className="text-link shrink-0" href={record.platformUrl} target="_blank" rel="noreferrer">Open post ↗</a>}</header>
          <div className="min-w-0"><span className="text-[9px] font-semibold uppercase tracking-[.12em] text-muted">Caption</span><ExpandableText className="mt-1 text-[13px] leading-relaxed text-ink" lines={3}>{record.publishJob.caption || "No caption"}</ExpandableText></div>
          <dl className="m-0 grid grid-cols-2 border-y border-line"><div className="min-w-0 py-3"><dt className="text-[9px] uppercase tracking-wider text-muted">Media</dt><dd className="m-0 mt-1 text-sm font-semibold">{(asset.fileSize / 1_000_000).toFixed(1)} MB</dd></div><div className="min-w-0 border-l border-line py-3 pl-3"><dt className="text-[9px] uppercase tracking-wider text-muted">Resolution</dt><dd className="m-0 mt-1 text-sm font-semibold">{asset.width}x{asset.height}</dd></div></dl>
          <div className="min-w-0 text-[11px] text-muted"><span className="block">{asset.localRemovedAt ? `Media deleted locally · ${(asset.fileSize / 1_000_000).toFixed(1)} MB reclaimed` : "Media stored locally"}</span><a className="mt-1 block [overflow-wrap:anywhere] text-accent-text hover:underline" href={record.publishJob.sourcePost.sourceUrl} target="_blank" rel="noreferrer">Source X post ↗</a></div>
          {record.platformUrl && <PostPerformanceReport publishedPostId={record.id} result={performance} />}
          {!asset.localRemovedAt && <div className="mt-auto grid gap-2 border-t border-line pt-4">
            <ActionForm action={confirmPublishedAndRemoveMedia}><input type="hidden" name="sourcePostId" value={record.publishJob.sourcePostId} /><ConfirmSubmitButton message="Confirm this post is live on X, then permanently delete its local video and thumbnail? The publication record and X link will be kept." pendingLabel="Deleting…">Confirm published and delete media</ConfirmSubmitButton></ActionForm>
            <ActionForm action={recoverIncorrectPublishedPost}><input type="hidden" name="publishJobId" value={record.publishJobId} /><ConfirmSubmitButton message="First delete the incorrect post from X. Confirm it is deleted and return this item to Review with the same media and caption?">Recover incorrect post</ConfirmSubmitButton></ActionForm>
          </div>}
        </article>;
      })}</div>}
    </section>
  </Shell>;
}

function parseMetric(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
