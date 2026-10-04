/**
 * Serves packages/pwa/public over plain HTTP — no framework, matching the
 * rest of this layer's dependency-free approach. Only ever reached for GET
 * requests that didn't match an /api or /ws route (see app.ts).
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC_DIR = resolve(fileURLToPath(new URL("../../../pwa/public", import.meta.url)));

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/**
 * Attempts to serve `pathname` from the PWA's public directory. Returns true
 * if it wrote a response (success or a 404 of its own), false if the caller
 * should fall through to its own 404 — kept false only when nothing in this
 * module applies, so app.ts's generic "not found" still has the last word.
 */
export async function serveStatic(pathname: string, res: ServerResponse): Promise<boolean> {
  // "/t/<tableToken>" is a client-side route (the phone's own URL after
  // scanning the table QR) — it has no file of its own, so it falls back to
  // the app shell exactly like any other deep link in a single-page app.
  const relPath = pathname === "/" || /^\/t\/[^/]+$/.test(pathname) ? "/index.html" : pathname;

  const normalized = normalize(relPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(PUBLIC_DIR, normalized);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(400).end("bad path");
    return true;
  }

  let stats;
  try {
    stats = await stat(filePath);
  } catch {
    return false;
  }
  if (!stats.isFile()) return false;

  const type = CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream";
  res.writeHead(200, { "content-type": type, "content-length": stats.size });
  await new Promise<void>((resolve_, reject) => {
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("end", resolve_);
    stream.pipe(res);
  });
  return true;
}
