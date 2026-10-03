/**
 * Wraps @bridge/scoring: turns a raw submission from a table phone into a scored,
 * persisted Result row, and implements the authority rules from the design doc
 * (section 3.2): a director's write always wins, nothing is silently overwritten,
 * and a retried offline-queue entry (same client_event_id) is a no-op, not a
 * duplicate.
 */
import { declarerScore, isVulnerable, parseContract, vulnerabilityForBoard } from "../../../scoring/src/index.ts";
import type { ResultDto } from "../../../shared/src/index.ts";
import type { Db } from "../db/connection.ts";
import { getEvent, getSlot, parseBoards } from "./eventService.ts";
import { isTableWritableByDevice } from "./deviceService.ts";
import { newId, now } from "../util.ts";

export type ServerErrorCode = "NOT_FOUND" | "CONFLICT" | "LOCKED" | "ALREADY_CONFIRMED" | "VALIDATION";

export class ServerError extends Error {
  code: ServerErrorCode;
  constructor(code: ServerErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface ResultRow {
  id: string;
  event_id: string;
  round: number;
  table_number: number;
  board: number;
  ns_pair: number;
  ew_pair: number;
  contract_text: string | null;
  declarer: string | null;
  tricks: number | null;
  ns_score: number | null;
  adjusted_ns_pct: number | null;
  adjusted_ew_pct: number | null;
  status: "entered" | "confirmed" | "voided" | "adjusted";
  edited_by: "table" | "director";
  version: number;
  client_event_id: string;
  entered_at: string;
  confirmed_at: string | null;
}

export function toResultDto(r: ResultRow): ResultDto {
  return {
    id: r.id, round: r.round, table: r.table_number, board: r.board, nsPair: r.ns_pair, ewPair: r.ew_pair,
    contractText: r.contract_text, declarer: r.declarer, tricks: r.tricks, nsScore: r.ns_score ?? 0,
    status: r.status, version: r.version, enteredAt: r.entered_at, confirmedAt: r.confirmed_at,
  };
}

function scoreBoardResult(board: number, input: { kind: "passout" } | { kind: "played"; contractText: string; declarer: string; tricks: number }): number {
  if (input.kind === "passout") return 0;
  const c = parseContract(input.contractText);
  const vul = vulnerabilityForBoard(board);
  const declarerVul = isVulnerable(vul, input.declarer as "N" | "E" | "S" | "W");
  const s = declarerScore(c.level, c.denomination, c.doubling, declarerVul, input.tricks);
  return input.declarer === "N" || input.declarer === "S" ? s : -s;
}

export type BoardResultInput = { kind: "passout" } | { kind: "played"; contractText: string; declarer: string; tricks: number };

/**
 * Table submits a result for (round, table, board). Idempotent on clientEventId:
 * replaying the same submission (e.g. after a reconnect) returns the existing row
 * unchanged rather than erroring or duplicating it.
 */
export function submitResult(
  db: Db,
  eventId: string,
  round: number,
  table: number,
  board: number,
  clientEventId: string,
  input: BoardResultInput,
): ResultRow {
  const event = getEvent(db, eventId);
  if (!event) throw new ServerError("NOT_FOUND", "event not found");

  const dupe = db.get<ResultRow>(`SELECT * FROM result WHERE event_id = ? AND client_event_id = ?`, [eventId, clientEventId]);
  if (dupe) return dupe;

  if (!isTableWritableByDevice(db, eventId, table)) throw new ServerError("LOCKED", `table ${table} is locked by the director`);

  const slot = getSlot(db, eventId, round, table);
  if (!slot) throw new ServerError("NOT_FOUND", `no slot for round ${round}, table ${table}`);
  if (slot.ns_pair === null || slot.ew_pair === null) throw new ServerError("VALIDATION", "this table sits out this round");
  if (!parseBoards(slot.boards).includes(board)) throw new ServerError("VALIDATION", `board ${board} is not scheduled at this table this round`);

  const existing = db.get<ResultRow>(
    `SELECT * FROM result WHERE event_id = ? AND round = ? AND table_number = ? AND board = ?`,
    [eventId, round, table, board],
  );
  if (existing && existing.status !== "entered") {
    throw new ServerError("ALREADY_CONFIRMED", `result is already ${existing.status}; ask the director to change it`);
  }

  const nsScore = scoreBoardResult(board, input);
  const ts = now();

  return db.transaction(() => {
    if (existing) {
      const version = existing.version + 1;
      db.run(
        `UPDATE result SET contract_text = ?, declarer = ?, tricks = ?, ns_score = ?, adjusted_ns_pct = NULL, adjusted_ew_pct = NULL,
                            version = ?, client_event_id = ?, entered_at = ?, edited_by = 'table'
         WHERE id = ?`,
        [input.kind === "played" ? input.contractText : null, input.kind === "played" ? input.declarer : null,
          input.kind === "played" ? input.tricks : null, nsScore, version, clientEventId, ts, existing.id],
      );
      return { ...existing, contract_text: input.kind === "played" ? input.contractText : null, declarer: input.kind === "played" ? input.declarer : null,
        tricks: input.kind === "played" ? input.tricks : null, ns_score: nsScore, adjusted_ns_pct: null, adjusted_ew_pct: null,
        version, client_event_id: clientEventId, entered_at: ts, edited_by: "table" };
    }
    const id = newId();
    db.run(
      `INSERT INTO result (id, event_id, round, table_number, board, ns_pair, ew_pair, contract_text, declarer, tricks, ns_score,
                            status, edited_by, version, client_event_id, entered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'entered', 'table', 1, ?, ?)`,
      [id, eventId, round, table, board, slot.ns_pair, slot.ew_pair, input.kind === "played" ? input.contractText : null,
        input.kind === "played" ? input.declarer : null, input.kind === "played" ? input.tricks : null, nsScore, clientEventId, ts],
    );
    return {
      id, event_id: eventId, round, table_number: table, board, ns_pair: slot.ns_pair!, ew_pair: slot.ew_pair!,
      contract_text: input.kind === "played" ? input.contractText : null, declarer: input.kind === "played" ? input.declarer : null,
      tricks: input.kind === "played" ? input.tricks : null, ns_score: nsScore, adjusted_ns_pct: null, adjusted_ew_pct: null,
      status: "entered", edited_by: "table", version: 1, client_event_id: clientEventId, entered_at: ts, confirmed_at: null,
    };
  });
}

/** EW confirms a result currently in "entered" status. */
export function confirmResult(db: Db, eventId: string, resultId: string): ResultRow {
  const r = db.get<ResultRow>(`SELECT * FROM result WHERE id = ? AND event_id = ?`, [resultId, eventId]);
  if (!r) throw new ServerError("NOT_FOUND", "result not found");
  if (r.status !== "entered") throw new ServerError("VALIDATION", `cannot confirm a result that is ${r.status}`);
  if (!isTableWritableByDevice(db, eventId, r.table_number)) throw new ServerError("LOCKED", `table ${r.table_number} is locked by the director`);
  const ts = now();
  db.run(`UPDATE result SET status = 'confirmed', confirmed_at = ? WHERE id = ?`, [ts, resultId]);
  return { ...r, status: "confirmed", confirmed_at: ts };
}

/**
 * Director edits a result (section 3.2: the director always wins). If `ifVersion`
 * is given and no longer matches, this is a stale edit — rejected with CONFLICT,
 * never silently applied over newer data. Editing a confirmed result moves it to
 * "adjusted" so the change is visible rather than looking like an untouched
 * player-entered score.
 */
export function directorEditResult(db: Db, eventId: string, resultId: string, input: BoardResultInput, ifVersion?: number): ResultRow {
  const r = db.get<ResultRow>(`SELECT * FROM result WHERE id = ? AND event_id = ?`, [resultId, eventId]);
  if (!r) throw new ServerError("NOT_FOUND", "result not found");
  if (ifVersion !== undefined && ifVersion !== r.version)
    throw new ServerError("CONFLICT", `result has changed since you last saw it (version ${r.version}, you had ${ifVersion})`);

  const nsScore = scoreBoardResult(r.board, input);
  const nextStatus = r.status === "confirmed" || r.status === "adjusted" ? "adjusted" : "entered";
  const version = r.version + 1;
  db.run(
    `UPDATE result SET contract_text = ?, declarer = ?, tricks = ?, ns_score = ?, adjusted_ns_pct = NULL, adjusted_ew_pct = NULL,
                        status = ?, edited_by = 'director', version = ? WHERE id = ?`,
    [input.kind === "played" ? input.contractText : null, input.kind === "played" ? input.declarer : null,
      input.kind === "played" ? input.tricks : null, nsScore, nextStatus, version, resultId],
  );
  return { ...r, contract_text: input.kind === "played" ? input.contractText : null, declarer: input.kind === "played" ? input.declarer : null,
    tricks: input.kind === "played" ? input.tricks : null, ns_score: nsScore, adjusted_ns_pct: null, adjusted_ew_pct: null,
    status: nextStatus, edited_by: "director", version };
}

/** Director assigns a fixed percentage (Average, Average+/-, or an arbitrary split) instead of a played score. */
export function directorOverrideResult(db: Db, eventId: string, resultId: string, nsPct: number, ewPct: number, ifVersion?: number): ResultRow {
  const r = db.get<ResultRow>(`SELECT * FROM result WHERE id = ? AND event_id = ?`, [resultId, eventId]);
  if (!r) throw new ServerError("NOT_FOUND", "result not found");
  if (ifVersion !== undefined && ifVersion !== r.version)
    throw new ServerError("CONFLICT", `result has changed since you last saw it (version ${r.version}, you had ${ifVersion})`);
  const version = r.version + 1;
  db.run(
    `UPDATE result SET contract_text = NULL, declarer = NULL, tricks = NULL, ns_score = NULL,
                        adjusted_ns_pct = ?, adjusted_ew_pct = ?, status = 'adjusted', edited_by = 'director', version = ? WHERE id = ?`,
    [nsPct, ewPct, version, resultId],
  );
  return { ...r, contract_text: null, declarer: null, tricks: null, ns_score: null, adjusted_ns_pct: nsPct, adjusted_ew_pct: ewPct, status: "adjusted", edited_by: "director", version };
}

export function resultsForTableRound(db: Db, eventId: string, round: number, table: number): ResultRow[] {
  return db.all<ResultRow>(`SELECT * FROM result WHERE event_id = ? AND round = ? AND table_number = ? ORDER BY board`, [eventId, round, table]);
}

/** Every result for a given board number across the whole event (the "traveller"). */
export function resultsForBoard(db: Db, eventId: string, board: number): ResultRow[] {
  return db.all<ResultRow>(`SELECT * FROM result WHERE event_id = ? AND board = ? AND status != 'voided'`, [eventId, board]);
}
