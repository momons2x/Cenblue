export interface ExclusiveLease {
  run<T>(operation: (signal?: AbortSignal) => Promise<T>): Promise<T>;
}

export class ResourceBusyError extends Error {}

export function combineExclusiveLeases(...leases: ExclusiveLease[]): ExclusiveLease {
  return {
    run<T>(operation: (signal?: AbortSignal) => Promise<T>): Promise<T> {
      const acquire = (index: number, signals: AbortSignal[]): Promise<T> => index >= leases.length
        ? operation(signals.length > 0 ? AbortSignal.any(signals) : undefined)
        : leases[index].run((signal) => acquire(index + 1, signal ? [...signals, signal] : signals));
      return acquire(0, []);
    },
  };
}
