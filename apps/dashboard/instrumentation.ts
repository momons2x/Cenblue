export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startNotificationDispatcher } = await import("./app/lib/notification-dispatcher");
  startNotificationDispatcher();
  const { startDiscordBot } = await import("./app/lib/discord-bot");
  await startDiscordBot();
}
