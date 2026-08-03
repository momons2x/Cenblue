import type { ProcessRunner } from "./process-runner";

export async function verifyDownloadBinaries(
  runner: ProcessRunner,
  binaries: { ytDlp: string; ffmpeg: string; ffprobe: string },
): Promise<void> {
  await runner.run(binaries.ytDlp, ["--version"], 15_000);
  await runner.run(binaries.ffmpeg, ["-version"], 15_000);
  await runner.run(binaries.ffprobe, ["-version"], 15_000);
}
