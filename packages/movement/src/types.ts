/**
 * A "phantom" pair fills the empty seat when the number of pairs is odd.
 * Whoever is scheduled against it sits out that round, and the board set at that
 * table is not played. NS phantom = one table stays empty (the arriving EW pair
 * sits out); EW phantom = a real NS pair sits idle at its table.
 */
export interface Phantom {
  side: "NS" | "EW";
  /** Pair number (1..tables) that is not a real pair. */
  pair: number;
}

/** Parameters requested by the director. Omitted values are resolved by generateMitchell. */
export interface MitchellParams {
  /** Number of tables = number of NS pair slots = number of EW pair slots. */
  tables: number;
  /** Boards played per round (per table). */
  boardsPerRound: number;
  /** Number of rounds. Default: tables (odd) or tables-1 (even). */
  rounds?: number;
  /**
   * EW pairs jump one extra table after this round.
   * undefined = choose automatically, null = force no skip.
   */
  skipAfterRound?: number | null;
  /** Odd number of pairs: which seat is the phantom. Default: none. */
  phantom?: Phantom | null;
}

export interface ResolvedParams {
  tables: number;
  boardsPerRound: number;
  rounds: number;
  skipAfterRound: number | null;
  phantom: Phantom | null;
}

/** One table in one round. A null pair means the phantom is there: it is a sit-out slot. */
export interface Slot {
  round: number;
  table: number;
  /** NS pair number (fixed: equals the table number), or null if NS is the phantom. */
  nsPair: number | null;
  /** EW pair number, or null if EW is the phantom. */
  ewPair: number | null;
  /** Board set (1..tables) at this table this round. Not played in a sit-out slot. */
  boardSet: number;
  /** Actual board numbers, e.g. set 2 with 3 boards per round = [4,5,6]. */
  boards: number[];
}

export interface Movement {
  params: ResolvedParams;
  /** Ordered by round, then table. */
  slots: Slot[];
}

export type ViolationCode =
  | "TABLE_COVERAGE"
  | "NS_NOT_ONCE_PER_ROUND"
  | "EW_NOT_ONCE_PER_ROUND"
  | "BOARDSET_NOT_ONCE_PER_ROUND"
  | "PHANTOM_MISPLACED"
  | "NS_EW_REPEAT"        // same NS-EW pair meet twice (or a pair sits out twice)
  | "EW_BOARDSET_REPEAT"
  | "NS_BOARDSET_REPEAT"
  | "BOARDS_MISMATCH";

export interface Violation {
  code: ViolationCode;
  message: string;
  round?: number;
  table?: number;
}

export interface ValidationReport {
  ok: boolean;
  violations: Violation[];
}

/** What the phone / guide card shows for one round of one EW pair. */
export interface EwRouteStep {
  round: number;
  table: number;
  /** null when sitting out (NS phantom). */
  nsPair: number | null;
  boardSet: number;
  boards: number[];
  /** true when this pair jumped one extra table to get here (Skip round). */
  skipped: boolean;
  sitOut: boolean;
}

export interface SitOut {
  round: number;
  table: number;
  side: "NS" | "EW";
  pair: number;
}

export interface PairSummary {
  side: "NS" | "EW";
  pair: number;
  roundsPlayed: number;
  roundsSitOut: number;
  boardsPlayed: number;
}

// ---------------------------------------------------------------------------
// Howell: every pair moves; the movement is a schedule of matches, not a formula.
// ---------------------------------------------------------------------------

export interface HowellParams {
  /** Real pairs (odd counts get a phantom pair, numbered pairs+1, which creates sit-outs). */
  pairs: number;
  tables: number;
  boardsPerRound: number;
  rounds: number;
  /** Distinct board sets used (total boards = boardSets * boardsPerRound). */
  boardSets: number;
  /** Lower bound on boardSets for this schedule (a pair needs a different set every round). */
  boardSetsLowerBound: number;
}

/** One table in one round. Sit-out (phantom opponent): one pair is null, boardSet null, no boards. */
export interface HowellSlot {
  round: number;
  table: number;
  nsPair: number | null;
  ewPair: number | null;
  boardSet: number | null;
  boards: number[];
}

export interface HowellMovement {
  params: HowellParams;
  slots: HowellSlot[];
}

export type HowellViolationCode =
  | "TABLE_COVERAGE"
  | "PAIR_NOT_ONCE_PER_ROUND"
  | "SLOT_SHAPE"          // sit-out / played slot inconsistent
  | "BOARDSET_TWICE_IN_ROUND"
  | "OPPONENT_REPEAT"     // two pairs meet twice (or a pair sits out twice)
  | "PAIR_BOARDSET_REPEAT"
  | "BOARDS_MISMATCH";

export interface HowellViolation {
  code: HowellViolationCode;
  message: string;
  round?: number;
  table?: number;
}

export interface HowellReport {
  ok: boolean;
  violations: HowellViolation[];
}

export interface HowellStep {
  round: number;
  table: number;
  side: "NS" | "EW";
  /** null = sit-out. */
  opponent: number | null;
  boardSet: number | null;
  boards: number[];
  sitOut: boolean;
}
