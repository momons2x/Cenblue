"use client";

import { useSyncExternalStore } from "react";

export type CollectionSourceRun = {
  status: string;
  targetNew: number;
  newFound: number;
  eligibleExamined: number;
  knownSkipped: number;
  sourceAccount: { username: string };
};

export type CollectionRun = {
  id: string;
  status: string;
  totalSources: number;
  completedSources: number;
  failedSources: number;
  currentSource: string | null;
  lastError: string | null;
  cancelRequestedAt: string | null;
  targetNew: number;
  newFound: number;
  eligibleExamined: number;
  knownSkipped: number;
  inserted: number;
  collectorIdentity?: { label: string; expectedUsername: string | null } | null;
  sources: CollectionSourceRun[];
};

export type CollectionStatus = { active: CollectionRun | null; actives: CollectionRun[]; latest: CollectionRun | null };

export type DownloadStatus = {
  run: { status: string; processed: number; limit: number } | null;
  active: { id: string; sourcePost: { platformPostId: string; sourceAccount: { username: string } } }[];
};

export type StatusCounts = { review: number; queue: number };

export type StatusSnapshot = { collection: CollectionStatus | null; downloads: DownloadStatus | null; counts?: StatusCounts | null };

const EMPTY: StatusSnapshot = { collection: null, downloads: null, counts: null };
const ACTIVE_CADENCE_MS = 1_000;
const IDLE_CADENCE_MS = 5_000;

let snapshot: StatusSnapshot = EMPTY;
let timer: ReturnType<typeof setTimeout> | null = null;
let subscribers = 0;
let inFlight = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function cadence(): number {
  const collecting = snapshot.collection?.active?.status === "RUNNING";
  const downloading = snapshot.downloads?.run?.status === "RUNNING";
  return collecting || downloading ? ACTIVE_CADENCE_MS : IDLE_CADENCE_MS;
}

function schedule(delay: number): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { void poll(); }, delay);
}

async function poll(): Promise<void> {
  if (subscribers === 0 || document.hidden || inFlight) return;
  inFlight = true;
  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    if (!response.ok) throw new Error(`Status request failed with ${response.status}`);
    snapshot = await response.json() as StatusSnapshot;
    emit();
  } catch {
    // Keep the last known state; the next tick retries.
  } finally {
    inFlight = false;
    if (subscribers > 0 && !document.hidden) schedule(cadence());
  }
}

function onVisibilityChange(): void {
  if (subscribers === 0) return;
  if (document.hidden) {
    if (timer) { clearTimeout(timer); timer = null; }
    return;
  }
  void poll();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  subscribers += 1;
  if (subscribers === 1) {
    document.addEventListener("visibilitychange", onVisibilityChange);
    void poll();
  }
  return () => {
    listeners.delete(listener);
    subscribers -= 1;
    if (subscribers === 0) {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (timer) { clearTimeout(timer); timer = null; }
    }
  };
}

export function useStatusPoll(): StatusSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot, () => EMPTY);
}
