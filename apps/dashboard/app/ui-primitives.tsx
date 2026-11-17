export function Badge({ value }: { value: string | null | undefined }) {
  const toneByStatus: Record<string, string> = {
    FAILED: "danger", MANUAL_ATTENTION: "danger", REJECTED: "danger", ERROR: "danger", CANCELLED: "neutral", BLOCKED: "danger", SESSION_EXPIRED: "danger",
    PENDING: "warn", RETRY_WAIT: "warn", RUNNING: "warn", DOWNLOADING: "warn", PUBLISHING: "warn", READY_FOR_REVIEW: "warn", APPROVED: "warn", WARN: "warn", NEEDS_VERIFY: "warn",
    COMPLETED: "good", DOWNLOADED: "good", PUBLISHED: "good", ENABLED: "good", AVAILABLE: "good", VERIFIED: "good",
    DELETED: "danger", NOT_CREATED: "neutral",
  };
  const tone = toneByStatus[value ?? ""] ?? "neutral";
  return <span className={`badge ${tone}`}>{(value ?? "unknown").replaceAll("_", " ")}</span>;
}

export function Stat({ label, value, detail, accent = "blue" }: { label: string; value: number | string; detail?: string; accent?: "blue" | "orange" | "mint" }) {
  return <div className={`stat-card accent-${accent}`}><p>{label}</p><strong>{value}</strong>{detail && <small>{detail}</small>}</div>;
}

export function Empty({ children }: { children: React.ReactNode }) { return <div className="empty"><span className="empty-icon">∅</span><p>{children}</p></div>; }

export function FlashNotice({ notice, tone = "success", children }: { notice?: string | null; tone?: string | null; children?: React.ReactNode }) {
  if (!notice && !children) return null;
  const normalized = tone === "error" || tone === "warning" || tone === "info" ? tone : "success";
  const className = normalized === "success" ? "toast bookmark-success" : normalized === "info" ? "toast" : `toast ${normalized}`;
  return <div className={className} role={normalized === "error" ? "alert" : "status"}>{notice}{notice && children ? " " : null}{children}</div>;
}

export function FormMessage({ children }: { children: React.ReactNode }) { return <p className="form-note">{children}</p>; }
