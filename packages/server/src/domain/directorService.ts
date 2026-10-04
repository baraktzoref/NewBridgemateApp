/**
 * Director authentication — the level-1 authority from design doc section 3.2.
 * A director logs in once per event with the PIN handed out at createEvent
 * (plaintext, one time only) and gets back a bearer token; every other
 * director-only route (round advance, table lock/unlock, disconnect, result
 * edit/override) requires that token, scoped to that one event, so a PIN or
 * token leaked for one event's director screen can't be replayed against
 * another event.
 */
import type { Db } from "../db/connection.ts";
import { getEvent } from "./eventService.ts";
import { newId, now, verifyPin } from "../util.ts";

export type DirectorErrorCode = "NOT_FOUND" | "BAD_PIN" | "UNAUTHORIZED";

export class DirectorError extends Error {
  code: DirectorErrorCode;
  constructor(code: DirectorErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** A director session is considered stale (and rejected) after this long with no authenticated request. */
export const DIRECTOR_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export interface DirectorSessionRow {
  id: string;
  event_id: string;
  token: string;
  created_at: string;
  last_seen_at: string;
  is_active: number;
}

/** Checks the PIN and mints a new bearer token for this event. Throws DirectorError on a bad PIN. */
export function directorLogin(db: Db, eventId: string, pin: string): DirectorSessionRow {
  const event = getEvent(db, eventId);
  if (!event) throw new DirectorError("NOT_FOUND", "event not found");
  if (!verifyPin(pin, event.director_pin_hash, event.director_pin_salt)) {
    throw new DirectorError("BAD_PIN", "incorrect director PIN");
  }
  const id = newId();
  const token = newId();
  const ts = now();
  db.run(
    `INSERT INTO director_session (id, event_id, token, created_at, last_seen_at, is_active) VALUES (?, ?, ?, ?, ?, 1)`,
    [id, eventId, token, ts, ts],
  );
  db.run(`INSERT INTO audit_log (event_id, ts, actor, action, details) VALUES (?, ?, 'director', 'director_login', ?)`, [eventId, ts, "{}"]);
  return { id, event_id: eventId, token, created_at: ts, last_seen_at: ts, is_active: 1 };
}

/**
 * Validates that `token` is a live director session for `eventId` (not
 * revoked, not expired, and not — this is the point — a token minted for a
 * different event). Refreshes last_seen_at and returns the session on
 * success; throws DirectorError("UNAUTHORIZED") otherwise. Never silently
 * treats a missing/expired token as "not a director" without saying so, so
 * callers always get an explicit, auditable rejection rather than a
 * fallback.
 */
export function requireDirector(db: Db, eventId: string, token: string | undefined): DirectorSessionRow {
  if (!token) throw new DirectorError("UNAUTHORIZED", "director token required");
  const row = db.get<DirectorSessionRow>(
    `SELECT * FROM director_session WHERE token = ? AND event_id = ? AND is_active = 1`,
    [token, eventId],
  );
  if (!row) throw new DirectorError("UNAUTHORIZED", "invalid or revoked director token");
  const age = Date.now() - new Date(row.last_seen_at).getTime();
  if (age > DIRECTOR_SESSION_TTL_MS) {
    db.run(`UPDATE director_session SET is_active = 0 WHERE id = ?`, [row.id]);
    throw new DirectorError("UNAUTHORIZED", "director session expired; please log in again");
  }
  db.run(`UPDATE director_session SET last_seen_at = ? WHERE id = ?`, [now(), row.id]);
  return row;
}

/** Explicit director logout — ends just this one session/device, not every director session for the event. */
export function directorLogout(db: Db, token: string): void {
  db.run(`UPDATE director_session SET is_active = 0 WHERE token = ?`, [token]);
}
