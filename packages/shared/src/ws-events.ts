import type { LockState, PlayerRef, ResultStatus } from "./domain.ts";

/**
 * The canonical, persisted shape of a result once the server has scored it —
 * what both the table PWA and the director app receive, as opposed to the raw
 * ResultSubmission the table sends in.
 */
export interface ResultDto {
  id: string;
  round: number;
  table: number;
  board: number;
  nsPair: number;
  ewPair: number;
  /** null only for an "adjusted" result with no underlying contract. */
  contractText: string | null;
  declarer: string | null;
  tricks: number | null;
  nsScore: number;
  status: ResultStatus;
  /** Optimistic-concurrency version; pass back as ifVersion on the next edit. */
  version: number;
  enteredAt: string;
  confirmedAt: string | null;
}

/** What a table's phone polls for / receives after connecting. */
export interface TableStateDto {
  round: number;
  table: number;
  boardsPerRound: number;
  ns: { pair: number; players: PlayerRef[] } | null;
  /** null = this table has a sit-out this round (odd number of pairs). */
  ew: { pair: number; players: PlayerRef[] } | null;
  boardSet: number | null;
  boards: number[];
  results: ResultDto[];
  lockState: LockState;
  /** true only while round 1 identification for this table is still incomplete. */
  identificationRequired: boolean;
}

// ---------------------------------------------------------------------------
// WebSocket events, server -> connected clients. Discriminated by `type`.
// ---------------------------------------------------------------------------

export type WsEvent =
  | { type: "round_started"; round: number }
  | { type: "result_entered"; result: ResultDto }
  | { type: "result_confirmed"; resultId: string }
  | { type: "result_changed_by_director"; result: ResultDto }
  | { type: "table_locked"; table: number }
  | { type: "table_unlocked"; table: number }
  | { type: "director_editing"; table: number; editing: boolean }
  | { type: "device_took_over"; table: number }
  | { type: "session_expired"; table: number }
  | { type: "ranking_updated" }
  | { type: "director_message"; table: number; text: string };

export const WS_EVENT_TYPES = [
  "round_started", "result_entered", "result_confirmed", "result_changed_by_director",
  "table_locked", "table_unlocked", "director_editing", "device_took_over",
  "session_expired", "ranking_updated", "director_message",
] as const satisfies readonly WsEvent["type"][];

export function isWsEvent(x: unknown): x is WsEvent {
  return typeof x === "object" && x !== null && "type" in x && (WS_EVENT_TYPES as readonly string[]).includes((x as { type: unknown }).type as string);
}
