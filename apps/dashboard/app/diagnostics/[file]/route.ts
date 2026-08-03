import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "@cenblu/config";

const imagePattern = /^[A-Za-z0-9_.-]+\.(png|jpe?g|webp)$/i;

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!imagePattern.test(file)) return new Response("Not found", { status: 404 });
  const path = resolve(loadConfig().logStoragePath, file);
  try {
    const body = await readFile(path);
    const extension = file.split(".").pop()?.toLowerCase();
    const type = extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
    return new Response(body, { headers: { "Content-Type": type, "Cache-Control": "private, no-store" } });
  } catch { return new Response("Not found", { status: 404 }); }
}
