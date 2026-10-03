/**
 * A minimal method+path router, built to avoid depending on a web framework
 * (no network access to npm in this environment to install one). Path params
 * use ":name" segments; a trailing "*" segment is not supported — every route
 * here has a fixed shape.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

export interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
}

export type Handler = (ctx: RouteContext) => Promise<void> | void;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];

  add(method: string, path: string, handler: Handler): void {
    this.routes.push({ method, segments: path.split("/").filter(Boolean), handler });
  }

  get(path: string, handler: Handler): void { this.add("GET", path, handler); }
  post(path: string, handler: Handler): void { this.add("POST", path, handler); }
  put(path: string, handler: Handler): void { this.add("PUT", path, handler); }

  /** Returns the matched handler and extracted params, or null if nothing matches. */
  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | null {
    const segments = pathname.split("/").filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method || route.segments.length !== segments.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < segments.length; i++) {
        const routeSeg = route.segments[i]!;
        const seg = decodeURIComponent(segments[i]!);
        if (routeSeg.startsWith(":")) params[routeSeg.slice(1)] = seg;
        else if (routeSeg !== seg) { ok = false; break; }
      }
      if (ok) return { handler: route.handler, params };
    }
    return null;
  }
}
