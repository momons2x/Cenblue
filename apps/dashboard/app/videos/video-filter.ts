import type { VideoFileEntry } from "../lib/data";

export function availableVideoStatuses(files: VideoFileEntry[]): string[] {
  return [...new Set(files.map((file) => file.status))].sort();
}

export function filterVideoFiles(files: VideoFileEntry[], status: string): VideoFileEntry[] {
  return status ? files.filter((file) => file.status === status) : files;
}
