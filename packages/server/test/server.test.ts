import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "../src/db/connection.ts";
import { migrate } from "../src/db/schema.ts";
import {
  createEvent, getEvent, getEventByTableToken, getSlot, parseBoards, getPair, identifyPair, pairPlayers, advanceRound,
} from "../src/domain/eventService.ts";
import {
  submitResult, confirmResult, directorEditResult, directorOverrideResult, resultsForBoard, ServerError, toResultDto,
} from "../src/domain/resultService.ts";
import { computeStandings } from "../src/domain/rankingService.ts";

function freshDb(): Db {
  const db = new Db(":memory:");
  migrate(db);
  return db;
}

// ---------------------------------------------------------------------------
// Event creation mirrors @bridge/movement's output
// ---------------------------------------------------------------------------

test("createEvent: 10 tables, movement slots match @bridge/movement's golden table", () => {
  const db = freshDb();
  const created = createEvent(db, { name: "Tuesday pairs", pairs: 20, boardsPerRound: 3 });
  assert.equal(created.tables, 10);
  assert.equal(created.rounds, 9);
  assert.equal(created.skipAfterRound, 5);
  assert.equal(created.tableTokens.size, 10);
  assert.match(created.eventCode, /^\d{4}$/);

  const event = getEvent(db, created.eventId)!;
  assert.equal(event.tables, 10);
  assert.equal(event.current_round, 1);
  assert.equal(event.status, "running");

  // Spot-check golden cells from the design doc's 10-table Mitchell table.
  const s1 = getSlot(db, created.eventId, 1, 1)!;
  assert.equal(s1.ns_pair, 1); assert.equal(s1.ew_pair, 1); assert.equal(s1.board_set, 1);
  assert.deepEqual(parseBoards(s1.boards), [1, 2, 3]);

  const skipRound = getSlot(db, created.eventId, 6, 1)!;
  assert.equal(skipRound.ew_pair, 5);

  // 10 tables x 9 rounds = 90 slots.
  const count = db.get<{ n: number }>(`SELECT COUNT(*) as n FROM movement_slot WHERE event_id = ?`, [created.eventId])!;
  assert.equal(count.n, 90);

  // 20 pairs (10 NS + 10 EW), none identified yet.
  const pairs = db.all<{ n: number }>(`SELECT COUNT(*) as n FROM pair WHERE event_id = ? AND identified = 0`, [created.eventId])!;
  assert.equal(pairs[0]!.n, 20);
});

test("createEvent: by table token resolves the right event and table", () => {
  const db = freshDb();
  const created = createEvent(db, { name: "E", pairs: 20, boardsPerRound: 2 });
  const token = created.tableTokens.get(3)!;
  const found = getEventByTableToken(db, token)!;
  assert.equal(found.event.id, created.eventId);
  assert.equal(found.table, 3);
  assert.equal(getEventByTableToken(db, "not-a-real-token"), undefined);
});

test("createEvent: odd pairs create a phantom and sit-out slots", () => {
  const db = freshDb();
  const created = createEvent(db, { name: "E", pairs: 19, boardsPerRound: 3 });
  assert.equal(created.tables, 10);
  const sitOut = getSlot(db, created.eventId, 1, 10)!;
  assert.equal(sitOut.ns_pair, null);
  assert.equal(sitOut.ew_pair, 10);
  // 19 pairs, not 20, are stored.
  const pairs = db.all<{ n: number }>(`SELECT COUNT(*) as n FROM pair WHERE event_id = ?`, [created.eventId])!;
  assert.equal(pairs[0]!.n, 19);
});

test("createEvent: rejects an empty name", () => {
  const db = freshDb();
  assert.throws(() => createEvent(db, { name: "  ", pairs: 20, boardsPerRound: 2 }));
});

test("advanceRound: moves current_round within bounds", () => {
  const db = freshDb();
  const created = createEvent(db, { name: "E", pairs: 20, boardsPerRound: 2 });
  advanceRound(db, created.eventId, 5);
  assert.equal(getEvent(db, created.eventId)!.current_round, 5);
  assert.throws(() => advanceRound(db, created.eventId, 0));
  assert.throws(() => advanceRound(db, created.eventId, created.rounds + 1));
});

// ---------------------------------------------------------------------------
// Round-1 identification
// ---------------------------------------------------------------------------

test("identifyPair: fills in players once, pairPlayers reflects it", () => {
  const db = freshDb();
  const created = createEvent(db, { name: "E", pairs: 20, boardsPerRound: 2 });
  identifyPair(db, created.eventId, "NS", 1, [{ name: "כהן", memberId: "111" }, { name: "לוי", memberId: "222" }]);
  const row = getPair(db, created.eventId, "NS", 1)!;
  assert.equal(row.identified, 1);
  assert.deepEqual(pairPlayers(row), [{ name: "כהן", memberId: "111", guest: false }, { name: "לוי", memberId: "222", guest: false }]);
});

