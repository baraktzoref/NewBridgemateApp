import type { BoardResultInput, PlayerIdentityInput, Seat } from "./domain.ts";
import { CONTRACT_TEXT_RE, SEATS } from "./domain.ts";
import type { Result } from "./validation.ts";
import { checkEnum, checkInt, checkNonEmptyString, collect, err, isRecord, ok } from "./validation.ts";

// ---------------------------------------------------------------------------
// Session / connection (table device — level 2, see design doc section 3.2)
// ---------------------------------------------------------------------------

/** Phone scans the table QR and sends this once, to become the table's active device. */
export interface ConnectRequest {
  tableToken: string;
  /** The 4-digit code shown on the director's screen; required on first connect. */
  eventCode: string;
  /** Free-text label shown to the director ("iPhone — צפון-דרום 4"), optional. */
  deviceLabel?: string;
}

export function parseConnectRequest(x: unknown): Result<ConnectRequest> {
  if (!isRecord(x)) return err("body must be an object");
  const errors = collect([
    checkNonEmptyString(x.tableToken, "tableToken", 128),
    checkNonEmptyString(x.eventCode, "eventCode", 16),
    x.deviceLabel === undefined ? null : checkNonEmptyString(x.deviceLabel, "deviceLabel", 60),
  ]);
  if (errors.length) return err(...errors);
  return ok({ tableToken: x.tableToken as string, eventCode: x.eventCode as string, deviceLabel: x.deviceLabel as string | undefined });
}

/** Emergency re-connect: a replacement phone takes over an already-active table. */
export interface TakeoverRequest extends ConnectRequest {
  reason?: string;
}

export function parseTakeoverRequest(x: unknown): Result<TakeoverRequest> {
  const base = parseConnectRequest(x);
  if (!base.ok) return base;
  const reason = isRecord(x) && x.reason !== undefined ? checkNonEmptyString(x.reason, "reason", 200) : null;
  if (reason) return err(reason);
  return ok({ ...base.value, reason: isRecord(x) ? (x.reason as string | undefined) : undefined });
}

// ---------------------------------------------------------------------------
// Round-1 player identification
// ---------------------------------------------------------------------------

function parsePlayerIdentity(x: unknown, name: string): Result<PlayerIdentityInput> {
  if (!isRecord(x)) return err(`${name} must be an object`);
  if (x.kind === "member") {
    const e = checkNonEmptyString(x.memberId, `${name}.memberId`, 40);
    return e ? err(e) : ok({ kind: "member", memberId: x.memberId as string });
  }
  if (x.kind === "guest") {
    const e = checkNonEmptyString(x.name, `${name}.name`, 80);
    return e ? err(e) : ok({ kind: "guest", name: x.name as string });
  }
  return err(`${name}.kind must be "member" or "guest"`);
}

export interface PairIdentificationRequest {
  clientEventId: string;
  side: "NS" | "EW";
  player1: PlayerIdentityInput;
  player2: PlayerIdentityInput;
}

export function parsePairIdentificationRequest(x: unknown): Result<PairIdentificationRequest> {
  if (!isRecord(x)) return err("body must be an object");
  const errors = collect([
    checkNonEmptyString(x.clientEventId, "clientEventId", 64),
    checkEnum(x.side, "side", ["NS", "EW"] as const),
  ]);
  if (errors.length) return err(...errors);
  const p1 = parsePlayerIdentity(x.player1, "player1");
  const p2 = parsePlayerIdentity(x.player2, "player2");
  if (!p1.ok || !p2.ok) return err(...[...(p1.ok ? [] : p1.errors), ...(p2.ok ? [] : p2.errors)]);
  return ok({ clientEventId: x.clientEventId as string, side: x.side as "NS" | "EW", player1: p1.value, player2: p2.value });
}

// ---------------------------------------------------------------------------
// Result entry and confirmation
// ---------------------------------------------------------------------------

function parseBoardResultInput(x: unknown): Result<BoardResultInput> {
  if (!isRecord(x)) return err("result must be an object");
  if (x.kind === "passout") return ok({ kind: "passout" });
  if (x.kind !== "played") return err('result.kind must be "passout" or "played"');
  const errors = collect([
    checkEnum(x.declarer, "declarer", SEATS),
    checkInt(x.tricks, "tricks", { min: 0, max: 13 }),
    typeof x.contractText === "string" && CONTRACT_TEXT_RE.test(x.contractText) ? null : "contractText must look like a contract, e.g. \"4S\", \"3NTX\", \"7NTXX\"",
  ]);
  if (errors.length) return err(...errors);
  return ok({ kind: "played", contractText: (x.contractText as string).toUpperCase(), declarer: x.declarer as Seat, tricks: x.tricks as number });
}

export interface ResultSubmission {
  clientEventId: string;
  round: number;
  table: number;
  board: number;
  result: BoardResultInput;
}

export function parseResultSubmission(x: unknown): Result<ResultSubmission> {
  if (!isRecord(x)) return err("body must be an object");
  const errors = collect([
    checkNonEmptyString(x.clientEventId, "clientEventId", 64),
    checkInt(x.round, "round", { min: 1 }),
    checkInt(x.table, "table", { min: 1 }),
    checkInt(x.board, "board", { min: 1 }),
  ]);
  const r = parseBoardResultInput(x.result);
  if (!r.ok) return err(...errors, ...r.errors);
  if (errors.length) return err(...errors);
  return ok({ clientEventId: x.clientEventId as string, round: x.round as number, table: x.table as number, board: x.board as number, result: r.value });
}

