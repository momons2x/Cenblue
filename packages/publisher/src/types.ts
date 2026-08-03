export type PublishPhase = "PREPARING" | "UPLOADING" | "PROCESSING" | "READY_TO_SUBMIT" | "SUBMITTING" | "CONFIRMING";
export type PublishInput = {
  jobId: string;
  platformPostId: string;
  mediaPath: string | null;
  mediaKind: "video" | "image" | null;
  caption: string;
  fileSize: number;
  durationSeconds: number;
  width: number;
  height: number;
  codec: string | null;
  signal?: AbortSignal;
  reportProgress?: (phase: PublishPhase) => Promise<void>;
};
export type PublishResult = { platformPostId: string | null; platformUrl: string | null };

export interface Publisher {
  publish(input: PublishInput): Promise<PublishResult>;
}

export type PublisherFailure =
  | "NOT_LOGGED_IN"
  | "ACCOUNT_INTERVENTION"
  | "PROFILE_IN_USE"
  | "BROWSER_LAUNCH_FAILED"
  | "LEASE_LOST"
  | "MISSING_MEDIA"
  | "UPLOAD_REJECTED"
  | "PROCESSING_TIMEOUT"
  | "COMPOSER_SELECTOR"
  | "SUBMISSION_FAILED"
  | "CONFIRMATION_FAILED"
  | "INVALID_CAPTION";

export class PublisherError extends Error {
  constructor(
    readonly kind: PublisherFailure,
    message: string,
    readonly retryable: boolean,
    readonly manualAttention: boolean,
    options?: ErrorOptions,
  ) { super(message, options); }
}
