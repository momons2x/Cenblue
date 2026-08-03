export class PermanentDownloadError extends Error {
  constructor(message: string, options?: ErrorOptions) { super(message, options); }
}