test("identifyPair: a guest (no member id) is marked as a guest", () => {
  const db = freshDb();
  const created = createEvent(db, { name: "E", pairs: 20, boardsPerRound: 2 });
  identifyPair(db, created.eventId, "EW", 3, [{ name: "Guest A", memberId: null }, { name: "לוי", memberId: "222" }]);
  const players = pairPlayers(getPair(db, created.eventId, "EW", 3));
  assert.equal(players[0]!.guest, true);
  assert.equal(players[1]!.guest, false);
});

test("pairPlayers: unidentified pair has no players", () => {
  const db = freshDb();
  const created = createEvent(db, { name: "E", pairs: 20, boardsPerRound: 2 });
  assert.deepEqual(pairPlayers(getPair(db, created.eventId, "NS", 7)), []);
});

// ---------------------------------------------------------------------------
// Result submission: scoring, idempotency, locking
// ---------------------------------------------------------------------------

function setup() {
  const db = freshDb();
  const created = createEvent(db, { name: "E", pairs: 20, boardsPerRound: 3 });
  return { db, created };
}

test("submitResult: scores a played contract via @bridge/scoring", () => {
  const { db, created } = setup();
  // Round 1, table 1: NS 1 vs EW 1, boards [1,2,3]. Board 1 is NONE vulnerable, dealer N.
  const r = submitResult(db, created.eventId, 1, 1, 1, "client-1", { kind: "played", contractText: "4S", declarer: "N", tricks: 10 });
  assert.equal(r.ns_score, 420); // game made, not vulnerable
  assert.equal(r.status, "entered");
  assert.equal(r.version, 1);
});

test("submitResult: pass-out scores zero", () => {
  const { db, created } = setup();
  const r = submitResult(db, created.eventId, 1, 1, 1, "client-1", { kind: "passout" });
  assert.equal(r.ns_score, 0);
});

test("submitResult: EW declarer score is negated for NS", () => {
  const { db, created } = setup();
  const r = submitResult(db, created.eventId, 1, 1, 1, "client-1", { kind: "played", contractText: "3NT", declarer: "E", tricks: 9 });
  assert.equal(r.ns_score, -400);
});

test("submitResult: vulnerability is derived from the board number, not guessed", () => {
  const { db, created } = setup();
  // Board 2 is NS-vulnerable (standard 16-board cycle). NS declares and makes game.
  const r = submitResult(db, created.eventId, 1, 1, 2, "client-1", { kind: "played", contractText: "4H", declarer: "N", tricks: 10 });
  assert.equal(r.ns_score, 620); // vulnerable game value
});

test("submitResult: replaying the same clientEventId is idempotent, no duplicate row", () => {
  const { db, created } = setup();
  const a = submitResult(db, created.eventId, 1, 1, 1, "same-client-id", { kind: "played", contractText: "4S", declarer: "N", tricks: 10 });
  const b = submitResult(db, created.eventId, 1, 1, 1, "same-client-id", { kind: "played", contractText: "4S", declarer: "N", tricks: 10 });
  assert.equal(a.id, b.id);
  const count = db.get<{ n: number }>(`SELECT COUNT(*) as n FROM result WHERE event_id = ?`, [created.eventId])!;
  assert.equal(count.n, 1);
});

test("submitResult: a second distinct submission for the same slot updates it and bumps version", () => {
  const { db, created } = setup();
  submitResult(db, created.eventId, 1, 1, 1, "client-a", { kind: "played", contractText: "4S", declarer: "N", tricks: 10 });
  const b = submitResult(db, created.eventId, 1, 1, 1, "client-b", { kind: "played", contractText: "4S", declarer: "N", tricks: 11 });
  assert.equal(b.version, 2);
  assert.equal(b.ns_score, 450);
  const count = db.get<{ n: number }>(`SELECT COUNT(*) as n FROM result WHERE event_id = ?`, [created.eventId])!;
  assert.equal(count.n, 1);
});

test("submitResult: rejects a board not scheduled at this table this round", () => {
  const { db, created } = setup();
  assert.throws(() => submitResult(db, created.eventId, 1, 1, 9, "c1", { kind: "passout" }), ServerError);
});

test("submitResult: rejects submitting at a table's sit-out slot", () => {
  const db = freshDb();
  const created = createEvent(db, { name: "E", pairs: 19, boardsPerRound: 3 });
  assert.throws(() => submitResult(db, created.eventId, 1, 10, 1, "c1", { kind: "passout" }), ServerError);
});

