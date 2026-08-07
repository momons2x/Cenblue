import type { Client } from "discord.js";

let activeClient: Client | null = null;

export function setActiveDiscordClient(client: Client | null): void {
  activeClient = client;
}

export function getActiveDiscordClient(): Client | null {
  return activeClient;
}
