import { downloadAgain, removeMedia, sendAllToReview, sendToReview } from "../actions";
import { ActionForm, ConfirmSubmitButton, SubmitButton } from "../controls";
import { getDownloads, getDownloadSources } from "../lib/data";
import { Badge, Empty, Shell } from "../ui";

export const dynamic = "force-dynamic";

export default async function DownloadsPage({ searchParams }: { searchParams: Promise<{ source?: string; actionError?: string }> }) {
  const params = await searchParams;
  const [downloads, sources] = await Promise.all([getDownloads(params.source), getDownloadSources()]);
  return <Shell title="Downloads" eyebrow="Cenblue / media library">
    {params.actionError && <div className="toast error" role="alert">{params.actionError}</div>}
    <form className="queue-filters" method="get"><label>Source<select name="source" defaultValue={params.source ?? ""}><option value="">All sources</option>{sources.map((source) => <option key={source.username} value={source.username}>@{source.username}</option>)}</select></label><button className="small-button accent-button" type="submit">Filter media</button>{params.source && <a className="small-button" href="/downloads">Clear</a>}</form>
    <section className="panel"><div className="panel-head"><div><p className="eyebrow">Validated local assets</p><h3>{downloads.length} video{downloads.length === 1 ? "" : "s"}</h3></div><ActionForm action={sendAllToReview}><SubmitButton>Send all eligible to review</SubmitButton></ActionForm></div>
      {downloads.length === 0 ? <Empty>No validated video assets match this filter.</Empty> : <div className="asset-grid">{downloads.map((asset) => {
        const publish = asset.sourcePost.publishJob;
        return <article className="asset-card" key={asset.id}>
          {asset.localRemovedAt ? <div className="asset-thumb placeholder">Removed locally</div> : <video className="asset-video" controls preload="none" aria-label={`Video from @${asset.sourcePost.sourceAccount.username}`} src={`/media/${asset.sourcePost.platformPostId}`} />}
          <div className="asset-content"><div className="asset-title"><strong>@{asset.sourcePost.sourceAccount.username}</strong><Badge value={publish?.status ?? asset.sourcePost.downloadJob?.status} /></div><p className="asset-caption">{asset.sourcePost.text || "No source caption"}</p><a className="text-link" href={asset.sourcePost.sourceUrl} target="_blank" rel="noreferrer">View original X post ↗</a><div className="asset-meta"><span>{(asset.fileSize / 1_000_000).toFixed(1)} MB</span><span>{asset.durationSeconds.toFixed(1)}s</span><span>{asset.width}x{asset.height}</span><span>{asset.sourcePost.discoveryKind === "BOOKMARK" ? "Bookmark" : "Profile"}</span></div><div className="actions">{asset.localRemovedAt ? <ActionForm action={downloadAgain}><input type="hidden" name="sourcePostId" value={asset.sourcePostId} /><SubmitButton>Download again</SubmitButton></ActionForm> : publish ? <a className="small-button" href={publish.publishedPost ? "/published" : publish.status === "READY_FOR_REVIEW" ? "/review" : "/queue"}>{publish.publishedPost ? "View published" : publish.status === "READY_FOR_REVIEW" ? "Open review" : "View queue"}</a> : <ActionForm action={sendToReview}><input type="hidden" name="sourcePostId" value={asset.sourcePostId} /><SubmitButton>Send to review</SubmitButton></ActionForm>} {!asset.localRemovedAt && <ActionForm action={removeMedia}><input type="hidden" name="sourcePostId" value={asset.sourcePostId} /><input type="hidden" name="returnPath" value="/downloads" /><ConfirmSubmitButton message={`Remove local media for X post ${asset.sourcePost.platformPostId}? The source post will remain tracked.`}>Remove media</ConfirmSubmitButton></ActionForm>}</div></div>
        </article>;
      })}</div>}
    </section>
  </Shell>;
}
