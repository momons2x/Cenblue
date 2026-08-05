import type { ProcessRunner } from "./process-runner";
import { ProcessExecutionError } from "./process-runner";
import { PermanentDownloadError } from "./errors";
import type { BrowserId } from "@cenblu/config";

export interface VideoDownloader {
  download(sourceUrl: string, outputPath: string, thumbnailPath: string, collectorIdentityId?: string | null): Promise<void>;
}

export class YtDlpService implements VideoDownloader {
  constructor(
    private readonly runner: ProcessRunner,
    private readonly binary: string,
    private readonly ffmpegBinary: string,
    private readonly browserCookiesProfile?: string,
    private readonly browserId: BrowserId = "msedge",
    private readonly profileResolver?: (collectorIdentityId: string) => Promise<{ profilePath: string; browserId: BrowserId; runExclusive?: (operation: () => Promise<void>) => Promise<void> }>,
  ) {}

  async download(sourceUrl: string, outputPath: string, thumbnailPath: string, collectorIdentityId?: string | null): Promise<void> {
    const cookieBrowser: Record<BrowserId, string> = { msedge: "edge", chrome: "chrome", brave: "brave", chromium: "chromium", vivaldi: "vivaldi", opera: "opera", custom: "chromium" };
    const resolved = collectorIdentityId && this.profileResolver ? await this.profileResolver(collectorIdentityId) : null;
    const profilePath = resolved?.profilePath ?? this.browserCookiesProfile;
    const selectedBrowserId = resolved?.browserId ?? this.browserId;
    const cookies = profilePath ? ["--cookies-from-browser", `${cookieBrowser[selectedBrowserId]}:${profilePath}`] : [];
    const execute = async () => { await this.runner.run(this.binary, [
      "--no-playlist", "--no-part", "--no-progress", "--newline",
      ...cookies,
      "--format", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
      "--merge-output-format", "mp4",
      "--ffmpeg-location", this.ffmpegBinary,
      "--write-thumbnail", "--convert-thumbnails", "jpg",
      "--output", outputPath,
      "--output", `thumbnail:${thumbnailPath}`,
      sourceUrl,
    ], 10 * 60_000); };
    try { if (resolved?.runExclusive) await resolved.runExclusive(execute); else await execute(); }
    catch (error) {
      if (error instanceof ProcessExecutionError && /video unavailable|private video|not available|does not exist|unsupported url/i.test(error.stderr)) {
        throw new PermanentDownloadError(`yt-dlp reported unavailable media: ${error.stderr.slice(-500)}`);
      }
      throw error;
    }
  }
}