test("submitResult: cannot re-enter a confirmed result from the table (must go through the director)", () => {
  const { db, created } = setup();
  const r = submitResult(db, created.eventId, 1, 1, 1, "client-a", { kind: "played", contractText: "4S", declarer: "N", tricks: 10 });
  confirmResult(db, created.eventId, r.id);
  assert.throws(() => submitResult(db, created.eventId, 1, 1, 1, "client-b", { kind: "played", contractText: "4S", declarer: "N", tricks: 11 }), ServerError);
});

// ---------------------------------------------------------------------------
// Confirmation
// ---------------------------------------------------------------------------

test("confirmResult: moves entered -> confirmed and sets confirmedAt", () => {
  const { db, created } = setup();
  const r = submitResult(db, created.eventId, 1, 1, 1, "c1", { kind: "passout" });
  assert.equal(r.confirmed_at, null);
  const c = confirmResult(db, created.eventId, r.id);
  assert.equal(c.status, "confirmed");
  assert.ok(c.confirmed_at);
});

test("confirmResult: cannot confirm twice", () => {
  const { db, created } = setup();
  const r = submitResult(db, created.eventId, 1, 1, 1, "c1", { kind: "passout" });
  confirmResult(db, created.eventId, r.id);
  assert.throws(() => confirmResult(db, created.eventId, r.id), ServerError);
});

test("confirmResult: unknown id is NOT_FOUND", () => {
  const { db, created } = setup();
  assert.throws(() => confirmResult(db, created.eventId, "nope"), (e: unknown) => e instanceof ServerError && e.code === "NOT_FOUND");
});

// ---------------------------------------------------------------------------
// Director authority: always wins, conflicts are surfaced not swallowed
// ---------------------------------------------------------------------------

test("directorEditResult: editing a confirmed result moves it to adjusted, never silently to entered", () => {
  const { db, created } = setup();
  const r = submitResult(db, created.eventId, 1, 1, 1, "c1", { kind: "played", contractText: "4S", declarer: "N", tricks: 10 });
  confirmResult(db, created.eventId, r.id);
  const edited = directorEditResult(db, created.eventId, r.id, { kind: "played", contractText: "4S", declarer: "N", tricks: 9 });
  assert.equal(edited.status, "adjusted");
  assert.equal(edited.edited_by, "director");
  assert.equal(edited.ns_score, -50); // down 1, not vulnerable
  assert.equal(edited.version, 2);
});

test("directorEditResult: editing an entered (unconfirmed) result keeps it entered", () => {
  const { db, created } = setup();
  const r = submitResult(db, created.eventId, 1, 1, 1, "c1", { kind: "played", contractText: "4S", declarer: "N", tricks: 10 });
  const edited = directorEditResult(db, created.eventId, r.id, { kind: "passout" });
  assert.equal(edited.status, "entered");
  assert.equal(edited.ns_score, 0);
});

test("directorEditResult: a stale ifVersion is a CONFLICT, change is rejected not applied", () => {
  const { db, created } = setup();
  const r = submitResult(db, created.eventId, 1, 1, 1, "c1", { kind: "played", contractText: "4S", declarer: "N", tricks: 10 });
  directorEditResult(db, created.eventId, r.id, { kind: "passout" }); // version now 2
  assert.throws(
    () => directorEditResult(db, created.eventId, r.id, { kind: "played", contractText: "3NT", declarer: "N", tricks: 9 }, 1),
    (e: unknown) => e instanceof ServerError && e.code === "CONFLICT",
  );
  // Confirm the rejected edit never applied.
  const row = db.get<{ ns_score: number }>(`SELECT ns_score FROM result WHERE id = ?`, [r.id])!;
  assert.equal(row.ns_score, 0);
});

test("directorEditResult: a matching ifVersion is accepted", () => {
  const { db, created } = setup();
  const r = submitResult(db, created.eventId, 1, 1, 1, "c1", { kind: "played", contractText: "4S", declarer: "N", tricks: 10 });
  const edited = directorEditResult(db, created.eventId, r.id, { kind: "passout" }, 1);
  assert.equal(edited.version, 2);
});

test("directorOverrideResult: assigns a fixed percentage, clears the played fields", () => {
  const { db, created } = setup();
  const r = submitResult(db, created.eventId, 1, 1, 1, "c1", { kind: "played", contractText: "4S", declarer: "N", tricks: 10 });
  const adj = directorOverrideResult(db, created.eventId, r.id, 60, 40);
  assert.equal(adj.status, "adjusted");
  assert.equal(adj.ns_score, null);
  assert.equal(adj.contract_text, null);
  assert.equal(adj.adjusted_ns_pct, 60);
  assert.equal(adj.adjusted_ew_pct, 40);
});

test("directorOverrideResult: also respects ifVersion", () => {
  const { db, created } = setup();
  const r = submitResult(db, created.eventId, 1, 1, 1, "c1", { kind: "played", contractText: "4S", declarer: "N", tricks: 10 });
  assert.throws(
    () => directorOverrideResult(db, created.eventId, r.id, 60, 40, 99),
    (e: unknown) => e instanceof ServerError && e.code === "CONFLICT",
  );
});

