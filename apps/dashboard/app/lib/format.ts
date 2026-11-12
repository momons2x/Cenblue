export function formatBytes(bytes: number, base: 1000 | 1024 = 1024): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(base)), units.length - 1);
  const value = bytes / base ** index;
  return `${value.toFixed(value >= 100 || index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatMegabytes(bytes: number, digits = 1): string {
  return `${(bytes / 1_000_000).toFixed(digits)} MB`;
}

export function formatSeconds(seconds: number, digits = 1): string {
  return `${seconds.toFixed(digits)}s`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}
