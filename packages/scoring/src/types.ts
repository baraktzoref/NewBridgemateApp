export type Seat = "N" | "E" | "S" | "W";
export type Denomination = "C" | "D" | "H" | "S" | "NT";
/** "" = undoubled, "X" = doubled, "XX" = redoubled */
export type Doubling = "" | "X" | "XX";
export type Vulnerability = "NONE" | "NS" | "EW" | "BOTH";

export interface ContractBid {
  level: number; // 1..7
  denomination: Denomination;
  doubling: Doubling;
}

export interface Contract extends ContractBid {
  declarer: Seat;
}

/** A single table result on a board. */
export type BoardResult =
  | { kind: "passout" }
  | {
      kind: "played";
      contract: Contract;
      /** Total tricks taken by the declaring side, 0..13. */
      tricks: number;
    };

/** One line in a board's comparison (traveller). */
export type TravellerEntry =
  | { id: string; nsScore: number }
  /** Director-assigned score as a percentage (e.g. Average = 50, Average+ = 60). Not compared with others. */
  | { id: string; adjusted: { ns: number; ew: number } };

export interface MatchpointLine {
  id: string;
  nsMp: number;
  ewMp: number;
  /** Top for this board = 2 * (played results - 1). 0 when fewer than 2 results are played. */
  top: number;
  /** null when top = 0 and the entry is not adjusted. */
  nsPct: number | null;
  ewPct: number | null;
}
