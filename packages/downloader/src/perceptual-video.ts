import type { ProcessRunner } from "./process-runner";

export interface PerceptualVideoHasher {
  hash(path: string): Promise<string | null>;
}

// Three 8x8 grayscale frames provide a compact, deterministic visual signature.
export class FfmpegPerceptualVideoHasher implements PerceptualVideoHasher {
  constructor(private readonly runner: ProcessRunner, private readonly ffmpeg: string) {}

  async hash(path: string): Promise<string | null> {
    const result = await this.runner.run(this.ffmpeg, ["-v", "error", "-i", path, "-vf", "fps=1/10,scale=8:8,format=gray", "-frames:v", "3", "-f", "rawvideo", "pipe:1"], 30_000);
    const bytes = result.stdoutBytes ?? Buffer.from(result.stdout);
    if (bytes.length < 64) return null;
    const hashes: string[] = [];
    for (let offset = 0; offset + 64 <= bytes.length && hashes.length < 3; offset += 64) {
      const frame = bytes.subarray(offset, offset + 64);
      const average = frame.reduce((sum, value) => sum + value, 0) / frame.length;
      hashes.push([...frame].map((value) => value >= average ? "1" : "0").join(""));
    }
    return hashes.join("");
  }
}
