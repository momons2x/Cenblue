import { getActiveDiscordClient } from "./registry";
import type { NotificationTransport, TelegramSendResult } from "@cenblu/notifications";

export class DiscordDmTransport implements NotificationTransport {
  async send(recipient: string, text: string): Promise<TelegramSendResult> {
    const client = getActiveDiscordClient();
    if (!client) return { ok: false, error: "Discord bot is not connected" };
    try {
      const user = await client.users.fetch(recipient);
      await user.send(text);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
