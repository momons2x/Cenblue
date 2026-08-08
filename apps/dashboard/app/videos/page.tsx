import { getStorageUsage, getVideoFiles } from "../lib/data";
import { Empty, Shell } from "../ui";
import { availableVideoStatuses, filterVideoFiles } from "./video-filter";
import { VideoGacha } from "./video-gacha";

export const dynamic = "force-dynamic";

export default async function VideosPage({ searchParams }: { searchParams: Promise<{ status?: string; actionError?: string }> }) {
  const params = await searchParams;
  const allFiles = await getVideoFiles();
  const usage = await getStorageUsage();
  const statuses = availableVideoStatuses(allFiles);
  const status = params.status?.trim() ?? "";
  const files = filterVideoFiles(allFiles, status);
  return <Shell title="Video vault" eyebrow="Cenblue / local entertainment">
    {params.actionError && <div className="toast error" role="alert">{params.actionError}</div>}
    <div className="mb-4 grid grid-cols-3 gap-3 max-[520px]:grid-cols-1"><div className="stat-tile"><small>Total local storage</small><strong>{formatBytes(usage.totalBytes)}</strong></div><div className="stat-tile"><small>Videos</small><strong>{formatBytes(usage.videoBytes)}</strong></div><div className="stat-tile"><small>Files on disk</small><strong>{usage.fileCount.toLocaleString()}</strong></div></div>
    <form className="queue-filters" method="get"><label>Status<select name="status" defaultValue={status}><option value="">All statuses</option>{statuses.map((value) => <option key={value} value={value}>{formatStatus(value)}</option>)}</select></label><button className="small-button accent-button" type="submit">Filter videos</button>{status && <a className="small-button" href="/videos">Clear</a>}</form>
    {files.length === 0 ? <section className="panel"><Empty>{status ? "No local videos match this status." : "No video files found in storage."}</Empty></section> : <VideoGacha files={files} />}
  </Shell>;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(value >= 100 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatStatus(status: string): string {
  return status.replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
}
