/**
 * These mirror concepts in @bridge/scoring and @bridge/movement, but are declared
 * independently rather than imported: this layer describes the WIRE format (what a
 * phone sends as JSON), and the server is the single place that maps it onto the
 * engines' internal types (e.g. parseContract from @bridge/scoring). Keeping the
 * two separate means a wire-format change never forces a change to the scoring
 * engine's own types, and vice versa.
 */

export const SEATS = ["N", "E", "S", "W"] as const;
export type Seat = (typeof SEATS)[number];

/** Loose shape check only — level/denomination/doubling grammar is not re-validated
 *  here; @bridge/scoring's parseContract is the single source of truth for that. */
export const CONTRACT_TEXT_RE = /^[1-7](C|D|H|S|NT|N)(X|XX)?$/i;

/** A table result as entered by the NS device. */
export type BoardResultInput =
  | { kind: "passout" }
  | { kind: "played"; contractText: string; declarer: Seat; tricks: number };

/** Lifecycle of a persisted result (see the design doc, section 3.2). */
export const RESULT_STATUSES = ["entered", "confirmed", "voided", "adjusted"] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];

/** Table lock state, controlled only by a director. */
export const LOCK_STATES = ["none", "director_editing", "locked"] as const;
export type LockState = (typeof LOCK_STATES)[number];

/** How a player identified themself in round 1. */
export type PlayerIdentityInput = { kind: "member"; memberId: string } | { kind: "guest"; name: string };

export interface PlayerRef {
  name: string;
  memberId: string | null;
  guest: boolean;
}
