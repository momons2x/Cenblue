import type { Client } from "discord.js";

const globalState = globalThis as typeof globalThis & { __cenbluDiscordActiveClient?: Client | null };

export function setActiveDiscordClient(client: Client | null): void {
  globalState.__cenbluDiscordActiveClient = client;
}

export function getActiveDiscordClient(): Client | null {
  return globalState.__cenbluDiscordActiveClient ?? null;
}
