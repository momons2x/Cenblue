"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { approveReview, compressReviewVideo, rejectReview, resolveReviewCaption, returnToDownloads, saveReview } from "../actions";
import { ConfirmSubmitButton, SubmitButton } from "../controls";
import { Badge } from "../ui";

export type ReviewItem = {
  id: string;
  status: string;
  caption: string;
  scheduledFor: string | null;
  sourcePost: {
    platformPostId: string;
    sourceUrl: string;
    text: string;
    discoveryKind: string;
    reviewNotes: string | null;
    internalTags: string | null;
    username: string;
    duplicateReason: string | null;
  };
  mediaAsset: {
    fileSize: number;
    durationSeconds: number;
    width: number;
    height: number;
    compressed: boolean;
  };
};

function localDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function ReviewSaveButtons() {
  const { pending } = useFormStatus();
  return <div className="review-dialog-primary-actions">
    <button className="small-button" type="submit" disabled={pending}>{pending ? "Saving..." : "Save draft"}</button>
    <button className="small-button accent-button" type="submit" formAction={approveReview} disabled={pending}>{pending ? "Saving..." : "Save and approve"}</button>
  </div>;
}

export function ReviewList({ jobs }: { jobs: ReviewItem[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const selected = jobs.find((job) => job.id === selectedId);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (selected && !dialog.open) dialog.showModal();
    if (!selected && dialog.open) dialog.close();
  }, [selected]);

  const close = () => {
    dialogRef.current?.close();
    setSelectedId(null);
  };

  return <>
    <div className="review-card-grid">{jobs.map((job) => <article className="review-summary-card" key={job.id}>
      <label className="review-card-select"><input form="bulk-review" type="checkbox" name="publishJobId" value={job.id} /><span>Select</span></label>
      <dl className="review-card-stats"><div><dt>Size</dt><dd>{(job.mediaAsset.fileSize / 1_000_000).toFixed(1)} MB</dd></div><div><dt>Duration</dt><dd>{job.mediaAsset.durationSeconds.toFixed(1)}s</dd></div></dl>
      <div className="review-card-caption"><span>Caption</span><p>{job.caption || "No caption"}</p></div>
      <button className="small-button accent-button" type="button" onClick={() => setSelectedId(job.id)}>Open review</button>
    </article>)}</div>

    <dialog ref={dialogRef} className="review-dialog" onClose={() => setSelectedId(null)} onCancel={() => setSelectedId(null)} onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
      {selected && <div className="review-dialog-shell">
        <header className="review-dialog-head"><div><p className="eyebrow">Review item</p><h2>@{selected.sourcePost.username}</h2></div><button className="icon-button" type="button" aria-label="Close review" onClick={close}>Close</button></header>
        <div className="review-dialog-layout">
          <aside className="review-dialog-media">
            <video controls preload="metadata" aria-label={`Video to review from @${selected.sourcePost.username}`} src={`/media/${selected.sourcePost.platformPostId}`} />
            <div className="review-dialog-meta"><Badge value={selected.status} /><span>{(selected.mediaAsset.fileSize / 1_000_000).toFixed(1)} MB</span><span>{selected.mediaAsset.durationSeconds.toFixed(1)}s</span><span>{selected.mediaAsset.width}x{selected.mediaAsset.height}</span></div>
            <a className="text-link" href={selected.sourcePost.sourceUrl} target="_blank" rel="noreferrer">Open original X post</a>
            <p className="form-note">Collected from {selected.sourcePost.discoveryKind === "BOOKMARK" ? "collector bookmarks" : "source profile"}.</p>
            <div className="review-source-caption"><small>Source caption</small><p>{selected.sourcePost.text || "No source caption"}</p></div>
          </aside>
          <section className="review-dialog-editor">
            <form action={saveReview} className="stack-form">
              <input type="hidden" name="publishJobId" value={selected.id} />
              <label>Caption<textarea name="caption" defaultValue={selected.caption} maxLength={280} required /></label>
              <label>Internal notes<textarea name="reviewNotes" defaultValue={selected.sourcePost.reviewNotes ?? ""} maxLength={2000} /></label>
              <label>Tags<input name="internalTags" defaultValue={selected.sourcePost.internalTags ?? ""} maxLength={500} /></label>
              <label>Schedule time (local, optional)<input name="scheduledFor" type="datetime-local" step="60" defaultValue={localDateTime(selected.scheduledFor)} /><small className="form-note">Leave empty to make this item immediately eligible for publishing.</small></label>
              <ReviewSaveButtons />
            </form>
            <div className="review-dialog-tools">
              <form action={resolveReviewCaption}><input type="hidden" name="publishJobId" value={selected.id} /><SubmitButton>Apply caption rules</SubmitButton></form>
              {selected.mediaAsset.compressed ? <button className="small-button" type="button" disabled>Already compressed</button> : <form action={compressReviewVideo}><input type="hidden" name="publishJobId" value={selected.id} /><SubmitButton pending="Compressing...">Compress video</SubmitButton></form>}
            </div>
            <p className="form-note">Compression creates a balanced H.264 MP4 and replaces the active file only when the result is smaller.</p>
            {selected.sourcePost.duplicateReason && <p className="error-line">Duplicate: {selected.sourcePost.duplicateReason}</p>}
            <div className="review-dialog-danger">
              <form action={rejectReview}><input type="hidden" name="publishJobId" value={selected.id} /><ConfirmSubmitButton message="Reject this content?">Reject</ConfirmSubmitButton></form>
              <form action={returnToDownloads}><input type="hidden" name="publishJobId" value={selected.id} /><ConfirmSubmitButton message="Return this review item to Downloads?">Return to Downloads</ConfirmSubmitButton></form>
            </div>
          </section>
        </div>
      </div>}
    </dialog>
  </>;
}
