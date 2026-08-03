import { confirmPublishedAndRemoveMedia, recoverIncorrectPublishedPost } from "../actions";
import { ActionForm, ConfirmSubmitButton, PostPerformanceReport } from "../controls";
import { getPublished } from "../lib/data";
import { Empty, Shell } from "../ui";
import type { PostMetrics } from "@cenblu/collector";

export const dynamic = "force-dynamic";

type PublishedParams = { performance?: string; performanceError?: string; actionError?: string; fetchedAt?: string; replies?: string; reposts?: string; likes?: string; bookmarks?: string; views?: string };

export default async function PublishedPage({ searchParams }: { searchParams: Promise<PublishedParams> }) {
  const params = await searchParams;
  const records = await getPublished();
  return <Shell title="Published" eyebrow="Cenblue / output archive">
    {params.actionError && <div className="toast error" role="alert">{params.actionError}</div>}
    <section className="panel">
      <div className="panel-head"><div><p className="eyebrow">Publication history</p><h3>{records.length} published post{records.length === 1 ? "" : "s"}</h3></div></div>
      {records.length === 0 ? <Empty>Successful publications will be archived here.</Empty> : <div className="published-list">{records.map((record) => {
        const asset = record.publishJob.mediaAsset;
        return <article className="published-row" key={record.id}>
          <div className="published-date"><strong>{new Date(record.publishedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</strong><small>{new Date(record.publishedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></div>
          <div className="published-copy"><strong>{record.publishJob.caption || "No caption"}</strong><small>Source: <a href={record.publishJob.sourcePost.sourceUrl} target="_blank" rel="noreferrer">{record.publishJob.sourcePost.sourceUrl}</a></small></div>
          <div className="published-links">
            {record.platformUrl && <a className="text-link" href={record.platformUrl} target="_blank" rel="noreferrer">Open post ↗</a>}
            {record.platformUrl && <PostPerformanceReport publishedPostId={record.id} result={params.performance === record.id ? { error: params.performanceError, fetchedAt: params.fetchedAt, metrics: params.performanceError ? undefined : ({ replies: parseMetric(params.replies), reposts: parseMetric(params.reposts), likes: parseMetric(params.likes), bookmarks: parseMetric(params.bookmarks), views: parseMetric(params.views) } satisfies PostMetrics) } : undefined} />}
            <small>{asset.localRemovedAt ? `Media deleted locally · ${(asset.fileSize / 1_000_000).toFixed(1)} MB reclaimed` : `${asset.width}x${asset.height} · ${(asset.fileSize / 1_000_000).toFixed(1)} MB stored locally`}</small>
            {!asset.localRemovedAt && <div className="actions">
              <ActionForm action={confirmPublishedAndRemoveMedia}>
                <input type="hidden" name="sourcePostId" value={record.publishJob.sourcePostId} />
                <ConfirmSubmitButton message="Confirm this post is live on X, then permanently delete its local video and thumbnail? The publication record and X link will be kept." pendingLabel="Deleting…">Confirm published and delete media</ConfirmSubmitButton>
              </ActionForm>
              <ActionForm action={recoverIncorrectPublishedPost}>
                <input type="hidden" name="publishJobId" value={record.publishJobId} />
                <ConfirmSubmitButton message="First delete the incorrect post from X. Confirm it is deleted and return this item to Review with the same media and caption?">Recover incorrect post</ConfirmSubmitButton>
              </ActionForm>
            </div>}
          </div>
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
