import type { HowellMovement, HowellReport, HowellViolation, HowellSlot } from "./types.ts";
import { boardsOfSet } from "./mitchell.ts";

/** Structural validation of a Howell movement. Reports every violation. */
export function validateHowell(m: HowellMovement): HowellReport {
  const { pairs, tables, rounds, boardsPerRound, boardSets } = m.params;
  const v: HowellViolation[] = [];

  const perRound = new Map<number, HowellSlot[]>();
  for (const s of m.slots) perRound.set(s.round, [...(perRound.get(s.round) ?? []), s]);

  for (let r = 1; r <= rounds; r++) {
    const slots = perRound.get(r) ?? [];
    for (let t = 1; t <= tables; t++) {
      const c = slots.filter((s) => s.table === t).length;
      if (c !== 1) v.push({ code: "TABLE_COVERAGE", round: r, table: t, message: `Round ${r}, table ${t} has ${c} slots (expected 1)` });
    }
    const seated = slots.flatMap((s) => [s.nsPair, s.ewPair].filter((p): p is number => p !== null));
    const uniq = new Set(seated);
    if (seated.length !== pairs || uniq.size !== pairs || [...uniq].some((p) => p < 1 || p > pairs))
      v.push({ code: "PAIR_NOT_ONCE_PER_ROUND", round: r, message: `Round ${r}: each of the ${pairs} pairs must appear exactly once` });
    const sets = slots.flatMap((s) => (s.boardSet === null ? [] : [s.boardSet]));
    if (new Set(sets).size !== sets.length)
      v.push({ code: "BOARDSET_TWICE_IN_ROUND", round: r, message: `Round ${r}: a board set is used at two tables` });
  }

  const meet = new Set<string>();
  const pairSets = new Set<string>();
  for (const s of m.slots) {
    const sit = s.nsPair === null || s.ewPair === null;
    if (s.nsPair === null && s.ewPair === null) { v.push({ code: "SLOT_SHAPE", round: s.round, table: s.table, message: `Round ${s.round}, table ${s.table}: no pairs` }); continue; }
    if (sit !== (s.boardSet === null) || (sit && s.boards.length > 0))
      v.push({ code: "SLOT_SHAPE", round: s.round, table: s.table, message: `Round ${s.round}, table ${s.table}: sit-out and board set are inconsistent` });

    const a = s.nsPair ?? s.ewPair!, b = s.nsPair !== null && s.ewPair !== null ? s.ewPair : 0; // 0 = phantom
    const key = `${Math.min(a, b)}-${Math.max(a, b)}`;
    if (meet.has(key) && b !== 0) v.push({ code: "OPPONENT_REPEAT", round: s.round, table: s.table, message: `Pairs ${a} and ${b} meet again (round ${s.round})` });
    if (b !== 0) meet.add(key);
    if (b === 0) { // sit-out: once per pair
      const k = `sit-${a}`;
      if (meet.has(k)) v.push({ code: "OPPONENT_REPEAT", round: s.round, table: s.table, message: `Pair ${a} sits out again (round ${s.round})` });
      meet.add(k);
    }
    if (s.boardSet !== null) {
      if (s.boardSet < 1 || s.boardSet > boardSets) v.push({ code: "SLOT_SHAPE", round: s.round, table: s.table, message: `Board set ${s.boardSet} out of range` });
      for (const p of [s.nsPair, s.ewPair]) {
        const k = `${p}-${s.boardSet}`;
        if (pairSets.has(k)) v.push({ code: "PAIR_BOARDSET_REPEAT", round: s.round, table: s.table, message: `Pair ${p} plays board set ${s.boardSet} again (round ${s.round})` });
        pairSets.add(k);
      }
      const exp = boardsOfSet(s.boardSet, boardsPerRound);
      if (s.boards.length !== exp.length || s.boards.some((x, i) => x !== exp[i]))
        v.push({ code: "BOARDS_MISMATCH", round: s.round, table: s.table, message: `Round ${s.round}, table ${s.table}: boards do not match set ${s.boardSet}` });
    }
  }
  return { ok: v.length === 0, violations: v };
}
