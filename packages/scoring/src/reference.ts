/**
 * INDEPENDENT reference implementation, deliberately written table-first with no
 * shared code or formulas with contract.ts / matchpoints.ts. Used only to cross-check.
 */
import type { Denomination, Doubling } from "./types.ts";

// Undoubled trick values for level 1..7 (index = level-1).
const TRICKS: Record<Denomination, number[]> = {
  C: [20, 40, 60, 80, 100, 120, 140],
  D: [20, 40, 60, 80, 100, 120, 140],
  H: [30, 60, 90, 120, 150, 180, 210],
  S: [30, 60, 90, 120, 150, 180, 210],
  NT: [40, 70, 100, 130, 160, 190, 220],
};
const OVER_UNDOUBLED: Record<Denomination, number> = { C: 20, D: 20, H: 30, S: 30, NT: 30 };
const MULT: Record<Doubling, number> = { "": 1, X: 2, XX: 4 };
const INSULT: Record<Doubling, number> = { "": 0, X: 50, XX: 100 };
// [nonvul, vul]
const GAME: [number, number] = [300, 500];
const SLAM: Record<number, [number, number]> = { 6: [500, 750], 7: [1000, 1500] };
const OVER_DOUBLED: Record<"X" | "XX", [number, number]> = { X: [100, 200], XX: [200, 400] };

// Undertrick penalties, entry i = i+1 down.
const DOWN: Record<Doubling, [number[], number[]]> = {
  "": [
    [50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650],
    [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300],
  ],
  X: [
    [100, 300, 500, 800, 1100, 1400, 1700, 2000, 2300, 2600, 2900, 3200, 3500],
    [200, 500, 800, 1100, 1400, 1700, 2000, 2300, 2600, 2900, 3200, 3500, 3800],
  ],
  XX: [
    [200, 600, 1000, 1600, 2200, 2800, 3400, 4000, 4600, 5200, 5800, 6400, 7000],
    [400, 1000, 1600, 2200, 2800, 3400, 4000, 4600, 5200, 5800, 6400, 7000, 7600],
  ],
};

export function referenceDeclarerScore(
  level: number, denom: Denomination, dbl: Doubling, vul: boolean, tricks: number,
): number {
  const v = vul ? 1 : 0;
  const shortfall = level + 6 - tricks;
  if (shortfall > 0) return -DOWN[dbl][v]![shortfall - 1]!;

  const trick = TRICKS[denom][level - 1]! * MULT[dbl];
  const over = tricks - (level + 6);
  const perOver = dbl === "" ? OVER_UNDOUBLED[denom] : OVER_DOUBLED[dbl][v]!;
  const slam = SLAM[level]?.[v] ?? 0;
  const bonus = trick >= 100 ? GAME[v]! : 50;
  return trick + bonus + slam + INSULT[dbl] + over * perOver;
}

/** NS matchpoints for each score, computed by sorting instead of pairwise comparison. */
export function referenceMatchpoints(scores: readonly number[]): number[] {
  const sorted = [...scores].sort((a, b) => a - b);
  return scores.map((s) => {
    const below = sorted.filter((x) => x < s).length;
    const equalIncludingSelf = sorted.filter((x) => x === s).length;
    return 2 * below + (equalIncludingSelf - 1);
  });
}
