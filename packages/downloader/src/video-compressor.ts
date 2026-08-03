import type { ProcessRunner } from "./process-runner";

export interface VideoCompressor {
  compress(inputPath: string, outputPath: string, timeoutMs?: number): Promise<void>;
}

export class FfmpegVideoCompressor implements VideoCompressor {
  constructor(private readonly runner: ProcessRunner, private readonly binary: string) {}

  async compress(inputPath: string, outputPath: string, timeoutMs = 30 * 60_000): Promise<void> {
    await this.runner.run(this.binary, [
      "-hide_banner", "-loglevel", "error", "-y", "-i", inputPath,
      "-map", "0:v:0", "-map", "0:a?",
      "-c:v", "libx264", "-preset", "medium", "-crf", "28",
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart", outputPath,
    ], timeoutMs);
  }
}
