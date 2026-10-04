/**
 * Builds the HTTP + WebSocket server: a thin layer that validates each request
 * with @bridge/shared's parsers, calls into @bridge/server's domain services,
 * and broadcasts the resulting WsEvent to anyone watching that event over
 * WebSocket. No business logic lives here — see the design doc section on
 * "how a task runs" for why this layer stays dumb on purpose.
 */
import { createServer } from "node:http";
import type { Server } from "node:http";
import { serveStatic } from "./http/staticFiles.ts";
import { Db } from "../../server/src/db/connection.ts";
import { migrate } from "../../server/src/db/schema.ts";
import {
  createEvent, getEvent, getEventByTableToken, identifyPair, advanceRound,
} from "../../server/src/domain/eventService.ts";
import {
  submitResult, confirmResult, directorEditResult, directorOverrideResult, toResultDto,
} from "../../server/src/domain/resultService.ts";
import { computeStandings } from "../../server/src/domain/rankingService.ts";
import {
  connectDevice, takeoverDevice, heartbeat, disconnectDevice, lockTable, unlockTable, addAudit,
} from "../../server/src/domain/deviceService.ts";
import {
  parseConnectRequest, parseTakeoverRequest, parsePairIdentificationRequest, parseResultSubmission,
  parseConfirmResultRequest, parseCallDirectorRequest, parseDirectorEditResultRequest,
  parseDirectorOverrideRequest, parseTableLockRequest,
} from "../../shared/src/index.ts";
import { Router } from "./http/router.ts";
import { readJsonBody, sendError, sendJson } from "./http/respond.ts";
import { statusForError } from "./errors.ts";
import { WsHub } from "./ws/wsServer.ts";
import { buildTableState } from "./tableState.ts";

export interface App {
  server: Server;
  db: Db;
  wsHub: WsHub;
}

function resolveTable(db: Db, tableToken: string, res: Parameters<typeof sendError>[0]): { eventId: string; table: number } | null {
  const found = getEventByTableToken(db, tableToken);
  if (!found) { sendError(res, 404, "unknown table token", "NOT_FOUND"); return null; }
  return { eventId: found.event.id, table: found.table };
}

