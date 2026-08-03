export type PostMetrics = {
  replies: number | null;
  reposts: number | null;
  likes: number | null;
  bookmarks: number | null;
  views: number | null;
};

function metricValue(value: string): number {
  const normalized = value.replace(/,/g, "").toUpperCase();
  const multiplier = normalized.endsWith("K") ? 1_000 : normalized.endsWith("M") ? 1_000_000 : normalized.endsWith("B") ? 1_000_000_000 : 1;
  return Math.round(Number.parseFloat(normalized.replace(/[KMB]$/, "")) * multiplier);
}

export function parsePostMetricLabels(labels: string[]): PostMetrics | null {
  const metrics: PostMetrics = { replies: null, reposts: null, likes: null, bookmarks: null, views: null };
  const patterns: Record<keyof PostMetrics, RegExp> = {
    replies: /([\d,.]+\s*[KMB]?)\s+repl(?:y|ies)\b/i,
    reposts: /([\d,.]+\s*[KMB]?)\s+(?:reposts?|retweets?)\b/i,
    likes: /([\d,.]+\s*[KMB]?)\s+likes?\b/i,
    bookmarks: /([\d,.]+\s*[KMB]?)\s+bookmarks?\b/i,
    views: /([\d,.]+\s*[KMB]?)\s+views?\b/i,
  };
  for (const label of labels) {
    for (const key of Object.keys(patterns) as (keyof PostMetrics)[]) {
      const match = patterns[key].exec(label);
      if (match) metrics[key] = metricValue(match[1]);
    }
  }
  return Object.values(metrics).some((value) => value !== null) ? metrics : null;
}
