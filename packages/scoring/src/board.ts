import type { BoardResult, Contract, ContractBid, Denomination, Doubling, Seat, Vulnerability } from "./types.ts";
import { declarerScore } from "./contract.ts";

const VUL_CYCLE: Vulnerability[] = [
  "NONE", "NS", "EW", "BOTH",
  "NS", "EW", "BOTH", "NONE",
  "EW", "BOTH", "NONE", "NS",
  "BOTH", "NONE", "NS", "EW",
];
const DEALERS: Seat[] = ["N", "E", "S", "W"];

function checkBoard(n: number): void {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`board number must be a positive integer, got ${n}`);
}

/** Vulnerability by board number (repeats every 16 boards). */
export function vulnerabilityForBoard(board: number): Vulnerability {
  checkBoard(board);
  return VUL_CYCLE[(board - 1) % 16]!;
}

/** Dealer by board number: N, E, S, W repeating. */
export function dealerForBoard(board: number): Seat {
  checkBoard(board);
  return DEALERS[(board - 1) % 4]!;
}

export function isVulnerable(vul: Vulnerability, seat: Seat): boolean {
  if (vul === "BOTH") return true;
  if (vul === "NONE") return false;
  return vul === "NS" ? seat === "N" || seat === "S" : seat === "E" || seat === "W";
}

/** Parse "4S", "3NT", "3N", "1SX", "6HXX" (case-insensitive). */
export function parseContract(text: string): ContractBid {
  const m = /^([1-7])(C|D|H|S|NT|N)(XX|X)?$/i.exec(text.trim());
  if (!m) throw new Error(`Invalid contract: "${text}"`);
  const d = m[2]!.toUpperCase();
  return {
    level: Number(m[1]),
    denomination: (d === "N" ? "NT" : d) as Denomination,
    doubling: (m[3] ?? "").toUpperCase() as Doubling,
  };
}

/** Convert "=", "+1", "-2" (relative to contract) to total tricks. */
export function tricksFromRelative(level: number, relative: number): number {
  const tricks = level + 6 + relative;
  if (tricks < 0 || tricks > 13) throw new RangeError(`Impossible result: level ${level} ${relative >= 0 ? "+" : ""}${relative}`);
  return tricks;
}

/** Score of a table result from NS's point of view (pass-out = 0). */
export function scoreForNS(result: BoardResult, vulnerability: Vulnerability): number {
  if (result.kind === "passout") return 0;
  const c: Contract = result.contract;
  const s = declarerScore(c.level, c.denomination, c.doubling, isVulnerable(vulnerability, c.declarer), result.tricks);
  return c.declarer === "N" || c.declarer === "S" ? s : -s;
}