export function createApp(dbPath = ":memory:"): App {
  const db = new Db(dbPath);
  migrate(db);
  const wsHub = new WsHub();
  const router = new Router();

  // -------------------------------------------------------------------------
  // Director: event lifecycle (no director authentication yet — see README)
  // -------------------------------------------------------------------------

  router.post("/api/events", async ({ req, res }) => {
    let body: unknown;
    try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, (e as Error).message); }
    if (typeof body !== "object" || body === null) return sendError(res, 400, "body must be an object");
    const b = body as Record<string, unknown>;
    if (typeof b.name !== "string" || typeof b.pairs !== "number" || typeof b.boardsPerRound !== "number")
      return sendError(res, 400, "name (string), pairs (number) and boardsPerRound (number) are required");
    try {
      const created = createEvent(db, {
        name: b.name, pairs: b.pairs, boardsPerRound: b.boardsPerRound,
        rounds: typeof b.rounds === "number" ? b.rounds : undefined,
        phantomSide: b.phantomSide === "NS" || b.phantomSide === "EW" ? b.phantomSide : undefined,
      });
      sendJson(res, 201, {
        eventId: created.eventId, eventCode: created.eventCode, tables: created.tables,
        rounds: created.rounds, skipAfterRound: created.skipAfterRound,
        tableTokens: Object.fromEntries(created.tableTokens),
      });
    } catch (e) {
      const { status, message, code } = statusForError(e);
      sendError(res, status, message, code ?? undefined);
    }
  });

  router.get("/api/events/:eventId", ({ res, params }) => {
    const event = getEvent(db, params.eventId!);
    if (!event) return sendError(res, 404, "event not found", "NOT_FOUND");
    sendJson(res, 200, event);
  });

  router.post("/api/events/:eventId/round", async ({ req, res, params }) => {
    let body: unknown;
    try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, (e as Error).message); }
    const round = (body as { round?: unknown })?.round;
    if (typeof round !== "number") return sendError(res, 400, "round (number) is required");
    try {
      advanceRound(db, params.eventId!, round);
      wsHub.broadcast(params.eventId!, { type: "round_started", round });
      sendJson(res, 200, { ok: true, round });
    } catch (e) {
      const { status, message, code } = statusForError(e);
      sendError(res, status, message, code ?? undefined);
    }
  });

  router.get("/api/events/:eventId/standings", ({ res, params }) => {
    try {
      sendJson(res, 200, computeStandings(db, params.eventId!));
    } catch (e) {
      const { status, message, code } = statusForError(e);
      sendError(res, status, message, code ?? undefined);
    }
  });

  router.post("/api/events/:eventId/table/:table/lock", async ({ req, res, params }) => {
    let body: unknown;
    try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, (e as Error).message); }
    const parsed = parseTableLockRequest({ ...(body as object), table: Number(params.table) });
    if (!parsed.ok) return sendError(res, 400, parsed.errors.join("; "));
    try {
      const { eventId } = params;
      const table = Number(params.table);
      if (parsed.value.action === "lock") { lockTable(db, eventId!, table); wsHub.broadcast(eventId!, { type: "table_locked", table }); }
      else { unlockTable(db, eventId!, table); wsHub.broadcast(eventId!, { type: "table_unlocked", table }); }
      sendJson(res, 200, { ok: true });
    } catch (e) {
      const { status, message, code } = statusForError(e);
      sendError(res, status, message, code ?? undefined);
    }
  });

  router.post("/api/events/:eventId/table/:table/disconnect", ({ res, params }) => {
    try {
      disconnectDevice(db, params.eventId!, Number(params.table));
      sendJson(res, 200, { ok: true });
    } catch (e) {
      const { status, message, code } = statusForError(e);
      sendError(res, status, message, code ?? undefined);
    }
  });

  router.put("/api/events/:eventId/result/:resultId", async ({ req, res, params }) => {
    let body: unknown;
    try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, (e as Error).message); }
    const parsed = parseDirectorEditResultRequest({ ...(body as object), resultId: params.resultId });
    if (!parsed.ok) return sendError(res, 400, parsed.errors.join("; "));
    try {
      const r = directorEditResult(db, params.eventId!, parsed.value.resultId, parsed.value.result, parsed.value.ifVersion);
      wsHub.broadcast(params.eventId!, { type: "result_changed_by_director", result: toResultDto(r) });
      wsHub.broadcast(params.eventId!, { type: "ranking_updated" });
      sendJson(res, 200, toResultDto(r));
    } catch (e) {
      const { status, message, code } = statusForError(e);
      sendError(res, status, message, code ?? undefined);
    }
  });

  router.post("/api/events/:eventId/result/:resultId/override", async ({ req, res, params }) => {
    let body: unknown;
    try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, (e as Error).message); }
    const parsed = parseDirectorOverrideRequest({ ...(body as object), resultId: params.resultId });
    if (!parsed.ok) return sendError(res, 400, parsed.errors.join("; "));
    try {
      const v = parsed.value;
      const r = directorOverrideResult(db, params.eventId!, v.resultId, v.adjustedNsPct, v.adjustedEwPct, v.ifVersion);
      wsHub.broadcast(params.eventId!, { type: "result_changed_by_director", result: toResultDto(r) });
      wsHub.broadcast(params.eventId!, { type: "ranking_updated" });
      sendJson(res, 200, toResultDto(r));
    } catch (e) {
      const { status, message, code } = statusForError(e);
      sendError(res, status, message, code ?? undefined);
    }
  });

  // -------------------------------------------------------------------------
  // Table phone (addressed by its QR token; a deviceToken is minted on connect)
  // -------------------------------------------------------------------------

  router.post("/api/t/:tableToken/connect", async ({ req, res, params }) => {
    let body: unknown;
    try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, (e as Error).message); }
    const parsed = parseConnectRequest(body);
    if (!parsed.ok) return sendError(res, 400, parsed.errors.join("; "));
    const loc = resolveTable(db, params.tableToken!, res);
    if (!loc) return;
    try {
      const d = connectDevice(db, loc.eventId, loc.table, parsed.value.eventCode, parsed.value.deviceLabel);
      sendJson(res, 201, { deviceToken: d.device_token, eventId: loc.eventId, table: loc.table });
    } catch (e) {
      const { status, message, code } = statusForError(e);
      sendError(res, status, message, code ?? undefined);
    }
  });

  router.post("/api/t/:tableToken/takeover", async ({ req, res, params }) => {
    let body: unknown;
    try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, (e as Error).message); }
    const parsed = parseTakeoverRequest(body);
    if (!parsed.ok) return sendError(res, 400, parsed.errors.join("; "));
    const loc = resolveTable(db, params.tableToken!, res);
    if (!loc) return;
    try {
      const d = takeoverDevice(db, loc.eventId, loc.table, parsed.value.eventCode, parsed.value.reason);
      wsHub.broadcast(loc.eventId, { type: "device_took_over", table: loc.table });
      sendJson(res, 201, { deviceToken: d.device_token, eventId: loc.eventId, table: loc.table });
    } catch (e) {
      const { status, message, code } = statusForError(e);
      sendError(res, status, message, code ?? undefined);
    }
  });

  router.get("/api/t/:tableToken/state", ({ res, params }) => {
    const loc = resolveTable(db, params.tableToken!, res);
    if (!loc) return;
    try {
      sendJson(res, 200, buildTableState(db, loc.eventId, loc.table));
    } catch (e) {
      const { status, message, code } = statusForError(e);
      sendError(res, status, message, code ?? undefined);
    }
  });

  router.post("/api/t/:tableToken/heartbeat", async ({ req, res, params }) => {
    let body: unknown;
    try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, (e as Error).message); }
    const deviceToken = (body as { deviceToken?: unknown })?.deviceToken;
    if (typeof deviceToken !== "string") return sendError(res, 400, "deviceToken (string) is required");
    const loc = resolveTable(db, params.tableToken!, res);
    if (!loc) return;
    try {
      heartbeat(db, deviceToken);
      sendJson(res, 200, { ok: true });
    } catch (e) {
      const { status, message, code } = statusForError(e);
      sendError(res, status, message, code ?? undefined);
    }
  });

  router.post("/api/t/:tableToken/identify", async ({ req, res, params }) => {
    let body: unknown;
    try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, (e as Error).message); }
    const parsed = parsePairIdentificationRequest(body);
    if (!parsed.ok) return sendError(res, 400, parsed.errors.join("; "));
    const loc = resolveTable(db, params.tableToken!, res);
    if (!loc) return;
    const event = getEvent(db, loc.eventId)!;
    const toPlayer = (p: typeof parsed.value.player1) => p.kind === "member" ? { name: `member:${p.memberId}`, memberId: p.memberId } : { name: p.name, memberId: null };
    try {
      const { side } = parsed.value;
      const pairNumber = requirePairNumberAtTable(db, loc.eventId, event.current_round, loc.table, side);
      identifyPair(db, loc.eventId, side, pairNumber, [toPlayer(parsed.value.player1), toPlayer(parsed.value.player2)]);
      sendJson(res, 200, { ok: true });
    } catch (e) {
      const { status, message, code } = statusForError(e);
      sendError(res, status, message, code ?? undefined);
    }
  });

  router.post("/api/t/:tableToken/result", async ({ req, res, params }) => {
    let body: unknown;
    try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, (e as Error).message); }
    const loc = resolveTable(db, params.tableToken!, res);
    if (!loc) return;
    // `table` is identified by the URL's tableToken, not sent by the client; inject it so the
    // shared ResultSubmission shape (which also serves contexts where table isn't implicit) validates.
    const parsed = parseResultSubmission({ ...(body as object), table: loc.table });
    if (!parsed.ok) return sendError(res, 400, parsed.errors.join("; "));
    try {
      const v = parsed.value;
      const r = submitResult(db, loc.eventId, v.round, loc.table, v.board, v.clientEventId, v.result);
      wsHub.broadcast(loc.eventId, { type: "result_entered", result: toResultDto(r) });
      sendJson(res, 201, toResultDto(r));
    } catch (e) {
      const { status, message, code } = statusForError(e);
      sendError(res, status, message, code ?? undefined);
    }
  });

  router.post("/api/t/:tableToken/confirm", async ({ req, res, params }) => {
    let body: unknown;
    try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, (e as Error).message); }
    const parsed = parseConfirmResultRequest(body);
    if (!parsed.ok) return sendError(res, 400, parsed.errors.join("; "));
    const loc = resolveTable(db, params.tableToken!, res);
    if (!loc) return;
    try {
      const r = confirmResult(db, loc.eventId, parsed.value.resultId);
      wsHub.broadcast(loc.eventId, { type: "result_confirmed", resultId: r.id });
      wsHub.broadcast(loc.eventId, { type: "ranking_updated" });
      sendJson(res, 200, toResultDto(r));
    } catch (e) {
      const { status, message, code } = statusForError(e);
      sendError(res, status, message, code ?? undefined);
    }
  });

  router.post("/api/t/:tableToken/call-director", async ({ req, res, params }) => {
    let body: unknown;
    try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, (e as Error).message); }
    const parsed = parseCallDirectorRequest(body);
    if (!parsed.ok) return sendError(res, 400, parsed.errors.join("; "));
    const loc = resolveTable(db, params.tableToken!, res);
    if (!loc) return;
    addAudit(db, loc.eventId, `table-${loc.table}`, "call_director", { message: parsed.value.message ?? null });
    wsHub.broadcast(loc.eventId, { type: "director_message", table: loc.table, text: parsed.value.message ?? "" });
    sendJson(res, 200, { ok: true });
  });

  // -------------------------------------------------------------------------

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://internal");
    const matched = router.match(req.method ?? "GET", url.pathname);
    if (matched) {
      try {
        await matched.handler({ req, res, params: matched.params, query: url.searchParams });
      } catch (e) {
        const { status, message, code } = statusForError(e);
        sendError(res, status, message, code ?? undefined);
      }
      return;
    }
    // Not an API/WS route: serve the table PWA's static files (same origin,
    // so the phone never hits a cross-origin request to reach the API).
    if ((req.method ?? "GET") === "GET" && !url.pathname.startsWith("/api/") && !url.pathname.startsWith("/ws/")) {
      const served = await serveStatic(url.pathname, res);
      if (served) return;
    }
    sendError(res, 404, "not found", "NOT_FOUND");
  });
  wsHub.attach(server);

  return { server, db, wsHub };
}

function requirePairNumberAtTable(db: Db, eventId: string, round: number, table: number, side: "NS" | "EW"): number {
  const row = db.get<{ ns_pair: number | null; ew_pair: number | null }>(
    `SELECT ns_pair, ew_pair FROM movement_slot WHERE event_id = ? AND round = ? AND table_number = ?`,
    [eventId, round, table],
  );
  const pair = side === "NS" ? row?.ns_pair : row?.ew_pair;
  if (pair == null) throw new Error(`no ${side} pair scheduled at table ${table} this round`);
  return pair;
}
