export type TelegramSendResult = { ok: boolean; retryAfterSeconds?: number; error?: string };

export type TelegramBotInfo = { ok: boolean; username?: string; name?: string; error?: string };
export type TelegramChatInfo = { ok: boolean; title?: string; error?: string };

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
    const response = await this.request("sendMessage", { method: "POST", body: JSON.stringify({ chat_id: recipient, text, disable_web_page_preview: true }) });
    if (response.ok) return { ok: true };
    if (response.retryAfterSeconds !== undefined) return { ok: false, retryAfterSeconds: response.retryAfterSeconds };
    return { ok: false, error: response.error };
  }

  async getMe(): Promise<TelegramBotInfo> {
    const response = await this.request("getMe", { method: "GET" });
    if (!response.ok) return { ok: false, error: response.error };
    const result = response.result as { username?: string; first_name?: string } | undefined;
    return { ok: true, username: result?.username, name: result?.first_name };
  }

  async getChat(chatId: string): Promise<TelegramChatInfo> {
    const response = await this.request("getChat", { method: "GET", query: { chat_id: chatId } });
    if (!response.ok) return { ok: false, error: response.error };
    const result = response.result as { title?: string } | undefined;
    return { ok: true, title: result?.title };
  }

  private async request(
    methodName: string,
    options: { method: "GET" | "POST"; body?: string; query?: Record<string, string> },
  ): Promise<{ ok: boolean; retryAfterSeconds?: number; error?: string; result?: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const query = options.query ? `?${new URLSearchParams(options.query)}` : "";
    try {
      const response = await this.fetchImplementation(`https://api.telegram.org/bot${this.botToken}/${methodName}${query}`, {
        method: options.method,
        headers: options.body ? { "Content-Type": "application/json" } : undefined,
        body: options.body,
        signal: controller.signal,
      });
      if (response.status === 401) return { ok: false, error: "Telegram rejected the bot token (401 Unauthorized)" };
      if (response.status === 429) {
        const retryAfterSeconds = Number(response.headers.get("retry-after")) || 5;
        return { ok: false, retryAfterSeconds };
      }
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = this.extractError(body);
        return { ok: false, error: detail ?? `Telegram returned HTTP ${response.status}` };
      }
      if (body && typeof body === "object" && "ok" in body && body.ok === false) {
        return { ok: false, error: this.extractError(body) ?? "Telegram rejected the request" };
      }
      const result = body && typeof body === "object" && "result" in body ? body.result : undefined;
      return { ok: true, result };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timer);
    }
  }

  private extractError(body: unknown): string | undefined {
    if (body && typeof body === "object" && "description" in body && typeof body.description === "string") return body.description;
    return undefined;
  }
}
