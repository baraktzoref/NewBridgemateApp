export interface PairBoardMp {
  pairId: number;
  mp: number;
  top: number;
}

export interface PairTotal {
  pairId: number;
  mp: number;
  top: number;
  /** null if the pair has no comparable boards yet. */
  pct: number | null;
}

export interface Ranked extends PairTotal {
  /** Competition ranking: ties share a rank, next rank skips (1,1,3). null pct = unranked at the end. */
  rank: number;
}

/** Sum matchpoints per pair over boards. Boards with top=0 contribute nothing. */
export function aggregate(items: readonly PairBoardMp[]): PairTotal[] {
  const map = new Map<number, { mp: number; top: number }>();
  for (const it of items) {
    const cur = map.get(it.pairId) ?? { mp: 0, top: 0 };
    cur.mp += it.mp;
    cur.top += it.top;
    map.set(it.pairId, cur);
  }
  return [...map.entries()].map(([pairId, t]) => ({ pairId, mp: t.mp, top: t.top, pct: t.top > 0 ? (t.mp / t.top) * 100 : null }));
}

const EPS = 1e-9;

/** Rank pairs by percentage, highest first. Pass NS and EW separately for Mitchell. */
export function rank(totals: readonly PairTotal[]): Ranked[] {
  const sorted = [...totals].sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || a.pairId - b.pairId);
  const out: Ranked[] = [];
  sorted.forEach((t, i) => {
    const prev = out[i - 1];
    const tied = prev !== undefined && (t.pct === null ? prev.pct === null : prev.pct !== null && Math.abs(prev.pct - t.pct) < EPS);
    out.push({ ...t, rank: tied ? prev.rank : i + 1 });
  });
  return out;
}
