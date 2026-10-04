/**
 * Wraps @bridge/movement: turns a movement-generation request into persisted
 * event/table/pair/movement_slot rows, and answers the read queries a table's
 * phone or the director app need. The movement engine itself is never called
 * again after creation — its output is the schedule, stored once.
 */
import { generateMitchellForPairs } from "../../../movement/src/index.ts";
import type { PairsParams } from "../../../movement/src/index.ts";
import type { PlayerRef, ResultStatus } from "../../../shared/src/index.ts";
import type { Db } from "../db/connection.ts";
import { hashPin, newDirectorPin, newEventCode, newId, newTableToken, now } from "../util.ts";

export interface CreateEventInput {
  name: string;
  pairs: number;
  boardsPerRound: number;
  rounds?: number;
  phantomSide?: "NS" | "EW";
  /** Lets whoever sets up the event pick the director PIN instead of getting a random one. */
  directorPin?: string;
}

export interface CreatedEvent {
  eventId: string;
  eventCode: string;
  tables: number;
  rounds: number;
  skipAfterRound: number | null;
  /** table number -> QR token, for printing. */
  tableTokens: Map<number, string>;
  /**
   * The director PIN in plaintext — returned ONLY here, at creation. It is
   * never stored or returned again (only its salted hash is persisted), so
   * whoever creates the event must write it down now.
   */
  directorPin: string;
}

export function createEvent(db: Db, input: CreateEventInput): CreatedEvent {
  if (!input.name.trim()) throw new Error("name is required");
  const params: PairsParams = {
    pairs: input.pairs,
    boardsPerRound: input.boardsPerRound,
    rounds: input.rounds,
    phantomSide: input.phantomSide,
  };
  const movement = generateMitchellForPairs(params);
  const eventId = newId();
  const eventCode = newEventCode();
  const directorPin = input.directorPin?.trim() || newDirectorPin();
  const { hash, salt } = hashPin(directorPin);
  const tableTokens = new Map<number, string>();

  db.transaction(() => {
    db.run(
      `INSERT INTO event (id, name, event_code, director_pin_hash, director_pin_salt, tables, boards_per_round, rounds, skip_after_round, phantom_side, phantom_pair, current_round, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'running', ?)`,
      [eventId, input.name, eventCode, hash, salt, movement.params.tables, movement.params.boardsPerRound, movement.params.rounds,
        movement.params.skipAfterRound, movement.params.phantom?.side ?? null, movement.params.phantom?.pair ?? null, now()],
    );

    for (let t = 1; t <= movement.params.tables; t++) {
      const token = newTableToken();
      tableTokens.set(t, token);
      db.run(`INSERT INTO "table" (event_id, number, qr_token) VALUES (?, ?, ?)`, [eventId, t, token]);
    }

    const phantom = movement.params.phantom;
    for (let p = 1; p <= movement.params.tables; p++) {
      for (const side of ["NS", "EW"] as const) {
        if (phantom?.side === side && phantom.pair === p) continue; // no DB row for the phantom
        db.run(`INSERT INTO pair (event_id, side, number) VALUES (?, ?, ?)`, [eventId, side, p]);
      }
    }

    for (const s of movement.slots) {
      db.run(
        `INSERT INTO movement_slot (event_id, round, table_number, ns_pair, ew_pair, board_set, boards) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [eventId, s.round, s.table, s.nsPair, s.ewPair, s.boardSet, JSON.stringify(s.boards)],
      );
    }
  });

  return {
    eventId, eventCode, tables: movement.params.tables, rounds: movement.params.rounds,
    skipAfterRound: movement.params.skipAfterRound, tableTokens, directorPin,
  };
}

export interface EventRow {
  id: string;
  name: string;
  event_code: string;
  director_pin_hash: string;
  director_pin_salt: string;
  tables: number;
  boards_per_round: number;
  rounds: number;
  current_round: number;
  status: string;
}

export function getEvent(db: Db, eventId: string): EventRow | undefined {
  return db.get<EventRow>(`SELECT * FROM event WHERE id = ?`, [eventId]);
}

/** Strips the director PIN's hash/salt — this is the shape safe to hand back over the API. */
export function publicEvent(row: EventRow): Omit<EventRow, "director_pin_hash" | "director_pin_salt"> {
  const { director_pin_hash, director_pin_salt, ...rest } = row;
  return rest;
}

export function getEventByTableToken(db: Db, tableToken: string): { event: EventRow; table: number } | undefined {
  const row = db.get<{ event_id: string; number: number }>(`SELECT event_id, number FROM "table" WHERE qr_token = ?`, [tableToken]);
  if (!row) return undefined;
  const event = getEvent(db, row.event_id);
  return event ? { event, table: row.number } : undefined;
}

export interface MovementSlotRow {
  round: number;
  table_number: number;
  ns_pair: number | null;
  ew_pair: number | null;
  board_set: number | null;
  boards: string;
}

export function getSlot(db: Db, eventId: string, round: number, table: number): MovementSlotRow | undefined {
  return db.get<MovementSlotRow>(
    `SELECT * FROM movement_slot WHERE event_id = ? AND round = ? AND table_number = ?`,
    [eventId, round, table],
  );
}

export function parseBoards(boardsJson: string): number[] {
  return JSON.parse(boardsJson) as number[];
}

export interface PairRow {
  side: "NS" | "EW";
  number: number;
  player1_member_id: string | null;
  player1_name: string | null;
  player2_member_id: string | null;
  player2_name: string | null;
  identified: number;
}

export function getPair(db: Db, eventId: string, side: "NS" | "EW", number: number): PairRow | undefined {
  return db.get<PairRow>(`SELECT * FROM pair WHERE event_id = ? AND side = ? AND number = ?`, [eventId, side, number]);
}

export function pairPlayers(row: PairRow | undefined): PlayerRef[] {
  if (!row) return [];
  const out: PlayerRef[] = [];
  if (row.player1_name) out.push({ name: row.player1_name, memberId: row.player1_member_id, guest: row.player1_member_id === null });
  if (row.player2_name) out.push({ name: row.player2_name, memberId: row.player2_member_id, guest: row.player2_member_id === null });
  return out;
}

/** Round-1 identification: fills in the two players of a pair, keyed by (round1 seat), see design doc section 3.3. */
export function identifyPair(
  db: Db,
  eventId: string,
  side: "NS" | "EW",
  number: number,
  players: [{ name: string; memberId: string | null }, { name: string; memberId: string | null }],
): void {
  db.run(
    `UPDATE pair SET player1_member_id = ?, player1_name = ?, player2_member_id = ?, player2_name = ?, identified = 1
     WHERE event_id = ? AND side = ? AND number = ?`,
    [players[0].memberId, players[0].name, players[1].memberId, players[1].name, eventId, side, number],
  );
}

export function advanceRound(db: Db, eventId: string, round: number): void {
  const event = getEvent(db, eventId);
  if (!event) throw new Error("event not found");
  if (round < 1 || round > event.rounds) throw new RangeError(`round must be 1..${event.rounds}`);
  db.run(`UPDATE event SET current_round = ? WHERE id = ?`, [round, eventId]);
}

export const ACTIVE_STATUSES: readonly ResultStatus[] = ["entered", "confirmed", "adjusted"];
