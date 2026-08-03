import { z } from "zod";
import type { ProcessRunner } from "./process-runner";
import { PermanentDownloadError } from "./errors";

const ffprobeOutput = z.object({
  streams: z.array(z.object({
    codec_type: z.string(), codec_name: z.string().optional(), width: z.number().optional(), height: z.number().optional(), duration: z.string().optional(),
  })),
  format: z.object({ duration: z.string().optional() }),
});

export type VideoMetadata = { durationSeconds: number; width: number; height: number; codec: string | null };

export interface VideoInspector {
  inspect(path: string): Promise<VideoMetadata>;
}

export class FfprobeService implements VideoInspector {
  constructor(private readonly runner: ProcessRunner, private readonly binary: string) {}

  async inspect(path: string): Promise<VideoMetadata> {
    const result = await this.runner.run(this.binary, ["-v", "error", "-show_streams", "-show_format", "-of", "json", path], 30_000);
    let parsed: z.infer<typeof ffprobeOutput>;
    try { parsed = ffprobeOutput.parse(JSON.parse(result.stdout)); }
    catch (error) { throw new PermanentDownloadError("ffprobe returned malformed metadata", { cause: error }); }
    const video = parsed.streams.find((stream) => stream.codec_type === "video");
    const duration = Number(video?.duration ?? parsed.format.duration);
    if (!video || !video.width || !video.height || !Number.isFinite(duration) || duration <= 0) throw new PermanentDownloadError("ffprobe did not report a valid video stream");
    return { durationSeconds: duration, width: video.width, height: video.height, codec: video.codec_name ?? null };
  }
}
