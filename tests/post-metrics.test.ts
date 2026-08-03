import { describe, expect, it } from "vitest";
import { parsePostMetricLabels } from "@cenblu/collector";

describe("post performance metrics", () => {
  it("parses X engagement labels and abbreviated counts", () => {
    expect(parsePostMetricLabels(["12 replies, 1.2K reposts, 8,432 likes, 56 bookmarks, 2.5M views"])).toEqual({
      replies: 12,
      reposts: 1_200,
      likes: 8_432,
      bookmarks: 56,
      views: 2_500_000,
    });
  });

  it("combines metrics exposed by separate controls", () => {
    expect(parsePostMetricLabels(["4 Replies. Reply", "7 Retweets. Retweet", "20 Likes. Like", "100 Views. View post analytics"])).toEqual({
      replies: 4,
      reposts: 7,
      likes: 20,
      bookmarks: null,
      views: 100,
    });
  });

  it("returns null when labels contain no metrics", () => {
    expect(parsePostMetricLabels(["Account menu", "Share post"])).toBeNull();
  });
});
