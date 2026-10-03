/**
 * Computes the live standings from persisted Result rows, using @bridge/scoring's
 * matchpointBoard/aggregate/rank for the actual arithmetic. This module only
 * gathers each board's traveller from the DB and maps NS/EW onto pair numbers —
 * Mitchell ranks NS and EW separately (see design doc section 5.2), which is why
 * the result is two lists, not one.
 */
import { aggregate, matchpointBoard, rank } from "../../../scoring/src/index.ts";
import type { PairTotal, Ranked, TravellerEntry } from "../../../scoring/src/index.ts";
import type { Db } from "../db/connection.ts";
import { getEvent } from "./eventService.ts";
import type { ResultRow } from "./resultService.ts";

export interface Standing extends Ranked {
  side: "NS" | "EW";
}

function totalBoards(db: Db, eventId: string): number {
  const slots = db.all<{ boards: string }>(`SELECT boards FROM movement_slot WHERE event_id = ?`, [eventId]);
  return new Set(slots.flatMap((s) => JSON.parse(s.boards) as number[])).size;
}

function toTraveller(results: ResultRow[]): { ns: TravellerEntry; ew: TravellerEntry; nsPair: number; ewPair: number }[] {
  return results.map((r) => {
    const entry: TravellerEntry = r.status === "adjusted" && r.ns_score === null
      ? { id: r.id, adjusted: { ns: r.adjusted_ns_pct!, ew: r.adjusted_ew_pct! } }
      : { id: r.id, nsScore: r.ns_score ?? 0 };
    return { ns: entry, ew: entry, nsPair: r.ns_pair, ewPair: r.ew_pair };
  });
}

/** Standings for both directions, computed from every non-voided result currently in the DB. */
export function computeStandings(db: Db, eventId: string): { ns: Standing[]; ew: Standing[] } {
  const event = getEvent(db, eventId);
  if (!event) throw new Error("event not found");

  const nsBoardMp: { pairId: number; mp: number; top: number }[] = [];
  const ewBoardMp: { pairId: number; mp: number; top: number }[] = [];

  const boards = totalBoards(db, eventId);
  for (let board = 1; board <= boards; board++) {
    const results = db.all<ResultRow>(`SELECT * FROM result WHERE event_id = ? AND board = ? AND status != 'voided'`, [eventId, board]);
    if (results.length === 0) continue;
    const travellerRows = toTraveller(results);
    const lines = matchpointBoard(travellerRows.map((t) => t.ns));
    lines.forEach((line, i) => {
      const row = travellerRows[i]!;
      nsBoardMp.push({ pairId: row.nsPair, mp: line.nsMp, top: line.top });
      ewBoardMp.push({ pairId: row.ewPair, mp: line.ewMp, top: line.top });
    });
  }

  const nsTotals: PairTotal[] = aggregate(nsBoardMp);
  const ewTotals: PairTotal[] = aggregate(ewBoardMp);
  return {
    ns: rank(nsTotals).map((r) => ({ ...r, side: "NS" as const })),
    ew: rank(ewTotals).map((r) => ({ ...r, side: "EW" as const })),
  };
}
