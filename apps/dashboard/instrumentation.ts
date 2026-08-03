export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startAutomaticPublisher } = await import("./app/lib/automatic-publisher");
  startAutomaticPublisher();
}
