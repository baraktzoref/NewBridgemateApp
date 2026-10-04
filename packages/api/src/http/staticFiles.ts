/**
 * Serves a single-page app's public/ directory over plain HTTP — no
 * framework, matching the rest of this layer's dependency-free approach.
 * Used for both packages/pwa (the table phone, mounted at "/") and
 * packages/director-app (the director's screen, mounted at "/director") —
 * see app.ts's dispatcher for how a request is routed to one or the other.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

/** True for a path with no file extension on its last segment — treated as a client-side route, not a missing file. */
function looksLikeRoute(relPath: string): boolean {
  const lastSegment = relPath.split("/").pop() ?? "";
  return !lastSegment.includes(".");
}

export interface StaticServer {
  /**
   * Attempts to serve `relPathWithinApp` (already relative to this app's own
   * root — the caller strips any mount-point prefix first) from `publicDir`.
   * Returns true if it wrote a response (success or a 404/400 of its own),
   * false only when nothing in this module applies, so the caller's generic
   * 404 still has the last word.
   */
  serve(relPathWithinApp: string, res: ServerResponse): Promise<boolean>;
}

/** Builds a static server rooted at `publicDir`. `publicDir` is resolved relative to this file. */
export function createStaticServer(publicDirUrl: string): StaticServer {
  const publicDir = resolve(fileURLToPath(new URL(publicDirUrl, import.meta.url)));

  async function serve(relPathWithinApp: string, res: ServerResponse): Promise<boolean> {
    const normalized = normalize(relPathWithinApp === "" ? "/" : relPathWithinApp).replace(/^(\.\.[/\\])+/, "");
    const filePath = join(publicDir, normalized);
    if (!filePath.startsWith(publicDir)) {
      res.writeHead(400).end("bad path");
      return true;
    }

    let stats;
    try {
      stats = await stat(filePath);
    } catch {
      // No file at this exact path — if it looks like a client-side route
      // (e.g. "/t/<token>" for the pwa, "/director" for the director app)
      // rather than a missing asset, fall back to the app shell.
      if (looksLikeRoute(normalized)) return serveIndex(res);
      return false;
    }
    if (!stats.isFile()) {
      if (looksLikeRoute(normalized)) return serveIndex(res);
      return false;
    }
    return sendFile(filePath, stats.size, res);
  }

  async function serveIndex(res: ServerResponse): Promise<boolean> {
    const indexPath = join(publicDir, "index.html");
    try {
      const stats = await stat(indexPath);
      return sendFile(indexPath, stats.size, res);
    } catch {
      return false;
    }
  }

  function sendFile(filePath: string, size: number, res: ServerResponse): Promise<boolean> {
    const type = CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream";
    res.writeHead(200, { "content-type": type, "content-length": size });
    return new Promise<boolean>((resolvePromise, reject) => {
      const stream = createReadStream(filePath);
      stream.on("error", reject);
      stream.on("end", () => resolvePromise(true));
      stream.pipe(res);
    });
  }

  return { serve };
}

/** The table phone PWA, mounted at the server's root ("/", "/t/:tableToken", assets under "/js", "/css", …). */
export const pwaStatic = createStaticServer("../../../pwa/public");

/** The director's screen, mounted at "/director" — see app.ts, which strips that prefix before calling serve(). */
export const directorAppStatic = createStaticServer("../../../director-app/public");
