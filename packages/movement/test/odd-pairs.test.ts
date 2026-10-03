import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateMitchell, generateMitchellForPairs, validateMovement, slotAt, ewRoute, nsRoute,
  sitOuts, pairSummary, boardSetPlays, unmetOpponents, unmetForEw, isSitOut,
} from "../src/index.ts";
import type { Movement } from "../src/index.ts";

const clone = (m: Movement): Movement => structuredClone(m);

// ---- 19 pairs = 10 tables, NS phantom (table 10 empty) ----
test("19 pairs: 10 tables, 9 rounds, skip after 5, table 10 is the empty table", () => {
  const m = generateMitchellForPairs({ pairs: 19, boardsPerRound: 3 });
  assert.equal(m.params.tables, 10);
  assert.equal(m.params.rounds, 9);
  assert.equal(m.params.skipAfterRound, 5);
  assert.deepEqual(m.params.phantom, { side: "NS", pair: 10 });
  assert.ok(m.slots.filter((s) => s.table === 10).every((s) => s.nsPair === null));
  assert.equal(validateMovement(m).ok, true);
});

test("19 pairs: exactly one sit-out per round, 9 different EW pairs, none twice", () => {
  const m = generateMitchellForPairs({ pairs: 19, boardsPerRound: 3 });
  const so = sitOuts(m);
  assert.equal(so.length, 9);
  assert.deepEqual(so.map((s) => s.round), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.ok(so.every((s) => s.side === "EW" && s.table === 10));
  assert.equal(new Set(so.map((s) => s.pair)).size, 9);
  // Same golden as the standard table: table 10 sees EW 10, 9, 8, 7, 6, 4, 3, 2, 1 (5 is skipped)
  assert.deepEqual(so.map((s) => s.pair), [10, 9, 8, 7, 6, 4, 3, 2, 1]);
});

test("19 pairs: pair counts. 9 EW pairs play 8 rounds, one EW plays all 9; NS all 9", () => {
  const m = generateMitchellForPairs({ pairs: 19, boardsPerRound: 3 });
  const sum = pairSummary(m);
  assert.equal(sum.length, 19);
  assert.ok(sum.filter((p) => p.side === "NS").every((p) => p.roundsPlayed === 9 && p.roundsSitOut === 0));
  const ew = sum.filter((p) => p.side === "EW");
  assert.equal(ew.filter((p) => p.roundsPlayed === 8).length, 9);
  assert.equal(ew.filter((p) => p.roundsPlayed === 9).length, 1);
  assert.equal(ew.find((p) => p.roundsPlayed === 8)!.boardsPlayed, 24);
});

test("19 pairs: board set plays: 9 sets played 8 times, one set played 9 times (unequal MP tops)", () => {
  const m = generateMitchellForPairs({ pairs: 19, boardsPerRound: 3 });
  const plays = boardSetPlays(m).map((b) => b.plays).sort();
  assert.deepEqual(plays, [8, 8, 8, 8, 8, 8, 8, 8, 8, 9]);
  const total = plays.reduce((a, b) => a + b, 0);
  assert.equal(total, m.slots.filter((s) => !isSitOut(s)).length);
});

test("19 pairs: the phone/guide card marks the sit-out", () => {
  const m = generateMitchellForPairs({ pairs: 19, boardsPerRound: 3 });
  const r = ewRoute(m, 10);
  assert.equal(r[0]!.round, 1);
  assert.equal(r[0]!.sitOut, true);
  assert.equal(r[0]!.nsPair, null);
  assert.equal(r[0]!.table, 10);
  assert.equal(r[1]!.sitOut, false); // round 2, table 1
  assert.equal(r.filter((s) => s.sitOut).length, 1);
  assert.equal(r.filter((s) => s.skipped).length, 1);
});

test("19 pairs: the sit-out slot still has its board set (put aside, not played)", () => {
  const m = generateMitchellForPairs({ pairs: 19, boardsPerRound: 3 });
  const s = slotAt(m, 2, 10)!;
  assert.equal(s.nsPair, null);
  assert.equal(s.ewPair, 9);
  assert.equal(s.boardSet, 1);
  assert.deepEqual(s.boards, [1, 2, 3]);
});

// ---- 9 pairs = 5 tables, full movement ----
test("9 pairs: 5 tables, 5 rounds, everybody sits out exactly once", () => {
  const m = generateMitchellForPairs({ pairs: 9, boardsPerRound: 2 });
  assert.equal(m.params.rounds, 5);
  assert.equal(m.params.skipAfterRound, null);
  const sum = pairSummary(m);
  assert.ok(sum.filter((p) => p.side === "NS").every((p) => p.roundsPlayed === 5));
  assert.ok(sum.filter((p) => p.side === "EW").every((p) => p.roundsPlayed === 4 && p.roundsSitOut === 1));
  assert.ok(boardSetPlays(m).every((b) => b.plays === 4));   // symmetric: every board played 4 times
});

// ---- EW phantom variant ----
test("EW phantom: a real NS pair sits idle at its own table, at most once", () => {
  const m = generateMitchellForPairs({ pairs: 19, boardsPerRound: 3, phantomSide: "EW" });
  assert.deepEqual(m.params.phantom, { side: "EW", pair: 10 });
  const so = sitOuts(m);
  assert.equal(so.length, 9);
  assert.ok(so.every((s) => s.side === "NS"));
  assert.equal(new Set(so.map((s) => s.pair)).size, 9);
  // sit-out slots appear in nsRoute with ewPair null
  const idle = nsRoute(m, so[0]!.pair).filter(isSitOut);
  assert.equal(idle.length, 1);
  assert.equal(idle[0]!.ewPair, null);
});

// ---- Sweeps ----
test("sweep 2..61 pairs, both phantom sides: always valid, correct sit-out count", () => {
  for (let p = 2; p <= 61; p++) {
    for (const side of ["NS", "EW"] as const) {
      const m = generateMitchellForPairs({ pairs: p, boardsPerRound: 2, phantomSide: side });
      assert.equal(validateMovement(m).ok, true, `pairs=${p} ${side}`);
      const expectedSits = p % 2 === 1 ? m.params.rounds - 0 : 0;
      // phantom meets every real opponent once, except when a skip removes one; one sit-out per round if odd
      assert.equal(sitOuts(m).length, expectedSits, `pairs=${p}`);
      assert.equal(pairSummary(m).length, p, `pairs=${p}`);
    }
  }
});

test("even pair counts behave exactly like generateMitchell", () => {
  const a = generateMitchellForPairs({ pairs: 20, boardsPerRound: 3 });
  const b = generateMitchell({ tables: 10, boardsPerRound: 3 });
  assert.deepEqual(a, b);
  assert.deepEqual(sitOuts(a), []);
});

test("phantom does not change the underlying table (real pairs seated identically)", () => {
  const std = generateMitchell({ tables: 10, boardsPerRound: 3 });
  const odd = generateMitchellForPairs({ pairs: 19, boardsPerRound: 3 });
  for (let i = 0; i < std.slots.length; i++) {
    const a = std.slots[i]!, b = odd.slots[i]!;
    assert.equal(a.boardSet, b.boardSet);
    assert.ok(b.nsPair === a.nsPair || b.nsPair === null);
  }
});

test("unmet opponents exclude the phantom", () => {
  const m = generateMitchellForPairs({ pairs: 19, boardsPerRound: 3 });
  for (let ns = 1; ns <= 9; ns++) assert.equal(unmetOpponents(m, ns).length, 1);
  const e = generateMitchellForPairs({ pairs: 19, boardsPerRound: 3, phantomSide: "EW" });
  for (let ew = 1; ew <= 9; ew++) assert.equal(unmetForEw(e, ew).length, 1);
  for (let ns = 1; ns <= 10; ns++) assert.ok(!unmetOpponents(e, ns).includes(10));
});

test("invalid inputs", () => {
  assert.throws(() => generateMitchellForPairs({ pairs: 1, boardsPerRound: 3 }));
  assert.throws(() => generateMitchellForPairs({ pairs: 2.5, boardsPerRound: 3 }));
  assert.throws(() => generateMitchell({ tables: 10, boardsPerRound: 3, phantom: { side: "NS", pair: 11 } }));
  assert.throws(() => generateMitchell({ tables: 10, boardsPerRound: 3, phantom: { side: "XX" as "NS", pair: 1 } }));
});

// ---- The validator must catch broken odd-pair movements ----
test("validator: a second phantom slot in a round", () => {
  const m = clone(generateMitchellForPairs({ pairs: 19, boardsPerRound: 3 }));
  m.slots.find((s) => s.round === 3 && s.table === 4)!.nsPair = null;
  const codes = validateMovement(m).violations.map((v) => v.code);
  assert.ok(codes.includes("PHANTOM_MISPLACED"));
  assert.ok(codes.includes("NS_NOT_ONCE_PER_ROUND"));
});

test("validator: a pair sitting out twice", () => {
  const m = clone(generateMitchellForPairs({ pairs: 19, boardsPerRound: 3 }));
  // Round 2: table 10 hosts EW 9. Make round 3's table-10 EW also 9.
  m.slots.find((s) => s.round === 3 && s.table === 10)!.ewPair = 9;
  const rep = validateMovement(m);
  assert.ok(rep.violations.some((v) => v.code === "NS_EW_REPEAT" && /sits out again/.test(v.message)));
});

test("validator: a real pair missing while a phantom is present", () => {
  const m = clone(generateMitchellForPairs({ pairs: 19, boardsPerRound: 3 }));
  m.slots.find((s) => s.round === 1 && s.table === 10)!.nsPair = 10; // phantom replaced by a real NS 10
  const codes = validateMovement(m).violations.map((v) => v.code);
  assert.ok(codes.includes("PHANTOM_MISPLACED") || codes.includes("NS_NOT_ONCE_PER_ROUND"));
});

test("validator: both seats null", () => {
  const m = clone(generateMitchellForPairs({ pairs: 19, boardsPerRound: 3 }));
  m.slots.find((s) => s.round === 1 && s.table === 10)!.ewPair = null;
  assert.ok(validateMovement(m).violations.some((v) => v.code === "PHANTOM_MISPLACED"));
});

test("unmet opponents for EW exclude the NS phantom", () => {
  const m = generateMitchellForPairs({ pairs: 19, boardsPerRound: 3 });
  const unmet = Array.from({ length: 10 }, (_, i) => unmetForEw(m, i + 1));
  assert.ok(unmet.every((u) => !u.includes(10)));
  assert.equal(unmet.filter((u) => u.length === 0).length, 1);  // the one EW that plays all 9 rounds
  assert.equal(unmet.filter((u) => u.length === 1).length, 9);
});
