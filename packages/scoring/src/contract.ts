import type { Denomination, Doubling } from "./types.ts";

/** Standard duplicate scoring (WBF / ACBL laws, current tables). */

export const DENOMINATIONS: readonly Denomination[] = ["C", "D", "H", "S", "NT"];

function validate(level: number, tricks: number): void {
  if (!Number.isInteger(level) || level < 1 || level > 7) throw new RangeError(`level must be 1..7, got ${level}`);
  if (!Number.isInteger(tricks) || tricks < 0 || tricks > 13) throw new RangeError(`tricks must be 0..13, got ${tricks}`);
}

function undertrickPenalty(down: number, doubling: Doubling, vulnerable: boolean): number {
  if (doubling === "") return (vulnerable ? 100 : 50) * down;
  const doubled = vulnerable
    ? 200 + 300 * (down - 1)
    : down === 1 ? 100 : down <= 3 ? 100 + 200 * (down - 1) : 500 + 300 * (down - 3);
  return doubling === "X" ? doubled : doubled * 2;
}

/**
 * Score from the DECLARER side's point of view.
 * Positive = declarer side scores, negative = defenders score.
 * @param tricks total tricks taken by the declaring side (0..13)
 */
export function declarerScore(
  level: number,
  denomination: Denomination,
  doubling: Doubling,
  vulnerable: boolean,
  tricks: number,
): number {
  validate(level, tricks);
  const needed = level + 6;
  if (tricks < needed) return -undertrickPenalty(needed - tricks, doubling, vulnerable);

  const mult = doubling === "XX" ? 4 : doubling === "X" ? 2 : 1;
  const perTrick = denomination === "C" || denomination === "D" ? 20 : 30;
  const base = denomination === "NT" ? 40 + 30 * (level - 1) : perTrick * level;
  const trickScore = base * mult;

  let score = trickScore;
  score += trickScore >= 100 ? (vulnerable ? 500 : 300) : 50; // game / part-score bonus
  if (level === 6) score += vulnerable ? 750 : 500;
  if (level === 7) score += vulnerable ? 1500 : 1000;
  score += doubling === "X" ? 50 : doubling === "XX" ? 100 : 0; // insult

  const overtricks = tricks - needed;
  const overValue =
    doubling === "" ? perTrick : (doubling === "X" ? 100 : 200) * (vulnerable ? 2 : 1);
  return score + overtricks * overValue;
}
