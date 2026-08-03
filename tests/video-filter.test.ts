import { describe, expect, it } from "vitest";
import { availableVideoStatuses, filterVideoFiles } from "../apps/dashboard/app/videos/video-filter";
import type { VideoFileEntry } from "../apps/dashboard/app/lib/data";

function video(fileName: string, status: string): VideoFileEntry {
  return { sourcePostId: fileName, platformPostId: fileName, fileName, fileSize: 1, sourceUsername: null, sourceUrl: null, caption: null, status, running: false };
}

describe("video status filter", () => {
  const files = [video("published.mp4", "PUBLISHED"), video("rejected.mp4", "REJECTED"), video("review.mp4", "READY_FOR_REVIEW")];

  it("lists the statuses available in local storage", () => {
    expect(availableVideoStatuses(files)).toEqual(["PUBLISHED", "READY_FOR_REVIEW", "REJECTED"]);
  });

  it("filters videos by exact lifecycle status", () => {
    expect(filterVideoFiles(files, "REJECTED").map((file) => file.fileName)).toEqual(["rejected.mp4"]);
    expect(filterVideoFiles(files, "")).toEqual(files);
    expect(filterVideoFiles(files, "UNKNOWN")).toEqual([]);
  });
});
