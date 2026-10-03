/** Deterministic PRNG (mulberry32) so a seed always yields the same movement. */
export function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type ColoringResult = { ok: true; colors: number[] } | { ok: false; aborted: boolean };

/**
 * Exact graph colouring with at most `maxColors` colours (DSATUR branch and bound),
 * giving up after `nodeLimit` search nodes so callers can fall back to more colours.
 */
export function colorGraph(adj: readonly (readonly number[])[], maxColors: number, nodeLimit: number, rand: () => number): ColoringResult {
  const n = adj.length;
  const color = new Int32Array(n).fill(-1);
  const cnt = adj.map(() => new Int32Array(maxColors));
  const sat = new Int32Array(n);
  const prio = Array.from({ length: n }, () => rand());
  let uncolored = n;
  let nodes = 0;
  let aborted = false;

  const assign = (v: number, c: number) => {
    color[v] = c;
    for (const u of adj[v]!) if (cnt[u]![c]!++ === 0) sat[u]!++;
  };
  const unassign = (v: number) => {
    const c = color[v]!;
    color[v] = -1;
    for (const u of adj[v]!) if (--cnt[u]![c]! === 0) sat[u]!--;
  };
  const select = (): number => {
    let best = -1;
    for (let v = 0; v < n; v++) {
      if (color[v]! >= 0) continue;
      if (best < 0 || sat[v]! > sat[best]! || (sat[v] === sat[best] && (adj[v]!.length > adj[best]!.length || (adj[v]!.length === adj[best]!.length && prio[v]! > prio[best]!)))) best = v;
    }
    return best;
  };
  const solve = (used: number): boolean => {
    if (uncolored === 0) return true;
    if (++nodes > nodeLimit) { aborted = true; return false; }
    const v = select();
    if (sat[v]! >= maxColors) return false;
    for (let c = 0; c <= Math.min(used, maxColors - 1); c++) {
      if (cnt[v]![c]! !== 0) continue;
      assign(v, c); uncolored--;
      if (solve(Math.max(used, c + 1))) return true;
      unassign(v); uncolored++;
      if (aborted) return false;
    }
    return false;
  };

  return solve(0) ? { ok: true, colors: Array.from(color) } : { ok: false, aborted };
}
