import type { HowellMovement, HowellStep } from "./types.ts";

/** Itinerary of any pair, for the "next round" screen and guide cards. */
export function howellRoute(m: HowellMovement, pair: number): HowellStep[] {
  const out: HowellStep[] = [];
  for (const s of m.slots) {
    if (s.nsPair === pair) out.push({ round: s.round, table: s.table, side: "NS", opponent: s.ewPair, boardSet: s.boardSet, boards: s.boards, sitOut: s.ewPair === null });
    else if (s.ewPair === pair) out.push({ round: s.round, table: s.table, side: "EW", opponent: s.nsPair, boardSet: s.boardSet, boards: s.boards, sitOut: s.nsPair === null });
  }
  return out.sort((a, b) => a.round - b.round);
}

/** How many times each pair sat NS / EW (a fair movement keeps these close). */
export function howellSeatBalance(m: HowellMovement): { pair: number; ns: number; ew: number }[] {
  const res = Array.from({ length: m.params.pairs }, (_, i) => ({ pair: i + 1, ns: 0, ew: 0 }));
  for (const s of m.slots) {
    if (s.nsPair === null || s.ewPair === null) continue;
    res[s.nsPair - 1]!.ns++;
    res[s.ewPair - 1]!.ew++;
  }
  return res;
}

/** Number of table changes per pair (walking distance proxy). */
export function howellTableChanges(m: HowellMovement): { pair: number; changes: number }[] {
  return Array.from({ length: m.params.pairs }, (_, i) => {
    const r = howellRoute(m, i + 1);
    return { pair: i + 1, changes: r.filter((s, j) => j > 0 && s.table !== r[j - 1]!.table).length };
  });
}
