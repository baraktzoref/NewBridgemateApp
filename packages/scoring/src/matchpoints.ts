import type { MatchpointLine, TravellerEntry } from "./types.ts";

/**
 * Matchpoints for one board (2 for each result beaten, 1 for each tie).
 * Adjusted entries are excluded from the comparison; they receive their fixed
 * percentage of the board's top, where top = 2 * (played results - 1).
 */
export function matchpointBoard(entries: readonly TravellerEntry[]): MatchpointLine[] {
  const playedScores = entries.flatMap((e) => ("nsScore" in e ? [e.nsScore] : []));
  const top = 2 * Math.max(playedScores.length - 1, 0);

  return entries.map((e, idx): MatchpointLine => {
    if ("adjusted" in e) {
      const nsMp = (e.adjusted.ns / 100) * top;
      const ewMp = (e.adjusted.ew / 100) * top;
      return { id: e.id, nsMp, ewMp, top, nsPct: e.adjusted.ns, ewPct: e.adjusted.ew };
    }
    // Compare against every other played result (skip this entry itself, by position).
    let nsMp = 0;
    for (let j = 0; j < entries.length; j++) {
      const o = entries[j]!;
      if (j === idx || !("nsScore" in o)) continue;
      nsMp += e.nsScore > o.nsScore ? 2 : e.nsScore === o.nsScore ? 1 : 0;
    }
    const ewMp = top - nsMp;
    return {
      id: e.id, nsMp, ewMp, top,
      nsPct: top > 0 ? (nsMp / top) * 100 : null,
      ewPct: top > 0 ? (ewMp / top) * 100 : null,
    };
  });
}
