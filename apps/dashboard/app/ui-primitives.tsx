export function Badge({ value }: { value: string | null | undefined }) {
  const toneByStatus: Record<string, string> = {
    FAILED: "danger", MANUAL_ATTENTION: "danger", REJECTED: "danger", ERROR: "danger", CANCELLED: "neutral",
    PENDING: "warn", RETRY_WAIT: "warn", RUNNING: "warn", DOWNLOADING: "warn", PUBLISHING: "warn", READY_FOR_REVIEW: "warn", APPROVED: "warn", WARN: "warn", NEEDS_VERIFY: "warn",
    COMPLETED: "good", DOWNLOADED: "good", PUBLISHED: "good", ENABLED: "good", AVAILABLE: "good", VERIFIED: "good",
    DELETED: "danger", NOT_CREATED: "neutral",
  };
  const tone = toneByStatus[value ?? ""] ?? "neutral";
  return <span className={`badge ${tone}`}>{(value ?? "unknown").replaceAll("_", " ")}</span>;
}

export function Stat({ label, value, detail, accent = "blue" }: { label: string; value: number | string; detail?: string; accent?: string }) {
  const border = { blue: "border-t-accent", violet: "border-t-accent", orange: "border-t-warning", mint: "border-t-success" }[accent] ?? "border-t-accent";
  return <div className={`min-w-0 border border-line border-t-[3px] ${border} bg-surface p-5`}><p className="mb-4 [overflow-wrap:anywhere] text-xs text-muted">{label}</p><strong className="block [overflow-wrap:anywhere] text-[clamp(2rem,7vw,3rem)] leading-none tracking-tight text-ink">{value}</strong>{detail && <small className="mt-3 block [overflow-wrap:anywhere] text-xs text-muted">{detail}</small>}</div>;
}

export function Empty({ children }: { children: React.ReactNode }) { return <div className="empty"><span className="empty-icon">∅</span><p>{children}</p></div>; }

export function FormMessage({ children }: { children: React.ReactNode }) { return <p className="form-note">{children}</p>; }
