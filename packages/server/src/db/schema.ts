import type { Db } from "./connection.ts";

/**
 * Schema notes:
 * - `boards` on movement_slot is a JSON array of board numbers (e.g. "[4,5,6]"),
 *   mirroring Slot.boards from @bridge/movement rather than normalizing it into
 *   its own table — it's read-only once the event is created.
 * - `result` is keyed by (event_id, round, table, board) as the natural slot
 *   identity, with a separate `id` for stable external references (ResultDto.id).
 *   `client_event_id` carries the submitting device's idempotency key so a
 *   retried offline-queue entry never creates a second row (see ResultService).
 * - `version` is bumped on every edit and is the optimistic-concurrency token
 *   DirectorEditResultRequest.ifVersion is checked against.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS event (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  event_code      TEXT NOT NULL,
  tables          INTEGER NOT NULL,
  boards_per_round INTEGER NOT NULL,
  rounds          INTEGER NOT NULL,
  skip_after_round INTEGER,
  phantom_side    TEXT,
  phantom_pair    INTEGER,
  current_round   INTEGER NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'running',
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pair (
  event_id        TEXT NOT NULL REFERENCES event(id),
  side            TEXT NOT NULL CHECK (side IN ('NS','EW')),
  number          INTEGER NOT NULL,
  player1_member_id TEXT,
  player1_name    TEXT,
  player2_member_id TEXT,
  player2_name    TEXT,
  identified      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, side, number)
);

CREATE TABLE IF NOT EXISTS "table" (
  event_id        TEXT NOT NULL REFERENCES event(id),
  number          INTEGER NOT NULL,
  qr_token        TEXT NOT NULL UNIQUE,
  lock_state      TEXT NOT NULL DEFAULT 'none' CHECK (lock_state IN ('none','director_editing','locked')),
  locked_by       TEXT,
  locked_at       TEXT,
  PRIMARY KEY (event_id, number)
);

CREATE TABLE IF NOT EXISTS movement_slot (
  event_id        TEXT NOT NULL REFERENCES event(id),
  round           INTEGER NOT NULL,
  table_number    INTEGER NOT NULL,
  ns_pair         INTEGER,
  ew_pair         INTEGER,
  board_set       INTEGER,
  boards          TEXT NOT NULL,
  PRIMARY KEY (event_id, round, table_number)
);

CREATE TABLE IF NOT EXISTS result (
  id              TEXT PRIMARY KEY,
  event_id        TEXT NOT NULL REFERENCES event(id),
  round           INTEGER NOT NULL,
  table_number    INTEGER NOT NULL,
  board           INTEGER NOT NULL,
  ns_pair         INTEGER NOT NULL,
  ew_pair         INTEGER NOT NULL,
  contract_text   TEXT,
  declarer        TEXT,
  tricks          INTEGER,
  ns_score        INTEGER,
  adjusted_ns_pct REAL,
  adjusted_ew_pct REAL,
  status          TEXT NOT NULL CHECK (status IN ('entered','confirmed','voided','adjusted')),
  edited_by       TEXT NOT NULL CHECK (edited_by IN ('table','director')),
  version         INTEGER NOT NULL DEFAULT 1,
  client_event_id TEXT NOT NULL,
  entered_at      TEXT NOT NULL,
  confirmed_at    TEXT,
  UNIQUE (event_id, round, table_number, board),
  UNIQUE (event_id, client_event_id)
);

CREATE TABLE IF NOT EXISTS device_session (
  id              TEXT PRIMARY KEY,
  event_id        TEXT NOT NULL REFERENCES event(id),
  table_number    INTEGER NOT NULL,
  device_token    TEXT NOT NULL UNIQUE,
  connected_at    TEXT NOT NULL,
  last_seen_at    TEXT NOT NULL,
  is_active       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS audit_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id        TEXT NOT NULL REFERENCES event(id),
  ts              TEXT NOT NULL,
  actor           TEXT NOT NULL,
  action          TEXT NOT NULL,
  details         TEXT NOT NULL
);
`;

export function migrate(db: Db): void {
  db.exec(SCHEMA_SQL);
}
