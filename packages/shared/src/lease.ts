export interface ExclusiveLease {
  run<T>(operation: (signal?: AbortSignal) => Promise<T>): Promise<T>;
}

export class ResourceBusyError extends Error {}