/** EW confirms the result currently shown on the NS device. */
export interface ConfirmResultRequest {
  clientEventId: string;
  resultId: string;
  /** Optional extra check (e.g. last digit of an EW member id) if the director enabled it for this event. */
  opponentCode?: string;
}

export function parseConfirmResultRequest(x: unknown): Result<ConfirmResultRequest> {
  if (!isRecord(x)) return err("body must be an object");
  const errors = collect([
    checkNonEmptyString(x.clientEventId, "clientEventId", 64),
    checkNonEmptyString(x.resultId, "resultId", 64),
    x.opponentCode === undefined ? null : checkNonEmptyString(x.opponentCode, "opponentCode", 20),
  ]);
  if (errors.length) return err(...errors);
  return ok({ clientEventId: x.clientEventId as string, resultId: x.resultId as string, opponentCode: x.opponentCode as string | undefined });
}

/** NS presses "call director"; no result data, just a flag at a table. */
export interface CallDirectorRequest {
  clientEventId: string;
  message?: string;
}

export function parseCallDirectorRequest(x: unknown): Result<CallDirectorRequest> {
  if (!isRecord(x)) return err("body must be an object");
  const errors = collect([
    checkNonEmptyString(x.clientEventId, "clientEventId", 64),
    x.message === undefined ? null : checkNonEmptyString(x.message, "message", 300),
  ]);
  if (errors.length) return err(...errors);
  return ok({ clientEventId: x.clientEventId as string, message: x.message as string | undefined });
}

// ---------------------------------------------------------------------------
// Director actions (level 1 — always wins, see design doc section 3.2)
// ---------------------------------------------------------------------------

export interface DirectorLoginRequest {
  pin: string;
}

export function parseDirectorLoginRequest(x: unknown): Result<DirectorLoginRequest> {
  if (!isRecord(x)) return err("body must be an object");
  const e = checkNonEmptyString(x.pin, "pin", 20);
  return e ? err(e) : ok({ pin: x.pin as string });
}

export interface DirectorEditResultRequest {
  resultId: string;
  result: BoardResultInput;
  /** Pins the edit to the version last seen; a stale edit is rejected, never silently overwritten. */
  ifVersion?: number;
  reason?: string;
}

export function parseDirectorEditResultRequest(x: unknown): Result<DirectorEditResultRequest> {
  if (!isRecord(x)) return err("body must be an object");
  const errors = collect([
    checkNonEmptyString(x.resultId, "resultId", 64),
    x.ifVersion === undefined ? null : checkInt(x.ifVersion, "ifVersion", { min: 1 }),
    x.reason === undefined ? null : checkNonEmptyString(x.reason, "reason", 300),
  ]);
  const r = parseBoardResultInput(x.result);
  if (!r.ok) return err(...errors, ...r.errors);
  if (errors.length) return err(...errors);
  return ok({
    resultId: x.resultId as string,
    result: r.value,
    ifVersion: x.ifVersion as number | undefined,
    reason: x.reason as string | undefined,
  });
}

/** Director assigns a fixed board score (Average, Average+, Average-, or an arbitrary %) instead of a played result. */
export interface DirectorOverrideRequest {
  resultId: string;
  adjustedNsPct: number;
  adjustedEwPct: number;
  ifVersion?: number;
  reason?: string;
}

export function parseDirectorOverrideRequest(x: unknown): Result<DirectorOverrideRequest> {
  if (!isRecord(x)) return err("body must be an object");
  const errors = collect([
    checkNonEmptyString(x.resultId, "resultId", 64),
    checkInt(x.adjustedNsPct, "adjustedNsPct", { min: 0, max: 100 }),
    checkInt(x.adjustedEwPct, "adjustedEwPct", { min: 0, max: 100 }),
    x.ifVersion === undefined ? null : checkInt(x.ifVersion, "ifVersion", { min: 1 }),
    x.reason === undefined ? null : checkNonEmptyString(x.reason, "reason", 300),
  ]);
  if (errors.length) return err(...errors);
  return ok({
    resultId: x.resultId as string,
    adjustedNsPct: x.adjustedNsPct as number,
    adjustedEwPct: x.adjustedEwPct as number,
    ifVersion: x.ifVersion as number | undefined,
    reason: x.reason as string | undefined,
  });
}

export interface TableLockRequest {
  table: number;
  action: "lock" | "unlock";
}

export function parseTableLockRequest(x: unknown): Result<TableLockRequest> {
  if (!isRecord(x)) return err("body must be an object");
  const errors = collect([
    checkInt(x.table, "table", { min: 1 }),
    checkEnum(x.action, "action", ["lock", "unlock"] as const),
  ]);
  if (errors.length) return err(...errors);
  return ok({ table: x.table as number, action: x.action as "lock" | "unlock" });
}

export interface DisconnectDeviceRequest {
  table: number;
}

export function parseDisconnectDeviceRequest(x: unknown): Result<DisconnectDeviceRequest> {
  if (!isRecord(x)) return err("body must be an object");
  const e = checkInt(x.table, "table", { min: 1 });
  return e ? err(e) : ok({ table: x.table as number });
}
