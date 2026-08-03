import { getVideoFiles } from "../lib/data";
import { Empty, Shell } from "../ui";
import { availableVideoStatuses, filterVideoFiles } from "./video-filter";
import { VideoGacha } from "./video-gacha";

export const dynamic = "force-dynamic";

export default async function VideosPage({ searchParams }: { searchParams: Promise<{ status?: string; actionError?: string }> }) {
  const params = await searchParams;
  const allFiles = await getVideoFiles();
  const statuses = availableVideoStatuses(allFiles);
  const status = params.status?.trim() ?? "";
  const files = filterVideoFiles(allFiles, status);
  return <Shell title="Video vault" eyebrow="Cenblue / local entertainment">
    {params.actionError && <div className="toast error" role="alert">{params.actionError}</div>}
    <form className="queue-filters" method="get"><label>Status<select name="status" defaultValue={status}><option value="">All statuses</option>{statuses.map((value) => <option key={value} value={value}>{formatStatus(value)}</option>)}</select></label><button className="small-button accent-button" type="submit">Filter videos</button>{status && <a className="small-button" href="/videos">Clear</a>}</form>
    {files.length === 0 ? <section className="panel"><Empty>{status ? "No local videos match this status." : "No video files found in storage."}</Empty></section> : <VideoGacha files={files} />}
  </Shell>;
}

function formatStatus(status: string): string {
  return status.replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
}
