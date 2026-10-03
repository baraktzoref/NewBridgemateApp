import type { Movement, Slot, ValidationReport, Violation } from "./types.ts";
import { boardsOfSet } from "./mitchell.ts";

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

/** True if `actual` contains exactly the numbers in `expected`, each once. */
function sameSet(actual: number[], expected: number[]): boolean {
  if (actual.length !== expected.length) return false;
  const a = new Set(actual);
  return a.size === actual.length && expected.every((x) => a.has(x));
}

/**
 * Structural validation of any movement (Mitchell now, Howell later).
 * Pure function: reports every violation instead of stopping at the first.
 */
export function validateMovement(m: Movement): ValidationReport {
  const { tables, rounds, boardsPerRound, phantom } = m.params;
  const v: Violation[] = [];

  const perRound = new Map<number, Slot[]>();
  for (const s of m.slots) {
    const list = perRound.get(s.round) ?? [];
    list.push(s);
    perRound.set(s.round, list);
  }

  const expNs = range(tables).filter((p) => !(phantom?.side === "NS" && phantom.pair === p));
  const expEw = range(tables).filter((p) => !(phantom?.side === "EW" && phantom.pair === p));
  const expNsNulls = phantom?.side === "NS" ? 1 : 0;
  const expEwNulls = phantom?.side === "EW" ? 1 : 0;

  for (let r = 1; r <= rounds; r++) {
    const slots = perRound.get(r) ?? [];
    for (let t = 1; t <= tables; t++) {
      const c = slots.filter((s) => s.table === t).length;
      if (c !== 1) v.push({ code: "TABLE_COVERAGE", round: r, table: t, message: `Round ${r}, table ${t} has ${c} slots (expected 1)` });
    }
    const ns = slots.flatMap((s) => (s.nsPair === null ? [] : [s.nsPair]));
    const ew = slots.flatMap((s) => (s.ewPair === null ? [] : [s.ewPair]));
    if (!sameSet(ns, expNs)) v.push({ code: "NS_NOT_ONCE_PER_ROUND", round: r, message: `Round ${r}: NS pairs are not each seated exactly once` });
    if (!sameSet(ew, expEw)) v.push({ code: "EW_NOT_ONCE_PER_ROUND", round: r, message: `Round ${r}: EW pairs are not each seated exactly once` });
    const nsNulls = slots.filter((s) => s.nsPair === null).length;
    const ewNulls = slots.filter((s) => s.ewPair === null).length;
    if (nsNulls !== expNsNulls || ewNulls !== expEwNulls || slots.some((s) => s.nsPair === null && s.ewPair === null))
      v.push({ code: "PHANTOM_MISPLACED", round: r, message: `Round ${r}: expected ${expNsNulls} NS and ${expEwNulls} EW phantom slots, found ${nsNulls}/${ewNulls}` });
    if (!sameSet(slots.map((s) => s.boardSet), range(tables)))
      v.push({ code: "BOARDSET_NOT_ONCE_PER_ROUND", round: r, message: `Round ${r}: board sets are not each used exactly once` });
  }

  const meetings = new Set<string>();
  const ewBs = new Set<string>();
  const nsBs = new Set<string>();
  for (const s of m.slots) {
    // Phantom counts as an opponent here: meeting it twice = sitting out twice.
    const k1 = `${s.nsPair ?? "P"}-${s.ewPair ?? "P"}`;
    if (meetings.has(k1)) {
      const what = s.nsPair === null || s.ewPair === null ? "sits out again" : "meets again";
      v.push({ code: "NS_EW_REPEAT", round: s.round, table: s.table, message: `NS ${s.nsPair ?? "phantom"} / EW ${s.ewPair ?? "phantom"} ${what} (round ${s.round})` });
    }
    meetings.add(k1);

    if (s.nsPair !== null && s.ewPair !== null) {
      const k2 = `${s.ewPair}-${s.boardSet}`;
      if (ewBs.has(k2)) v.push({ code: "EW_BOARDSET_REPEAT", round: s.round, table: s.table, message: `EW ${s.ewPair} plays board set ${s.boardSet} again (round ${s.round})` });
      ewBs.add(k2);
      const k3 = `${s.nsPair}-${s.boardSet}`;
      if (nsBs.has(k3)) v.push({ code: "NS_BOARDSET_REPEAT", round: s.round, table: s.table, message: `NS ${s.nsPair} plays board set ${s.boardSet} again (round ${s.round})` });
      nsBs.add(k3);
    }

    const expected = boardsOfSet(s.boardSet, boardsPerRound);
    if (s.boards.length !== expected.length || s.boards.some((b, i) => b !== expected[i]))
      v.push({ code: "BOARDS_MISMATCH", round: s.round, table: s.table, message: `Round ${s.round}, table ${s.table}: boards ${s.boards} != set ${s.boardSet}` });
  }

  return { ok: v.length === 0, violations: v };
}
