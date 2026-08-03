import type { ProcessRunner } from "./process-runner";
import { ProcessExecutionError } from "./process-runner";
import { PermanentDownloadError } from "./errors";

export interface VideoDownloader {
  download(sourceUrl: string, outputPath: string, thumbnailPath: string): Promise<void>;
}

export class YtDlpService implements VideoDownloader {
  constructor(
    private readonly runner: ProcessRunner,
    private readonly binary: string,
    private readonly ffmpegBinary: string,
    private readonly browserCookiesProfile?: string,
  ) {}

  async download(sourceUrl: string, outputPath: string, thumbnailPath: string): Promise<void> {
    const cookies = this.browserCookiesProfile ? ["--cookies-from-browser", `edge:${this.browserCookiesProfile}`] : [];
    try { await this.runner.run(this.binary, [
      "--no-playlist", "--no-part", "--no-progress", "--newline",
      ...cookies,
      "--format", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
      "--merge-output-format", "mp4",
      "--ffmpeg-location", this.ffmpegBinary,
      "--write-thumbnail", "--convert-thumbnails", "jpg",
      "--output", outputPath,
      "--output", `thumbnail:${thumbnailPath}`,
      sourceUrl,
    ], 10 * 60_000); }
    catch (error) {
      if (error instanceof ProcessExecutionError && /video unavailable|private video|not available|does not exist|unsupported url/i.test(error.stderr)) {
        throw new PermanentDownloadError(`yt-dlp reported unavailable media: ${error.stderr.slice(-500)}`);
      }
      throw error;
    }
  }
}
