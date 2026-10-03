import type { EwRouteStep, Movement, PairSummary, SitOut, Slot } from "./types.ts";

export const isSitOut = (s: Slot): boolean => s.nsPair === null || s.ewPair === null;

export function slotAt(m: Movement, round: number, table: number): Slot | undefined {
  return m.slots.find((s) => s.round === round && s.table === table);
}

/** Full itinerary of an EW pair (for the "next round" screen and printed guide cards). */
export function ewRoute(m: Movement, ewPair: number): EwRouteStep[] {
  const n = m.params.tables;
  const mine = m.slots.filter((s) => s.ewPair === ewPair).sort((a, b) => a.round - b.round);
  return mine.map((s, i) => {
    const prev = mine[i - 1];
    // Normal move is to the next table (wrapping 10 -> 1). Anything else = skip.
    const normal = prev ? (prev.table % n) + 1 : s.table;
    return {
      round: s.round,
      table: s.table,
      nsPair: s.nsPair,
      boardSet: s.boardSet,
      boards: s.boards,
      skipped: prev !== undefined && s.table !== normal,
      sitOut: s.nsPair === null,
    };
  });
}

/** Itinerary of an NS pair (fixed table; opponents and boards change). Sit-out slots have ewPair null. */
export function nsRoute(m: Movement, nsPair: number): Slot[] {
  return m.slots.filter((s) => s.nsPair === nsPair).sort((a, b) => a.round - b.round);
}

/** Real EW pairs a given NS pair never meets (expected when rounds < tables). */
export function unmetOpponents(m: Movement, nsPair: number): number[] {
  const met = new Set(nsRoute(m, nsPair).map((s) => s.ewPair));
  const ph = m.params.phantom;
  const out: number[] = [];
  for (let e = 1; e <= m.params.tables; e++) {
    if (ph?.side === "EW" && ph.pair === e) continue;
    if (!met.has(e)) out.push(e);
  }
  return out;
}

/** Real NS pairs a given EW pair never meets. */
export function unmetForEw(m: Movement, ewPair: number): number[] {
  const met = new Set(m.slots.filter((s) => s.ewPair === ewPair).map((s) => s.nsPair));
  const ph = m.params.phantom;
  const out: number[] = [];
  for (let n = 1; n <= m.params.tables; n++) {
    if (ph?.side === "NS" && ph.pair === n) continue;
    if (!met.has(n)) out.push(n);
  }
  return out;
}

/** Every sit-out in the movement, ordered by round. */
export function sitOuts(m: Movement): SitOut[] {
  const out: SitOut[] = [];
  for (const s of m.slots) {
    if (s.nsPair === null && s.ewPair !== null) out.push({ round: s.round, table: s.table, side: "EW", pair: s.ewPair });
    else if (s.ewPair === null && s.nsPair !== null) out.push({ round: s.round, table: s.table, side: "NS", pair: s.nsPair });
  }
  return out;
}

/** Rounds and boards each real pair actually plays. Unequal counts are normal with a phantom. */
export function pairSummary(m: Movement): PairSummary[] {
  const ph = m.params.phantom;
  const res: PairSummary[] = [];
  for (const side of ["NS", "EW"] as const) {
    for (let p = 1; p <= m.params.tables; p++) {
      if (ph?.side === side && ph.pair === p) continue;
      const mine = m.slots.filter((s) => (side === "NS" ? s.nsPair : s.ewPair) === p);
      const sit = mine.filter(isSitOut).length;
      res.push({ side, pair: p, roundsPlayed: mine.length - sit, roundsSitOut: sit, boardsPlayed: (mine.length - sit) * m.params.boardsPerRound });
    }
  }
  return res;
}

/** How many times each board set is actually played (its matchpoint top is 2*(plays-1)). */
export function boardSetPlays(m: Movement): { boardSet: number; plays: number }[] {
  const plays = new Map<number, number>();
  for (let k = 1; k <= m.params.tables; k++) plays.set(k, 0);
  for (const s of m.slots) if (!isSitOut(s)) plays.set(s.boardSet, plays.get(s.boardSet)! + 1);
  return [...plays.entries()].map(([boardSet, p]) => ({ boardSet, plays: p }));
}
