import { getStorageUsage, getVideoFiles } from "../lib/data";
import { formatBytes, formatNumber } from "../lib/format";
import { Empty, FlashNotice, Shell } from "../ui";
import { availableVideoStatuses, filterVideoFiles } from "./video-filter";
import { VideoGacha } from "./video-gacha";

export const dynamic = "force-dynamic";

export default async function VideosPage({ searchParams }: { searchParams: Promise<{ status?: string; notice?: string; tone?: string }> }) {
  const params = await searchParams;
  const allFiles = await getVideoFiles();
  const usage = await getStorageUsage();
  const statuses = availableVideoStatuses(allFiles);
  const status = params.status?.trim() ?? "";
  const files = filterVideoFiles(allFiles, status);
  return <Shell title="Video vault" eyebrow="Cenblue / local entertainment" variant="editorial">
    <FlashNotice notice={params.notice} tone={params.tone} />
    <div className="mb-4 grid grid-cols-3 gap-3 max-[520px]:grid-cols-1"><div className="stat-tile"><small>Media + caches</small><strong>{formatBytes(usage.totalBytes)}</strong></div><div className="stat-tile"><small>Videos</small><strong>{formatBytes(usage.videoBytes)}</strong></div><div className="stat-tile"><small>Files on disk</small><strong>{formatNumber(usage.fileCount)}</strong></div></div>
    <form className="queue-filters" method="get"><label>Status<select name="status" defaultValue={status}><option value="">All statuses</option>{statuses.map((value) => <option key={value} value={value}>{formatStatus(value)}</option>)}</select></label><button className="small-button accent-button" type="submit">Filter videos</button>{status && <a className="small-button" href="/videos">Clear</a>}</form>
    {files.length === 0 ? <section className="panel"><Empty>{status ? "No local videos match this status." : "No video files found in storage."}</Empty></section> : <VideoGacha files={files} />}
  </Shell>;
}

function formatStatus(status: string): string {
  return status.replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
}
