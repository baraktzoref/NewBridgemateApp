import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateMitchell, findValidSkips, validateMovement, slotAt, ewRoute, nsRoute, unmetOpponents,
} from "../src/index.ts";
import type { Movement } from "../src/index.ts";

// --- Golden: the 10-table movement agreed in the design (skip after round 5) ---
test("10 tables: defaults to 9 rounds, skip after round 5", () => {
  const m = generateMitchell({ tables: 10, boardsPerRound: 3 });
  assert.equal(m.params.rounds, 9);
  assert.equal(m.params.skipAfterRound, 5);
  assert.equal(m.slots.length, 90);
});

test("10 tables: spot-check golden cells (EW/boardSet)", () => {
  const m = generateMitchell({ tables: 10, boardsPerRound: 3 });
  const cell = (r: number, t: number) => { const s = slotAt(m, r, t)!; return `${s.ewPair}/${s.boardSet}`; };
  assert.equal(cell(1, 1), "1/1");
  assert.equal(cell(2, 1), "10/2");
  assert.equal(cell(5, 1), "7/5");
  assert.equal(cell(6, 1), "5/6");   // skip round
  assert.equal(cell(6, 6), "10/1");
  assert.equal(cell(9, 10), "1/8");
});

test("10 tables: 30 boards, 3 per set", () => {
  const m = generateMitchell({ tables: 10, boardsPerRound: 3 });
  assert.deepEqual(slotAt(m, 1, 2)!.boards, [4, 5, 6]);
  const all = new Set(m.slots.flatMap((s) => s.boards));
  assert.equal(all.size, 30);
});

test("10 tables, 9 rounds: only skips after round 4 or 5 are valid", () => {
  assert.deepEqual(findValidSkips(10, 9), [4, 5]);
});

test("10 tables: a full 10-round Mitchell is impossible", () => {
  assert.throws(() => generateMitchell({ tables: 10, boardsPerRound: 3, rounds: 10 }));
  for (let s = 0; s < 10; s++)
    assert.throws(() => generateMitchell({ tables: 10, boardsPerRound: 3, rounds: 10, skipAfterRound: s }));
});

test("explicit invalid skip is rejected, explicit valid skip accepted", () => {
  assert.throws(() => generateMitchell({ tables: 10, boardsPerRound: 3, skipAfterRound: 2 }));
  assert.equal(generateMitchell({ tables: 10, boardsPerRound: 3, skipAfterRound: 4 }).params.skipAfterRound, 4);
});

// --- Sweep: every table count yields a valid movement by default ---
test("sweep 1..24 tables: default movement is valid", () => {
  for (let n = 1; n <= 24; n++) {
    const m = generateMitchell({ tables: n, boardsPerRound: 2 });
    assert.equal(validateMovement(m).ok, true, `tables=${n}`);
  }
});

test("odd tables: full movement, no skip, every NS meets every EW", () => {
  for (const n of [3, 5, 7, 9, 11, 13]) {
    const m = generateMitchell({ tables: n, boardsPerRound: 2 });
    assert.equal(m.params.rounds, n);
    assert.equal(m.params.skipAfterRound, null);
    for (let ns = 1; ns <= n; ns++) assert.deepEqual(unmetOpponents(m, ns), []);
  }
});

test("even tables: short movement (<= n/2 rounds) needs no skip", () => {
  const m = generateMitchell({ tables: 10, boardsPerRound: 3, rounds: 5 });
  assert.equal(m.params.skipAfterRound, null);
});

test("even tables, n-1 rounds: each NS misses exactly one EW", () => {
  const m = generateMitchell({ tables: 10, boardsPerRound: 3 });
  for (let ns = 1; ns <= 10; ns++) {
    const miss = unmetOpponents(m, ns);
    assert.deepEqual(miss, [((ns + 4) % 10) + 1]); // NS i misses EW i+5
  }
});

// --- Routes for the phone / guide cards ---
test("EW route: exactly one skipped step, in round 6", () => {
  const m = generateMitchell({ tables: 10, boardsPerRound: 3 });
  for (let e = 1; e <= 10; e++) {
    const skipped = ewRoute(m, e).filter((s) => s.skipped).map((s) => s.round);
    assert.deepEqual(skipped, [6], `EW ${e}`);
  }
});

test("EW route: pair 10 goes to table 1 in round 2 (wrap-around, not a skip)", () => {
  const m = generateMitchell({ tables: 10, boardsPerRound: 3 });
  const r = ewRoute(m, 10);
  assert.equal(r[0]!.table, 10);
  assert.equal(r[1]!.table, 1);
  assert.equal(r[1]!.skipped, false);
});

test("NS route: fixed table, 9 different opponents", () => {
  const m = generateMitchell({ tables: 10, boardsPerRound: 3 });
  const r = nsRoute(m, 4);
  assert.ok(r.every((s) => s.table === 4));
  assert.equal(new Set(r.map((s) => s.ewPair)).size, 9);
});

// --- The validator must catch corruption (tests the tests) ---
const clone = (m: Movement): Movement => structuredClone(m);

test("validator flags duplicated EW pair in a round", () => {
  const m = clone(generateMitchell({ tables: 10, boardsPerRound: 3 }));
  m.slots.find((s) => s.round === 1 && s.table === 2)!.ewPair = 1;
  const rep = validateMovement(m);
  assert.equal(rep.ok, false);
  assert.ok(rep.violations.some((v) => v.code === "EW_NOT_ONCE_PER_ROUND"));
});

test("validator flags repeated NS-EW meeting", () => {
  const m = clone(generateMitchell({ tables: 10, boardsPerRound: 3 }));
  const a = m.slots.find((s) => s.round === 1 && s.table === 1)!;
  m.slots.find((s) => s.round === 2 && s.table === 1)!.ewPair = a.ewPair;
  assert.ok(validateMovement(m).violations.some((v) => v.code === "NS_EW_REPEAT"));
});

test("validator flags repeated board set and wrong board numbers", () => {
  const m = clone(generateMitchell({ tables: 10, boardsPerRound: 3 }));
  m.slots.find((s) => s.round === 2 && s.table === 1)!.boardSet = 1;
  const codes = validateMovement(m).violations.map((v) => v.code);
  assert.ok(codes.includes("EW_BOARDSET_REPEAT") || codes.includes("NS_BOARDSET_REPEAT"));
  assert.ok(codes.includes("BOARDS_MISMATCH"));
});

test("validator flags a missing slot", () => {
  const m = clone(generateMitchell({ tables: 10, boardsPerRound: 3 }));
  m.slots = m.slots.filter((s) => !(s.round === 3 && s.table === 7));
  assert.ok(validateMovement(m).violations.some((v) => v.code === "TABLE_COVERAGE"));
});

test("invalid inputs are rejected", () => {
  assert.throws(() => generateMitchell({ tables: 0, boardsPerRound: 3 }));
  assert.throws(() => generateMitchell({ tables: 10, boardsPerRound: 0 }));
  assert.throws(() => generateMitchell({ tables: 10, boardsPerRound: 3, rounds: 11 }));
});
