import { test } from "node:test";
import assert from "node:assert/strict";
import {
  declarerScore, referenceDeclarerScore, scoreForNS, matchpointBoard, referenceMatchpoints, DENOMINATIONS,
} from "../src/index.ts";
import type { Denomination, Doubling, Seat, TravellerEntry, Vulnerability } from "../src/index.ts";

// Seeded PRNG so any failure is reproducible.
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const DBL: Doubling[] = ["", "X", "XX"];
const SEATS: Seat[] = ["N", "E", "S", "W"];
const VULS: Vulnerability[] = ["NONE", "NS", "EW", "BOTH"];

function randomContract(r: () => number) {
  return {
    level: 1 + Math.floor(r() * 7),
    denomination: pick(r, DENOMINATIONS) as Denomination,
    doubling: pick(r, DBL),
    vul: r() < 0.5,
  };
}
const ITER = 3000;

test("P1: score is monotonic non-decreasing in tricks", () => {
  const r = rng(1);
  for (let i = 0; i < ITER; i++) {
    const c = randomContract(r);
    for (let t = 1; t <= 13; t++)
      assert.ok(declarerScore(c.level, c.denomination, c.doubling, c.vul, t) >= declarerScore(c.level, c.denomination, c.doubling, c.vul, t - 1));
  }
});

test("P2: made contracts score > 0, failed contracts score < 0", () => {
  const r = rng(2);
  for (let i = 0; i < ITER; i++) {
    const c = randomContract(r);
    const t = Math.floor(r() * 14);
    const s = declarerScore(c.level, c.denomination, c.doubling, c.vul, t);
    assert.equal(s > 0, t >= c.level + 6);
    assert.equal(s < 0, t < c.level + 6);
  }
});

test("P3: NS score for declarer E/W is the exact negation of the same deal with declarer N/S (same vul)", () => {
  const r = rng(3);
  for (let i = 0; i < ITER; i++) {
    const c = randomContract(r);
    const t = Math.floor(r() * 14);
    const nsDecl = pick(r, ["N", "S"] as Seat[]);
    const ewDecl = pick(r, ["E", "W"] as Seat[]);
    // "BOTH"/"NONE" give the same vulnerability to both sides
    const v: Vulnerability = c.vul ? "BOTH" : "NONE";
    const a = scoreForNS({ kind: "played", contract: { level: c.level, denomination: c.denomination, doubling: c.doubling, declarer: nsDecl }, tricks: t }, v);
    const b = scoreForNS({ kind: "played", contract: { level: c.level, denomination: c.denomination, doubling: c.doubling, declarer: ewDecl }, tricks: t }, v);
    assert.equal(a, -b);
  }
});

test("P4: declarer's partner/seat within a side never changes the score", () => {
  const r = rng(4);
  for (let i = 0; i < 500; i++) {
    const c = randomContract(r);
    const v = pick(r, VULS);
    const t = Math.floor(r() * 14);
    const mk = (declarer: Seat) => scoreForNS({ kind: "played", contract: { level: c.level, denomination: c.denomination, doubling: c.doubling, declarer }, tricks: t }, v);
    assert.equal(mk("N"), mk("S"));
    assert.equal(mk("E"), mk("W"));
  }
});

test("P5: vulnerability never helps a failing declarer and never hurts a making declarer", () => {
  const r = rng(5);
  for (let i = 0; i < ITER; i++) {
    const c = randomContract(r);
    const t = Math.floor(r() * 14);
    const nv = declarerScore(c.level, c.denomination, c.doubling, false, t);
    const v = declarerScore(c.level, c.denomination, c.doubling, true, t);
    assert.ok(t >= c.level + 6 ? v >= nv : v <= nv);
  }
});

test("P6: doubling raises a made score and deepens a failed one", () => {
  const r = rng(6);
  for (let i = 0; i < ITER; i++) {
    const c = randomContract(r);
    const t = Math.floor(r() * 14);
    const s0 = declarerScore(c.level, c.denomination, "", c.vul, t);
    const s1 = declarerScore(c.level, c.denomination, "X", c.vul, t);
    const s2 = declarerScore(c.level, c.denomination, "XX", c.vul, t);
    if (t >= c.level + 6) assert.ok(s0 < s1 && s1 < s2);
    else assert.ok(s0 > s1 && s1 > s2);
  }
});

test("P7: each overtrick adds a constant, per contract type", () => {
  const r = rng(7);
  for (let i = 0; i < ITER; i++) {
    const c = randomContract(r);
    const need = c.level + 6;
    if (need >= 13) continue;
    const diffs = new Set<number>();
    for (let t = need; t < 13; t++)
      diffs.add(declarerScore(c.level, c.denomination, c.doubling, c.vul, t + 1) - declarerScore(c.level, c.denomination, c.doubling, c.vul, t));
    assert.equal(diffs.size, 1);
  }
});

