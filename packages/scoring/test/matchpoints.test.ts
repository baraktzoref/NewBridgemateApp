import { test } from "node:test";
import assert from "node:assert/strict";
import { matchpointBoard, referenceMatchpoints, aggregate, rank } from "../src/index.ts";
import type { TravellerEntry } from "../src/index.ts";

const trav = (scores: number[]): TravellerEntry[] => scores.map((nsScore, i) => ({ id: String(i), nsScore }));

test("hand-computed 5-result traveller", () => {
  // scores NS: 620, 620, 170, -50, 100 ; top = 8
  const r = matchpointBoard(trav([620, 620, 170, -50, 100]));
  assert.deepEqual(r.map((x) => x.nsMp), [7, 7, 4, 0, 2]);
  // 620 vs others: beats 170,-50,100 (6) + tie 620 (1) = 7 ; 170 beats -50,100 = 4 ; 100 beats -50 = 2
  assert.deepEqual(r.map((x) => x.ewMp), [1, 1, 4, 8, 6]);
  assert.ok(r.every((x) => x.top === 8));
  assert.equal(r[0]!.nsPct, 87.5);
});

test("all equal scores => 50% each", () => {
  const r = matchpointBoard(trav([420, 420, 420, 420]));
  assert.ok(r.every((x) => x.nsMp === 3 && x.ewMp === 3 && x.nsPct === 50));
});

test("two results: top 2, winner gets 2", () => {
  const r = matchpointBoard(trav([100, -100]));
  assert.deepEqual(r.map((x) => x.nsMp), [2, 0]);
});

test("single result: top 0, no percentage", () => {
  const [r] = matchpointBoard(trav([420]));
  assert.equal(r!.top, 0);
  assert.equal(r!.nsPct, null);
});

test("adjusted score: excluded from comparison, gets fixed % of top", () => {
  const entries: TravellerEntry[] = [
    { id: "a", nsScore: 420 }, { id: "b", nsScore: 450 }, { id: "c", nsScore: 400 },
    { id: "adj", adjusted: { ns: 60, ew: 40 } },
  ];
  const r = matchpointBoard(entries);
  assert.equal(r[0]!.top, 4);            // 3 played results
  assert.deepEqual([r[0]!.nsMp, r[1]!.nsMp, r[2]!.nsMp], [2, 4, 0]);
  assert.equal(r[3]!.nsMp, 2.4);
  assert.equal(r[3]!.ewMp, 1.6);
});

test("matchpointBoard == referenceMatchpoints on random travellers", () => {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let iter = 0; iter < 500; iter++) {
    const n = 2 + Math.floor(rnd() * 12);
    const scores = Array.from({ length: n }, () => [-500, -100, 50, 110, 140, 420, 450, 620, 980][Math.floor(rnd() * 9)]!);
    assert.deepEqual(matchpointBoard(trav(scores)).map((x) => x.nsMp), referenceMatchpoints(scores));
  }
});

test("aggregate + rank: percentages and ties", () => {
  const totals = aggregate([
    { pairId: 1, mp: 30, top: 48 }, { pairId: 1, mp: 10, top: 16 },
    { pairId: 2, mp: 40, top: 64 },            // 62.5%, same as pair 1 (40/64)
    { pairId: 3, mp: 20, top: 64 },
    { pairId: 4, mp: 0, top: 0 },              // no comparable boards
  ]);
  const ranked = rank(totals);
  assert.deepEqual(ranked.map((r) => [r.pairId, r.rank]), [[1, 1], [2, 1], [3, 3], [4, 4]]);
  assert.equal(ranked[0]!.pct, 62.5);
  assert.equal(ranked[3]!.pct, null);
});
