export type TelegramSendResult = { ok: boolean; retryAfterSeconds?: number; error?: string };

export interface NotificationTransport {
  send(recipient: string, text: string): Promise<TelegramSendResult>;
}

export class TelegramTransport implements NotificationTransport {
  constructor(
    private readonly botToken: string,
    private readonly fetchImplementation: typeof fetch = fetch,
    private readonly timeoutMs = 15_000,
  ) {}

  async send(recipient: string, text: string): Promise<TelegramSendResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImplementation(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: recipient, text, disable_web_page_preview: true }),
        signal: controller.signal,
      });
      if (!response.ok && response.status === 429) {
        const retryAfterSeconds = Number(response.headers.get("retry-after")) || 5;
        return { ok: false, retryAfterSeconds };
      }
      if (!response.ok) return { ok: false, error: `Telegram returned HTTP ${response.status}` };
      const body: unknown = await response.json();
      if (body && typeof body === "object" && "ok" in body && body.ok === false) {
        return { ok: false, error: "Telegram rejected the message" };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timer);
    }
  }
}
