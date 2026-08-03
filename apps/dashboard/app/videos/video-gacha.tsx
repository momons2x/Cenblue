"use client";

import { useEffect, useRef, useState } from "react";
import { removeMedia } from "../actions";
import { ActionForm, ConfirmSubmitButton } from "../controls";
import type { VideoFileEntry } from "../lib/data";
import { Badge } from "../ui";

function drawUnique(files: VideoFileEntry[], count: number): VideoFileEntry[] {
  const pool = [...files];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const random = new Uint32Array(1);
    crypto.getRandomValues(random);
    const target = Math.floor(random[0] / 2 ** 32 * (index + 1));
    [pool[index], pool[target]] = [pool[target], pool[index]];
  }
  return pool.slice(0, Math.min(count, pool.length));
}

function VideoCard({ file, number, watched, onWatched }: { file: VideoFileEntry; number?: number; watched?: boolean; onWatched?: () => void }) {
  return <article className={`video-library-card${watched ? " watched" : ""}`}>
    <div className="video-frame">
      {number && <span className="video-pick-number">Pick {number}</span>}
      {watched && <span className="video-watched">Watched</span>}
      <video controls preload="none" aria-label={`Video ${file.platformPostId}`} src={`/media/${file.platformPostId}`} onEnded={onWatched} />
    </div>
    <div className="video-card-copy">
      <div><strong>{file.sourceUsername ? `@${file.sourceUsername}` : file.platformPostId}</strong><span>{(file.fileSize / 1_000_000).toFixed(1)} MB</span></div>
      {file.caption && <p>{file.caption}</p>}
      {file.sourceUrl && <a href={file.sourceUrl} target="_blank" rel="noreferrer">Original post ↗</a>}
      <div className="video-card-actions"><Badge value={file.status} />{!file.running && <ActionForm action={removeMedia}><input type="hidden" name="sourcePostId" value={file.sourcePostId} /><input type="hidden" name="returnPath" value="/videos" /><ConfirmSubmitButton message={`Permanently delete the local video and thumbnail for X post ${file.platformPostId}?${file.status === "PUBLISHED" ? " The publication record and X link will be kept." : " The source post will remain tracked."}`} pendingLabel="Deleting…">Delete local media</ConfirmSubmitButton></ActionForm>}</div>
    </div>
  </article>;
}

export function VideoGacha({ files }: { files: VideoFileEntry[] }) {
  const [rolling, setRolling] = useState(false);
  const [results, setResults] = useState<VideoFileEntry[]>([]);
  const [watched, setWatched] = useState<Set<string>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    const available = new Set(files.map((file) => file.fileName));
    setResults((current) => current.filter((file) => available.has(file.fileName)));
    setWatched((current) => new Set([...current].filter((fileName) => available.has(fileName))));
  }, [files]);

  const draw = () => {
    if (rolling || files.length === 0) return;
    setRolling(true);
    setResults([]);
    setWatched(new Set());
    timer.current = setTimeout(() => {
      setResults(drawUnique(files, 5));
      setRolling(false);
    }, 950);
  };

  const markWatched = (fileName: string) => setWatched((current) => new Set(current).add(fileName));
  return <>
    <section className={`video-gacha${rolling ? " rolling" : ""}`}>
      <div className="gacha-glow" aria-hidden="true"><span /><span /><span /></div>
      <div className="gacha-copy"><p className="eyebrow">Daily watch draw</p><h2>Let chance pick the queue.</h2><p>Draw five unique videos from local storage, then finish the set. Nothing is changed or removed.</p></div>
      <div className="gacha-machine" aria-live="polite">
        <div className="gacha-capsules" aria-hidden="true">{Array.from({ length: 5 }, (_, index) => <span key={index}>{rolling ? "?" : index + 1}</span>)}</div>
        <button type="button" onClick={draw} disabled={rolling || files.length === 0}>{rolling ? "Drawing your five…" : results.length ? "Draw another five" : "Draw 5 videos"}</button>
        <small>{files.length < 5 ? `All ${files.length} available videos will be drawn` : `${files.length} videos in the pool`}</small>
      </div>
    </section>

    {(rolling || results.length > 0) && <section className="gacha-results">
      <div className="gacha-results-head"><div><p className="eyebrow">Your watch quest</p><h3>{rolling ? "Shuffling the vault…" : `${watched.size} / ${results.length} completed`}</h3></div>{results.length > 0 && <span className="gacha-progress"><i style={{ width: `${watched.size / results.length * 100}%` }} /></span>}</div>
      {rolling ? <div className="gacha-skeletons">{Array.from({ length: Math.min(5, files.length) }, (_, index) => <div key={index}><span>?</span></div>)}</div> : <div className="gacha-grid">{results.map((file, index) => <VideoCard key={file.fileName} file={file} number={index + 1} watched={watched.has(file.fileName)} onWatched={() => markWatched(file.fileName)} />)}</div>}
    </section>}

    <section className="video-library">
      <div className="video-library-head"><div><p className="eyebrow">The full vault</p><h3>{files.length} local video{files.length === 1 ? "" : "s"}</h3></div><span>Play anything, anytime</span></div>
      <div className="video-library-grid">{files.map((file) => <VideoCard key={file.fileName} file={file} />)}</div>
    </section>
  </>;
}
