export type NotificationSendResult = { ok: boolean; retryAfterSeconds?: number; error?: string };

export interface NotificationTransport {
  send(recipient: string, text: string): Promise<NotificationSendResult>;
}
