import { test } from "node:test";
import assert from "node:assert/strict";
import {
  declarerScore, referenceDeclarerScore, parseContract, tricksFromRelative, scoreForNS,
  vulnerabilityForBoard, dealerForBoard, isVulnerable, DENOMINATIONS,
} from "../src/index.ts";
import type { Doubling, Seat, Vulnerability } from "../src/index.ts";
import { KNOWN } from "./known-scores.ts";

test(`known table has >= 100 hand-entered cases`, () => {
  assert.ok(KNOWN.length >= 100, `only ${KNOWN.length}`);
});

test("engine matches every hand-entered expected score", () => {
  for (const [text, vul, rel, expected] of KNOWN) {
    const c = parseContract(text);
    const tricks = tricksFromRelative(c.level, rel);
    const got = declarerScore(c.level, c.denomination, c.doubling, vul, tricks);
    assert.equal(got, expected, `${text} ${vul ? "vul" : "nv"} ${rel >= 0 ? "+" : ""}${rel}`);
  }
});

test("reference implementation matches every hand-entered expected score", () => {
  for (const [text, vul, rel, expected] of KNOWN) {
    const c = parseContract(text);
    const tricks = tricksFromRelative(c.level, rel);
    assert.equal(referenceDeclarerScore(c.level, c.denomination, c.doubling, vul, tricks), expected, text);
  }
});

test("engine == reference for EVERY possible (level, suit, doubling, vul, tricks)", () => {
  let n = 0;
  for (let level = 1; level <= 7; level++)
    for (const d of DENOMINATIONS)
      for (const dbl of ["", "X", "XX"] as Doubling[])
        for (const vul of [false, true])
          for (let tricks = 0; tricks <= 13; tricks++) {
            assert.equal(
              declarerScore(level, d, dbl, vul, tricks),
              referenceDeclarerScore(level, d, dbl, vul, tricks),
              `${level}${d}${dbl} vul=${vul} tricks=${tricks}`,
            );
            n++;
          }
  assert.equal(n, 7 * 5 * 3 * 2 * 14);
});

test("invalid inputs are rejected", () => {
  assert.throws(() => declarerScore(0, "S", "", false, 10));
  assert.throws(() => declarerScore(8, "S", "", false, 10));
  assert.throws(() => declarerScore(4, "S", "", false, 14));
  assert.throws(() => declarerScore(4, "S", "", false, -1));
  assert.throws(() => declarerScore(4, "S", "", false, 9.5));
  assert.throws(() => parseContract("8S"));
  assert.throws(() => parseContract("4SXXX"));
  assert.throws(() => tricksFromRelative(1, -8));
  assert.throws(() => tricksFromRelative(7, 1));
});

test("parseContract accepts common notations", () => {
  assert.deepEqual(parseContract("3n"), { level: 3, denomination: "NT", doubling: "" });
  assert.deepEqual(parseContract("3NT"), { level: 3, denomination: "NT", doubling: "" });
  assert.deepEqual(parseContract("4hx"), { level: 4, denomination: "H", doubling: "X" });
  assert.deepEqual(parseContract("1SXX"), { level: 1, denomination: "S", doubling: "XX" });
});

// --- Board metadata ---
test("vulnerability cycle: official 16-board table", () => {
  const expected: Vulnerability[] = [
    "NONE", "NS", "EW", "BOTH", "NS", "EW", "BOTH", "NONE",
    "EW", "BOTH", "NONE", "NS", "BOTH", "NONE", "NS", "EW",
  ];
  expected.forEach((v, i) => assert.equal(vulnerabilityForBoard(i + 1), v, `board ${i + 1}`));
});

test("vulnerability repeats every 16 boards; dealer every 4", () => {
  for (let b = 1; b <= 64; b++) {
    assert.equal(vulnerabilityForBoard(b + 16), vulnerabilityForBoard(b));
    assert.equal(dealerForBoard(b + 4), dealerForBoard(b));
  }
  assert.deepEqual([1, 2, 3, 4, 5].map(dealerForBoard), ["N", "E", "S", "W", "N"]);
});

test("each vulnerability appears exactly 4 times in 16 boards", () => {
  const counts: Record<string, number> = {};
  for (let b = 1; b <= 16; b++) counts[vulnerabilityForBoard(b)] = (counts[vulnerabilityForBoard(b)] ?? 0) + 1;
  assert.deepEqual(counts, { NONE: 4, NS: 4, EW: 4, BOTH: 4 });
});

test("isVulnerable by seat", () => {
  assert.equal(isVulnerable("NS", "N"), true);
  assert.equal(isVulnerable("NS", "W"), false);
  assert.equal(isVulnerable("EW", "E"), true);
  assert.equal(isVulnerable("BOTH", "S"), true);
  assert.equal(isVulnerable("NONE", "S"), false);
});

// --- NS orientation ---
test("scoreForNS: sign by declarer, vulnerability by declarer's side", () => {
  const nsMade = { kind: "played", contract: { ...parseContract("4S"), declarer: "N" as Seat }, tricks: 10 } as const;
  const ewMade = { kind: "played", contract: { ...parseContract("4S"), declarer: "E" as Seat }, tricks: 10 } as const;
  assert.equal(scoreForNS(nsMade, "NONE"), 420);
  assert.equal(scoreForNS(nsMade, "NS"), 620);
  assert.equal(scoreForNS(nsMade, "EW"), 420);      // only EW vul: NS declarer not vul
  assert.equal(scoreForNS(ewMade, "NONE"), -420);
  assert.equal(scoreForNS(ewMade, "EW"), -620);
  assert.equal(scoreForNS(ewMade, "NS"), -420);
  const ewDown = { kind: "played", contract: { ...parseContract("4S"), declarer: "W" as Seat }, tricks: 8 } as const;
  assert.equal(scoreForNS(ewDown, "NONE"), 100);    // EW down 2, NS score 100
  assert.equal(scoreForNS({ kind: "passout" }, "BOTH"), 0);
});
