import type { HowellMovement, HowellSlot } from "./types.ts";
import { boardsOfSet } from "./mitchell.ts";
import { colorGraph, rng } from "./coloring.ts";
import { validateHowell } from "./howell-validate.ts";

export interface HowellInput {
  /** Real pairs (>= 2). Odd counts get a phantom pair and a sit-out each round. */
  pairs: number;
  boardsPerRound: number;
  /** Default: full Howell (every pair meets every other once) = N-1 rounds, N = pairs rounded up to even. */
  rounds?: number;
  /** Fail instead of using more board sets than this. */
  maxBoardSets?: number;
  /** Search seed; the same seed always returns the same movement. */
  seed?: number;
}

interface Match { round: number; a: number; b: number } // a, b are 1-based pair numbers (b may be the phantom)

/** Circle-method round robin: in N-1 rounds every pair meets every other exactly once. */
function roundRobin(n: number, rounds: number): Match[] {
  const m = n - 1;
  const out: Match[] = [];
  for (let r = 0; r < rounds; r++) {
    for (let a = 0; a < m; a++) {
      const b = (((r - a) % m) + m) % m;
      if (a === b) out.push({ round: r + 1, a: a + 1, b: n });
      else if (a < b) out.push({ round: r + 1, a: a + 1, b: b + 1 });
    }
  }
  return out;
}

/** Generate and validate a Howell (or shortened Howell) movement. Never returns an invalid one. */
export function generateHowell(input: HowellInput): HowellMovement {
  const { pairs, boardsPerRound } = input;
  if (!Number.isInteger(pairs) || pairs < 2) throw new RangeError(`pairs must be an integer >= 2, got ${pairs}`);
  if (!Number.isInteger(boardsPerRound) || boardsPerRound < 1) throw new RangeError(`boardsPerRound must be >= 1`);
  const n = pairs % 2 === 0 ? pairs : pairs + 1;
  const phantom = pairs % 2 === 1 ? n : null;
  const tables = n / 2;
  const rounds = input.rounds ?? n - 1;
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > n - 1) throw new RangeError(`rounds must be 1..${n - 1}, got ${rounds}`);

  const all = roundRobin(n, rounds);
  const played = all.filter((m) => m.b !== phantom);

  // ---- Board sets: colour matches so that no two matches in a round, and no two matches of one pair, share a set.
  const plays = new Map<number, number>();
  for (const m of played) { plays.set(m.a, (plays.get(m.a) ?? 0) + 1); plays.set(m.b, (plays.get(m.b) ?? 0) + 1); }
  const lowerBound = Math.max(...plays.values());
  const adj: number[][] = played.map(() => []);
  for (let i = 0; i < played.length; i++)
    for (let j = i + 1; j < played.length; j++) {
      const x = played[i]!, y = played[j]!;
      if (x.round === y.round || x.a === y.a || x.a === y.b || x.b === y.a || x.b === y.b) { adj[i]!.push(j); adj[j]!.push(i); }
    }

  const cap = input.maxBoardSets ?? played.length;
  let colors: number[] | null = null;
  for (let s = lowerBound; s <= cap && !colors; s++) {
    for (let attempt = 0; attempt < 3 && !colors; attempt++) {
      const res = colorGraph(adj, s, 60_000, rng((input.seed ?? 1) + attempt * 7919));
      if (res.ok) colors = res.colors;
    }
  }
  if (!colors) throw new Error(`No Howell movement found for ${pairs} pairs, ${rounds} rounds with at most ${cap} board sets`);

  // Renumber board sets 1..S by first appearance (round, then match order).
  const relabel = new Map<number, number>();
  played.forEach((_, i) => { if (!relabel.has(colors![i]!)) relabel.set(colors![i]!, relabel.size + 1); });
  const setOf = new Map<Match, number>();
  played.forEach((m, i) => setOf.set(m, relabel.get(colors![i]!)!));

  // ---- Tables and seating.
  const slots: HowellSlot[] = [];
  const prevTable = new Map<number, number>();
  const nsCount = new Map<number, number>();
  const ewCount = new Map<number, number>();
  for (let r = 1; r <= rounds; r++) {
    const ms = all.filter((m) => m.round === r);
    const free = new Set(Array.from({ length: tables }, (_, i) => i + 1));
    const assigned = new Map<Match, number>();
    // Pairs that already have a table keep it if possible; otherwise nearest free table.
    const cost = (m: Match, t: number) =>
      Math.abs(t - (prevTable.get(m.a) ?? t)) + (m.b === phantom ? 0 : Math.abs(t - (prevTable.get(m.b) ?? t)));
    const order = [...ms].sort((x, y) => Math.min(...[...free].map((t) => cost(x, t))) - Math.min(...[...free].map((t) => cost(y, t))) || x.a - y.a);
    for (const m of order) {
      let best = -1, bc = Infinity;
      for (const t of free) { const c = cost(m, t); if (c < bc) { bc = c; best = t; } }
      assigned.set(m, best);
      free.delete(best);
    }
    for (const m of [...ms].sort((x, y) => assigned.get(x)! - assigned.get(y)!)) {
      const t = assigned.get(m)!;
      if (m.b === phantom) {
        // Sit-out: a real pair, no boards.
        slots.push({ round: r, table: t, nsPair: m.a, ewPair: null, boardSet: null, boards: [] });
        prevTable.set(m.a, t);
        continue;
      }
      // Seating: the pair that has sat NS more often goes EW.
      const imbA = (nsCount.get(m.a) ?? 0) - (ewCount.get(m.a) ?? 0);
      const imbB = (nsCount.get(m.b) ?? 0) - (ewCount.get(m.b) ?? 0);
      const aNS = imbA < imbB || (imbA === imbB && (r + t) % 2 === 0);
      const [ns, ew] = aNS ? [m.a, m.b] : [m.b, m.a];
      nsCount.set(ns, (nsCount.get(ns) ?? 0) + 1);
      ewCount.set(ew, (ewCount.get(ew) ?? 0) + 1);
      prevTable.set(m.a, t); prevTable.set(m.b, t);
      const set = setOf.get(m)!;
      slots.push({ round: r, table: t, nsPair: ns, ewPair: ew, boardSet: set, boards: boardsOfSet(set, boardsPerRound) });
    }
  }
  // Empty tables (fewer matches than tables never happens: matches + sit-outs = tables), so slots are complete.
  slots.sort((x, y) => x.round - y.round || x.table - y.table);

  const movement: HowellMovement = {
    params: { pairs, tables, boardsPerRound, rounds, boardSets: relabel.size, boardSetsLowerBound: lowerBound },
    slots,
  };
  const report = validateHowell(movement);
  if (!report.ok) throw new Error(`Generated Howell failed validation: ${report.violations[0]?.message}`);
  return movement;
}