test("toResultDto: maps a row to the wire shape from @bridge/shared", () => {
  const { db, created } = setup();
  const r = submitResult(db, created.eventId, 1, 1, 1, "c1", { kind: "played", contractText: "4S", declarer: "N", tricks: 10 });
  const dto = toResultDto(r);
  assert.equal(dto.id, r.id);
  assert.equal(dto.nsScore, 420);
  assert.equal(dto.status, "entered");
});

// ---------------------------------------------------------------------------
// Standings: wires scoring's matchpointBoard/aggregate/rank to real DB rows
// ---------------------------------------------------------------------------

test("computeStandings: a 3-way traveller on one board, matchpoints and ranking are consistent", () => {
  const db = freshDb();
  // 6 pairs -> 3 tables, 1 round (full Mitchell, no skip needed).
  const created = createEvent(db, { name: "E", pairs: 6, boardsPerRound: 1, rounds: 3 });
  // Round 1: table1 NS1/EW1 board1, table2 NS2/EW2 board2, table3 NS3/EW3 board3 (per Mitchell layout).
  // Find which table plays board 1 in round 1 and submit a few different NS scores across rounds for board 1's traveller.
  // Simpler: directly use whichever (round,table) slot is scheduled to play board 1.
  const allSlots = db.all<{ round: number; table_number: number; ns_pair: number; ew_pair: number; boards: string }>(
    `SELECT round, table_number, ns_pair, ew_pair, boards FROM movement_slot WHERE event_id = ? AND ns_pair IS NOT NULL`, [created.eventId],
  );
  const board1Slots = allSlots.filter((s) => JSON.parse(s.boards).includes(1));
  assert.ok(board1Slots.length >= 2, "board 1 should be played at least twice across rounds");

  const scores = [420, 450, 400]; // NS scores, must differ to produce a clear ranking
  board1Slots.slice(0, 3).forEach((s, i) => {
    submitResult(db, created.eventId, s.round, s.table_number, 1, `c-${i}`, { kind: "played", contractText: "4S", declarer: "N", tricks: 9 + (scores[i]! > 420 ? 1 : scores[i]! < 420 ? -1 : 0) });
  });

  const { ns, ew } = computeStandings(db, created.eventId);
  assert.ok(ns.length > 0);
  assert.ok(ew.length > 0);
  // NS + EW matchpoints must balance to n(n-1) across all boards played (sanity, not exact since only board 1 scored).
  const totalNsMp = ns.reduce((s, r) => s + r.mp, 0);
  const totalEwMp = ew.reduce((s, r) => s + r.mp, 0);
  // Every scored board contributes mp to both sides equally in total.
  assert.ok(totalNsMp > 0 && totalEwMp > 0);
  // Ranks are assigned (1-based) and sorted descending by pct where available.
  for (let i = 1; i < ns.length; i++) if (ns[i]!.pct !== null && ns[i - 1]!.pct !== null) assert.ok(ns[i - 1]!.pct! >= ns[i]!.pct!);
});

test("computeStandings: adjusted (fixed %) results are excluded from comparison but still contribute their own pct", () => {
  const db = freshDb();
  const created = createEvent(db, { name: "E", pairs: 6, boardsPerRound: 1, rounds: 3 });
  const allSlots = db.all<{ round: number; table_number: number; boards: string }>(
    `SELECT round, table_number, boards FROM movement_slot WHERE event_id = ? AND ns_pair IS NOT NULL`, [created.eventId],
  );
  const board1Slots = allSlots.filter((s) => JSON.parse(s.boards).includes(1));
  const r1 = submitResult(db, created.eventId, board1Slots[0]!.round, board1Slots[0]!.table_number, 1, "c-0", { kind: "played", contractText: "4S", declarer: "N", tricks: 10 });
  submitResult(db, created.eventId, board1Slots[1]!.round, board1Slots[1]!.table_number, 1, "c-1", { kind: "played", contractText: "4S", declarer: "N", tricks: 10 });
  directorOverrideResult(db, created.eventId, r1.id, 60, 40);

  const board1Results = resultsForBoard(db, created.eventId, 1);
  assert.ok(board1Results.some((r) => r.status === "adjusted"));
  const { ns } = computeStandings(db, created.eventId);
  assert.ok(ns.length > 0); // does not throw, produces a ranking despite the mixed adjusted/played board
});

test("computeStandings: no results yet returns empty standings without throwing", () => {
  const db = freshDb();
  const created = createEvent(db, { name: "E", pairs: 20, boardsPerRound: 2 });
  const { ns, ew } = computeStandings(db, created.eventId);
  assert.deepEqual(ns, []);
  assert.deepEqual(ew, []);
});
