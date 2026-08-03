import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { Readable } from "node:stream";
import { loadConfig } from "@cenblu/config";
import { prisma } from "@cenblu/database";

function inside(root: string, path: string): boolean {
  const value = relative(resolve(root), resolve(path));
  return value !== "" && !value.startsWith("..") && !value.includes(":");
}

export async function GET(request: Request, { params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  const asset = await prisma.mediaAsset.findFirst({ where: { sourcePost: { platformPostId: postId } }, select: { filePath: true, mimeType: true } });
  if (!asset) return new Response("Not found", { status: 404 });
  if (!inside(loadConfig().videoStoragePath, asset.filePath)) return new Response("Invalid media path", { status: 403 });
  try {
    const file = await stat(asset.filePath);
    const range = request.headers.get("range");
    const match = range && /^bytes=(\d*)-(\d*)$/.exec(range);
    if (range && !match) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${file.size}` } });
    const suffix = match && !match[1] && match[2] ? Number(match[2]) : null;
    const start = suffix === null ? (match?.[1] ? Number(match[1]) : 0) : Math.max(file.size - suffix, 0);
    const end = suffix === null ? (match?.[2] ? Math.min(Number(match[2]), file.size - 1) : file.size - 1) : file.size - 1;
    if (start < 0 || end < start || start >= file.size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${file.size}` } });
    const length = end - start + 1;
    const stream = createReadStream(asset.filePath, { start, end });
    const headers: Record<string, string> = { "Content-Type": asset.mimeType, "Content-Length": String(length), "Accept-Ranges": "bytes", "Cache-Control": "private, no-store" };
    if (match) headers["Content-Range"] = `bytes ${start}-${end}/${file.size}`;
    return new Response(Readable.toWeb(stream) as ReadableStream, { status: match ? 206 : 200, headers });
  }
  catch { return new Response("Media unavailable", { status: 404 }); }
}

export async function HEAD(request: Request, context: { params: Promise<{ postId: string }> }) {
  const { postId } = await context.params;
  const asset = await prisma.mediaAsset.findFirst({ where: { sourcePost: { platformPostId: postId } }, select: { filePath: true, mimeType: true } });
  if (!asset) return new Response(null, { status: 404 });
  if (!inside(loadConfig().videoStoragePath, asset.filePath)) return new Response(null, { status: 403 });
  try {
    const file = await stat(asset.filePath);
    return new Response(null, { headers: { "Content-Type": asset.mimeType, "Content-Length": String(file.size), "Accept-Ranges": "bytes", "Cache-Control": "private, no-store" } });
  } catch { return new Response(null, { status: 404 }); }
}
