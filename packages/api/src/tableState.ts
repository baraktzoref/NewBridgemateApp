import type { Db } from "../../server/src/db/connection.ts";
import { getEvent, getPair, getSlot, pairPlayers, parseBoards } from "../../server/src/domain/eventService.ts";
import { getTable } from "../../server/src/domain/deviceService.ts";
import { resultsForTableRound, toResultDto } from "../../server/src/domain/resultService.ts";
import type { TableStateDto } from "../../shared/src/index.ts";

/** Builds what a table's phone sees right now: the current round's slot, players, and its own results. */
export function buildTableState(db: Db, eventId: string, table: number): TableStateDto {
  const event = getEvent(db, eventId);
  if (!event) throw new Error("event not found");
  const round = event.current_round;
  const slot = getSlot(db, eventId, round, table);
  const tableRow = getTable(db, eventId, table);

  const ns = slot?.ns_pair != null ? { pair: slot.ns_pair, players: pairPlayers(getPair(db, eventId, "NS", slot.ns_pair)) } : null;
  const ew = slot?.ew_pair != null ? { pair: slot.ew_pair, players: pairPlayers(getPair(db, eventId, "EW", slot.ew_pair)) } : null;

  const identificationRequired =
    (ns !== null && !getPair(db, eventId, "NS", ns.pair)?.identified) ||
    (ew !== null && !getPair(db, eventId, "EW", ew.pair)?.identified);

  return {
    round,
    table,
    boardsPerRound: event.boards_per_round,
    ns,
    ew,
    boardSet: slot?.board_set ?? null,
    boards: slot ? parseBoards(slot.boards) : [],
    results: resultsForTableRound(db, eventId, round, table).map(toResultDto),
    lockState: tableRow?.lock_state ?? "none",
    identificationRequired: Boolean(identificationRequired),
  };
}
