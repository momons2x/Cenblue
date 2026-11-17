export function automaticPublishingEnabled(mode: "ASSISTED" | "AUTOMATIC", sessionVerifiedAt: string | undefined): boolean {
  return mode === "AUTOMATIC" && Boolean(sessionVerifiedAt);
}
