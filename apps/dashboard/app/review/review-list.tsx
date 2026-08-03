"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { approveReview, compressReviewVideo, rejectReview, resolveReviewCaption, returnToDownloads, saveReview } from "../actions";
import { ConfirmSubmitButton, SubmitButton } from "../controls";
import { Badge } from "../ui";
import { ScheduleField } from "../schedule-field";
import { ExpandableText } from "../expandable-text";

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

function ReviewSaveButtons({ locked }: { locked: boolean }) {
  const { pending } = useFormStatus();
  return <div className="flex flex-wrap gap-2 pt-1">
    <button className="small-button" type="submit" disabled={pending || locked}>{pending ? "Saving..." : "Save draft"}</button>
    <button className="small-button accent-button" type="submit" formAction={approveReview} disabled={pending || locked}>{pending ? "Saving..." : "Save and approve"}</button>
  </div>;
}

function CompressionSubmit() {
  const { pending } = useFormStatus();
  return <div className="grid gap-2">
    <button className="small-button" type="submit" disabled={pending}>{pending ? "Compressing video..." : "Compress video"}</button>
    {pending && <div className="grid gap-1" role="status" aria-live="polite"><div className="h-1.5 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-label="Compressing and validating video"><span className="block h-full w-2/5 animate-[compression-progress_1.35s_ease-in-out_infinite] rounded-full bg-accent" /></div><small className="text-[11px] text-muted">Encoding, validating, and saving the smaller file. Keep this review open.</small></div>}
  </div>;
}

export function ReviewList({ jobs, timeZone }: { jobs: ReviewItem[]; timeZone: string }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const selected = jobs.find((job) => job.id === selectedId);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (selected && !dialog.open) dialog.showModal();
    if (!selected && dialog.open) dialog.close();
  }, [selected]);

  const close = () => {
    if (compressing) return;
    dialogRef.current?.close();
    setSelectedId(null);
  };

  return <>
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-4">{jobs.map((job) => <article className="grid min-h-64 min-w-0 content-start gap-4 rounded-sm border border-line bg-surface p-5 text-ink" key={job.id}>
      <label className="flex items-center gap-2 text-xs text-muted"><input form="bulk-review" type="checkbox" name="publishJobId" value={job.id} /><span>Select</span></label>
      <dl className="m-0 grid grid-cols-2 border-y border-line"><div className="min-w-0 py-3"><dt className="text-[9px] font-semibold uppercase tracking-[.12em] text-muted">Size</dt><dd className="m-0 mt-1 break-words text-xl font-semibold">{(job.mediaAsset.fileSize / 1_000_000).toFixed(1)} MB</dd></div><div className="min-w-0 border-l border-line py-3 pl-3"><dt className="text-[9px] font-semibold uppercase tracking-[.12em] text-muted">Duration</dt><dd className="m-0 mt-1 break-words text-xl font-semibold">{job.mediaAsset.durationSeconds.toFixed(1)}s</dd></div></dl>
      <div className="min-w-0"><span className="text-[9px] font-semibold uppercase tracking-[.12em] text-muted">Caption</span><ExpandableText className="mt-1 text-[13px] leading-relaxed text-ink" lines={3}>{job.caption || "No caption"}</ExpandableText></div>
      <button className="small-button mt-auto justify-self-start" type="button" onClick={() => setSelectedId(job.id)}>Open review</button>
    </article>)}</div>

    <dialog ref={dialogRef} className="m-auto max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-6xl overflow-auto rounded-sm border border-line bg-surface p-0 text-ink backdrop:bg-black/70" aria-labelledby={titleId} onClose={() => { setSelectedId(null); setCompressing(false); }} onCancel={(event) => { if (compressing) event.preventDefault(); else setSelectedId(null); }} onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
      {selected && <div className="min-w-0 p-5 sm:p-8 lg:p-10">
        <header className="sticky top-0 z-10 -mx-5 -mt-5 flex min-w-0 flex-wrap items-start justify-between gap-4 border-b border-line bg-surface px-5 py-5 sm:-mx-8 sm:-mt-8 sm:px-8 lg:-mx-10 lg:-mt-10 lg:px-10"><div className="min-w-0"><p className="eyebrow">Review item</p><h2 id={titleId} className="m-0 mt-1 [overflow-wrap:anywhere] text-3xl sm:text-5xl">@{selected.sourcePost.username}</h2></div><button className="small-button shrink-0" type="button" aria-label="Close review" disabled={compressing} onClick={close}>Close</button></header>
        <div className="grid min-w-0 gap-8 pt-7 lg:grid-cols-[minmax(0,.85fr)_minmax(0,1.15fr)] lg:gap-14">
          <aside className="min-w-0">
            <video className="block w-full bg-black" controls preload="metadata" aria-label={`Video to review from @${selected.sourcePost.username}`} src={`/media/${selected.sourcePost.platformPostId}`} />
            <div className="flex flex-wrap items-center gap-2 py-3 text-xs text-muted"><Badge value={selected.status} /><span>{(selected.mediaAsset.fileSize / 1_000_000).toFixed(1)} MB</span><span>{selected.mediaAsset.durationSeconds.toFixed(1)}s</span><span>{selected.mediaAsset.width}x{selected.mediaAsset.height}</span></div>
            <a className="text-link" href={selected.sourcePost.sourceUrl} target="_blank" rel="noreferrer">Open original X post</a>
            <p className="form-note">Collected from {selected.sourcePost.discoveryKind === "BOOKMARK" ? "collector bookmarks" : "source profile"}.</p>
            <div className="mt-5 min-w-0 border-t border-line pt-4"><small className="text-[10px] uppercase tracking-wider text-muted">Source caption</small><p className="mt-2 whitespace-pre-wrap [overflow-wrap:anywhere]">{selected.sourcePost.text || "No source caption"}</p></div>
          </aside>
          <section className="min-w-0">
            <form action={saveReview} className="grid min-w-0 gap-5">
              <input type="hidden" name="publishJobId" value={selected.id} />
              <label className="grid gap-2 text-xs font-semibold text-muted">Caption<textarea className="min-h-32 w-full resize-y rounded-sm border border-line bg-surface p-3 text-sm text-ink" name="caption" defaultValue={selected.caption} maxLength={280} required disabled={compressing} /></label>
              <label className="grid gap-2 text-xs font-semibold text-muted">Internal notes<textarea className="min-h-24 w-full resize-y rounded-sm border border-line bg-surface p-3 text-sm text-ink" name="reviewNotes" defaultValue={selected.sourcePost.reviewNotes ?? ""} maxLength={2000} disabled={compressing} /></label>
              <label className="grid gap-2 text-xs font-semibold text-muted">Tags<input className="w-full rounded-sm border border-line bg-surface px-3 py-2 text-sm text-ink" name="internalTags" defaultValue={selected.sourcePost.internalTags ?? ""} maxLength={500} disabled={compressing} /></label>
              <div><span className="mb-2 block text-xs font-semibold text-muted">Schedule (optional)</span><ScheduleField value={selected.scheduledFor} timeZone={timeZone} optional /></div>
              <ReviewSaveButtons locked={compressing} />
            </form>
            <div className="mt-6 flex flex-wrap gap-2 border-t border-line pt-5">
              <form action={resolveReviewCaption}><input type="hidden" name="publishJobId" value={selected.id} /><SubmitButton disabled={compressing}>Apply caption rules</SubmitButton></form>
              {selected.mediaAsset.compressed ? <button className="small-button" type="button" disabled>Already compressed</button> : <form action={compressReviewVideo} onSubmit={() => setCompressing(true)}><input type="hidden" name="publishJobId" value={selected.id} /><CompressionSubmit /></form>}
            </div>
            <p className="form-note">Compression creates a balanced H.264 MP4 and replaces the active file only when the result is smaller.</p>
            {selected.sourcePost.duplicateReason && <p className="error-line">Duplicate: {selected.sourcePost.duplicateReason}</p>}
            <div className="mt-6 flex flex-wrap gap-2 border-t border-line pt-5">
              <form action={rejectReview}><input type="hidden" name="publishJobId" value={selected.id} /><ConfirmSubmitButton message="Reject this content?" disabled={compressing}>Reject</ConfirmSubmitButton></form>
              <form action={returnToDownloads}><input type="hidden" name="publishJobId" value={selected.id} /><ConfirmSubmitButton message="Return this review item to Downloads?" disabled={compressing}>Return to Downloads</ConfirmSubmitButton></form>
            </div>
          </section>
        </div>
      </div>}
    </dialog>
  </>;
}