test("P8: game-level made contracts (>= 100 trick points) earn at least the game bonus", () => {
  // 3NT, 4M, 5m and slams always ≥ 400 nonvul / 600 vul when made undoubled.
  for (const [lvl, d] of [[3, "NT"], [4, "H"], [4, "S"], [5, "C"], [5, "D"], [6, "S"], [7, "NT"]] as const) {
    assert.ok(declarerScore(lvl, d, "", false, lvl + 6) >= 400);
    assert.ok(declarerScore(lvl, d, "", true, lvl + 6) >= 600);
  }
  // Part-scores stay below 200 undoubled.
  for (const [lvl, d] of [[1, "NT"], [2, "H"], [3, "C"], [4, "D"]] as const)
    assert.ok(declarerScore(lvl, d, "", false, lvl + 6) < 200);
});

test("P9: undertrick penalties grow strictly with each extra trick down", () => {
  const r = rng(9);
  for (let i = 0; i < 1000; i++) {
    const c = randomContract(r);
    for (let t = 1; t < c.level + 6; t++)
      assert.ok(declarerScore(c.level, c.denomination, c.doubling, c.vul, t - 1) < declarerScore(c.level, c.denomination, c.doubling, c.vul, t));
  }
});

test("P10: random full-API results always equal the independent reference", () => {
  const r = rng(10);
  for (let i = 0; i < 10000; i++) {
    const c = randomContract(r);
    const t = Math.floor(r() * 14);
    assert.equal(
      declarerScore(c.level, c.denomination, c.doubling, c.vul, t),
      referenceDeclarerScore(c.level, c.denomination, c.doubling, c.vul, t),
    );
  }
});

// ---- Matchpoint invariants ----
function randomTraveller(r: () => number): TravellerEntry[] {
  const n = 2 + Math.floor(r() * 11);
  const pool = [-800, -500, -100, 50, 90, 110, 140, 170, 420, 450, 620, 650, 980];
  return Array.from({ length: n }, (_, i) => ({ id: String(i), nsScore: pick(r, pool) }));
}

test("M1: NS + EW MP = top on every line; total NS MP = n(n-1)", () => {
  const r = rng(11);
  for (let i = 0; i < 1000; i++) {
    const t = randomTraveller(r);
    const lines = matchpointBoard(t);
    const n = t.length;
    for (const l of lines) assert.equal(l.nsMp + l.ewMp, 2 * (n - 1));
    assert.equal(lines.reduce((s, l) => s + l.nsMp, 0), n * (n - 1));
    assert.equal(lines.reduce((s, l) => s + l.ewMp, 0), n * (n - 1));
  }
});

test("M2: result independent of the order of the traveller", () => {
  const r = rng(12);
  for (let i = 0; i < 500; i++) {
    const t = randomTraveller(r);
    const shuffled = [...t].sort(() => r() - 0.5);
    const a = new Map(matchpointBoard(t).map((l) => [l.id, l.nsMp]));
    for (const l of matchpointBoard(shuffled)) assert.equal(l.nsMp, a.get(l.id));
  }
});

test("M3: higher NS score never gets fewer NS matchpoints; equal scores get equal MP", () => {
  const r = rng(13);
  for (let i = 0; i < 500; i++) {
    const t = randomTraveller(r);
    const lines = matchpointBoard(t);
    for (let a = 0; a < t.length; a++)
      for (let b = 0; b < t.length; b++) {
        const sa = (t[a] as { nsScore: number }).nsScore, sb = (t[b] as { nsScore: number }).nsScore;
        if (sa > sb) assert.ok(lines[a]!.nsMp > lines[b]!.nsMp);
        if (sa === sb) assert.equal(lines[a]!.nsMp, lines[b]!.nsMp);
      }
  }
});

test("M4: percentages within [0,100] and NS% + EW% = 100", () => {
  const r = rng(14);
  for (let i = 0; i < 500; i++)
    for (const l of matchpointBoard(randomTraveller(r))) {
      assert.ok(l.nsPct! >= 0 && l.nsPct! <= 100);
      assert.ok(Math.abs(l.nsPct! + l.ewPct! - 100) < 1e-9);
    }
});

test("M5: adding a new result never changes the relative order of the others", () => {
  const r = rng(15);
  for (let i = 0; i < 300; i++) {
    const t = randomTraveller(r);
    const extra: TravellerEntry = { id: "extra", nsScore: pick(r, [-500, 100, 420, 620]) };
    const before = matchpointBoard(t).map((l) => l.nsMp);
    const after = matchpointBoard([...t, extra]).slice(0, t.length).map((l) => l.nsMp);
    for (let a = 0; a < t.length; a++)
      for (let b = 0; b < t.length; b++) {
        if (before[a]! > before[b]!) assert.ok(after[a]! > after[b]!);
        if (before[a]! === before[b]!) assert.equal(after[a], after[b]);
      }
  }
});

test("M6: independent reference matches on random travellers", () => {
  const r = rng(16);
  for (let i = 0; i < 1000; i++) {
    const t = randomTraveller(r);
    assert.deepEqual(matchpointBoard(t).map((l) => l.nsMp), referenceMatchpoints(t.map((e) => (e as { nsScore: number }).nsScore)));
  }
});
