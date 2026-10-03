import type { Movement, MitchellParams, Phantom, ResolvedParams, Slot } from "./types.ts";
import { validateMovement } from "./validate.ts";

const mod = (a: number, n: number): number => ((a % n) + n) % n;

function assertPositiveInt(name: string, v: number): void {
  if (!Number.isInteger(v) || v < 1) throw new RangeError(`${name} must be a positive integer, got ${v}`);
}

/** Board numbers of a board set: set k with b boards = [(k-1)b+1 .. kb]. */
export function boardsOfSet(boardSet: number, boardsPerRound: number): number[] {
  const start = (boardSet - 1) * boardsPerRound + 1;
  return Array.from({ length: boardsPerRound }, (_, i) => start + i);
}

/** Replace the phantom pair by null in every slot (creates the sit-out slots). */
function applyPhantom(slots: Slot[], phantom: Phantom | null): Slot[] {
  if (!phantom) return slots;
  return slots.map((s) =>
    phantom.side === "NS"
      ? { ...s, nsPair: s.nsPair === phantom.pair ? null : s.nsPair }
      : { ...s, ewPair: s.ewPair === phantom.pair ? null : s.ewPair },
  );
}

/** Build slots for explicit (resolved) parameters. No validation. */
function buildSlots(p: ResolvedParams): Slot[] {
  return applyPhantom(buildBaseSlots(p), p.phantom);
}

/** The full movement with every pair real (phantom not applied). */
function buildBaseSlots(p: ResolvedParams): Slot[] {
  const { tables: n, boardsPerRound, rounds, skipAfterRound } = p;
  const slots: Slot[] = [];
  for (let r = 1; r <= rounds; r++) {
    // EW pairs move to the NEXT table each round (+1 more after the skip round).
    const shift = r - 1 + (skipAfterRound !== null && r > skipAfterRound ? 1 : 0);
    for (let t = 1; t <= n; t++) {
      const boardSet = mod(t - 1 + (r - 1), n) + 1; // board sets move to the PREVIOUS table
      slots.push({
        round: r,
        table: t,
        nsPair: t,
        ewPair: mod(t - 1 - shift, n) + 1,
        boardSet,
        boards: boardsOfSet(boardSet, boardsPerRound),
      });
    }
  }
  return slots;
}

/** All skip positions (1..rounds-1) that give a valid movement for these table/round counts. */
export function findValidSkips(tables: number, rounds: number, boardsPerRound = 1): number[] {
  const valid: number[] = [];
  for (let s = 1; s < rounds; s++) {
    const p: ResolvedParams = { tables, boardsPerRound, rounds, skipAfterRound: s, phantom: null };
    if (validateMovement({ params: p, slots: buildBaseSlots(p) }).ok) valid.push(s);
  }
  return valid;
}

/** Fill in defaults. Throws if no valid Mitchell exists for the request. */
export function resolveParams(input: MitchellParams): ResolvedParams {
  const { tables, boardsPerRound } = input;
  assertPositiveInt("tables", tables);
  assertPositiveInt("boardsPerRound", boardsPerRound);

  const rounds = input.rounds ?? (tables % 2 === 1 ? tables : Math.max(1, tables - 1));
  assertPositiveInt("rounds", rounds);
  if (rounds > tables) throw new RangeError(`rounds (${rounds}) cannot exceed tables (${tables})`);

  const phantom = input.phantom ?? null;
  if (phantom && (!["NS", "EW"].includes(phantom.side) || !Number.isInteger(phantom.pair) || phantom.pair < 1 || phantom.pair > tables))
    throw new RangeError(`phantom must be {side: NS|EW, pair: 1..${tables}}`);

  // Skip validity is judged on the full movement (phantom filled in), so an odd-pair
  // movement is always a sub-movement of a standard one.
  const noSkip: ResolvedParams = { tables, boardsPerRound, rounds, skipAfterRound: null, phantom };
  const valid = (p: ResolvedParams) => validateMovement({ params: { ...p, phantom: null }, slots: buildBaseSlots(p) }).ok;

  if (input.skipAfterRound === null) {
    if (!valid(noSkip)) throw new Error(`No valid movement for ${tables} tables, ${rounds} rounds without a skip`);
    return noSkip;
  }
  if (input.skipAfterRound !== undefined) {
    const p = { ...noSkip, skipAfterRound: input.skipAfterRound };
    if (!valid(p)) throw new Error(`Skip after round ${input.skipAfterRound} is invalid for ${tables} tables, ${rounds} rounds`);
    return p;
  }
  // Auto: prefer no skip, otherwise the valid skip nearest the middle.
  if (valid(noSkip)) return noSkip;
  const skips = findValidSkips(tables, rounds, boardsPerRound);
  if (skips.length === 0) throw new Error(`No valid Mitchell movement for ${tables} tables and ${rounds} rounds`);
  const mid = tables / 2;
  skips.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b);
  return { ...noSkip, skipAfterRound: skips[0]! };
}

/** Generate and validate a Mitchell movement. Never returns an invalid movement. */
export function generateMitchell(input: MitchellParams): Movement {
  const params = resolveParams(input);
  const movement: Movement = { params, slots: buildSlots(params) };
  const report = validateMovement(movement);
  if (!report.ok) throw new Error(`Generated movement failed validation: ${report.violations[0]?.message}`);
  return movement;
}

export interface PairsParams {
  /** Total number of real pairs (odd or even). */
  pairs: number;
  boardsPerRound: number;
  rounds?: number;
  skipAfterRound?: number | null;
  /**
   * Odd number of pairs only. "NS" (default): the highest-numbered table stays empty and the
   * arriving EW pair sits out. "EW": a real NS pair sits idle at its own table.
   */
  phantomSide?: "NS" | "EW";
}

/** Generate a Mitchell for a number of pairs; an odd count adds a phantom pair automatically. */
export function generateMitchellForPairs(input: PairsParams): Movement {
  const { pairs } = input;
  if (!Number.isInteger(pairs) || pairs < 2) throw new RangeError(`pairs must be an integer >= 2, got ${pairs}`);
  const odd = pairs % 2 === 1;
  const tables = odd ? (pairs + 1) / 2 : pairs / 2;
  return generateMitchell({
    tables,
    boardsPerRound: input.boardsPerRound,
    rounds: input.rounds,
    skipAfterRound: input.skipAfterRound,
    phantom: odd ? { side: input.phantomSide ?? "NS", pair: tables } : null,
  });
}
