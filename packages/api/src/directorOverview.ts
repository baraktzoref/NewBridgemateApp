/**
 * Builds what the director's screen needs to show: the event's current state
 * plus, per table, lock status, whether its phone is connected, whether its
 * NS/EW pairs are identified yet, and how many results have come in this
 * round. Aggregates read-only domain calls — no business logic of its own —
 * the same pattern as tableState.ts for the table phone.
 */
import type { Db } from "../../server/src/db/connection.ts";
import { getEvent, getPair, getSlot, parseBoards, publicEvent } from "../../server/src/domain/eventService.ts";
import { getActiveDevice, getTable } from "../../server/src/domain/deviceService.ts";
import { resultsForTableRound, toResultDto } from "../../server/src/domain/resultService.ts";
import type { ResultDto } from "../../shared/src/index.ts";

export interface TableOverview {
  table: number;
  lockState: "none" | "director_editing" | "locked";
  lockedBy: string | null;
  device: { connected: boolean; label: string | null; lastSeenAt: string | null };
  ns: { pair: number | null; identified: boolean };
  ew: { pair: number | null; identified: boolean };
  boards: number[];
  boardsScheduled: number;
  resultsEntered: number;
  resultsConfirmed: number;
  results: ResultDto[];
}

export interface EventOverview {
  event: ReturnType<typeof publicEvent>;
  tables: TableOverview[];
}

export function buildEventOverview(db: Db, eventId: string): EventOverview {
  const event = getEvent(db, eventId);
  if (!event) throw new Error("event not found");
  const round = event.current_round;

  const tables: TableOverview[] = [];
  for (let t = 1; t <= event.tables; t++) {
    const tableRow = getTable(db, eventId, t);
    const device = getActiveDevice(db, eventId, t);
    const slot = getSlot(db, eventId, round, t);
    const nsPair = slot?.ns_pair ?? null;
    const ewPair = slot?.ew_pair ?? null;
    const nsIdentified = nsPair !== null ? Boolean(getPair(db, eventId, "NS", nsPair)?.identified) : false;
    const ewIdentified = ewPair !== null ? Boolean(getPair(db, eventId, "EW", ewPair)?.identified) : false;
    const results = resultsForTableRound(db, eventId, round, t).map(toResultDto);
    const boards = slot ? parseBoards(slot.boards) : [];

    tables.push({
      table: t,
      lockState: tableRow?.lock_state ?? "none",
      lockedBy: tableRow?.locked_by ?? null,
      device: { connected: Boolean(device), label: null, lastSeenAt: device?.last_seen_at ?? null },
      ns: { pair: nsPair, identified: nsIdentified },
      ew: { pair: ewPair, identified: ewIdentified },
      boards,
      boardsScheduled: boards.length,
      resultsEntered: results.filter((r) => r.status === "entered").length,
      resultsConfirmed: results.filter((r) => r.status === "confirmed" || r.status === "adjusted").length,
      results,
    });
  }

  return { event: publicEvent(event), tables };
}
