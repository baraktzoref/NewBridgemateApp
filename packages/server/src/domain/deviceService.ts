/**
 * Device sessions and table locking — the level-1/level-2 authority split from
 * the design doc (section 3.2): exactly one phone is "active" (and may write)
 * for a table at a time, and only a director can lock a table, force a takeover,
 * or disconnect a device. This is also where every such action is written to
 * audit_log, since these are the actions the design doc calls out as needing a
 * visible trail (no silent overwrite).
 */
import type { Db } from "../db/connection.ts";
import { getEvent } from "./eventService.ts";
import { newId, now } from "../util.ts";

export type ServerErrorCode2 = "NOT_FOUND" | "BAD_EVENT_CODE" | "ALREADY_ACTIVE" | "LOCKED" | "NO_ACTIVE_DEVICE";

export class DeviceError extends Error {
  code: ServerErrorCode2;
  constructor(code: ServerErrorCode2, message: string) {
    super(message);
    this.code = code;
  }
}

export interface DeviceSessionRow {
  id: string;
  event_id: string;
  table_number: number;
  device_token: string;
  connected_at: string;
  last_seen_at: string;
  is_active: number;
}

function addAudit(db: Db, eventId: string, actor: string, action: string, details: Record<string, unknown>): void {
  db.run(`INSERT INTO audit_log (event_id, ts, actor, action, details) VALUES (?, ?, ?, ?, ?)`, [eventId, now(), actor, action, JSON.stringify(details)]);
}

function activeDeviceRow(db: Db, eventId: string, table: number): DeviceSessionRow | undefined {
  return db.get<DeviceSessionRow>(
    `SELECT * FROM device_session WHERE event_id = ? AND table_number = ? AND is_active = 1`,
    [eventId, table],
  );
}

export function getActiveDevice(db: Db, eventId: string, table: number): DeviceSessionRow | undefined {
  return activeDeviceRow(db, eventId, table);
}

/**
 * First connect for a table. Fails with ALREADY_ACTIVE if another device is
 * already the table's active device — the caller must go through takeoverDevice,
 * so a second phone never silently steals the table.
 */
export function connectDevice(db: Db, eventId: string, table: number, eventCode: string, deviceLabel?: string): DeviceSessionRow {
  const event = getEvent(db, eventId);
  if (!event) throw new DeviceError("NOT_FOUND", "event not found");
  if (eventCode !== event.event_code) throw new DeviceError("BAD_EVENT_CODE", "incorrect event code");

  const existing = activeDeviceRow(db, eventId, table);
  if (existing) throw new DeviceError("ALREADY_ACTIVE", "this table already has an active device; use takeover instead");

  return db.transaction(() => {
    const id = newId();
    const ts = now();
    const token = newId();
    db.run(
      `INSERT INTO device_session (id, event_id, table_number, device_token, connected_at, last_seen_at, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [id, eventId, table, token, ts, ts],
    );
    addAudit(db, eventId, `table-${table}`, "device_connected", { deviceLabel: deviceLabel ?? null });
    return { id, event_id: eventId, table_number: table, device_token: token, connected_at: ts, last_seen_at: ts, is_active: 1 };
  });
}

/**
 * Emergency re-connect: deactivates whatever device is currently active for the
 * table (if any) and activates a new one. Always succeeds given the right event
 * code — this is the one path a replacement phone has when the old one died.
 */
export function takeoverDevice(db: Db, eventId: string, table: number, eventCode: string, reason?: string): DeviceSessionRow {
  const event = getEvent(db, eventId);
  if (!event) throw new DeviceError("NOT_FOUND", "event not found");
  if (eventCode !== event.event_code) throw new DeviceError("BAD_EVENT_CODE", "incorrect event code");

  return db.transaction(() => {
    const previous = activeDeviceRow(db, eventId, table);
    if (previous) db.run(`UPDATE device_session SET is_active = 0 WHERE id = ?`, [previous.id]);
    const id = newId();
    const ts = now();
    const token = newId();
    db.run(
      `INSERT INTO device_session (id, event_id, table_number, device_token, connected_at, last_seen_at, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [id, eventId, table, token, ts, ts],
    );
    addAudit(db, eventId, `table-${table}`, "device_took_over", { reason: reason ?? null, previousDeviceId: previous?.id ?? null });
    return { id, event_id: eventId, table_number: table, device_token: token, connected_at: ts, last_seen_at: ts, is_active: 1 };
  });
}

/** Keeps a device marked alive; the director's screen can show "last seen" from this. */
export function heartbeat(db: Db, deviceToken: string): void {
  const row = db.get<{ id: string }>(`SELECT id FROM device_session WHERE device_token = ? AND is_active = 1`, [deviceToken]);
  if (!row) throw new DeviceError("NO_ACTIVE_DEVICE", "device is not an active session");
  db.run(`UPDATE device_session SET last_seen_at = ? WHERE id = ?`, [now(), row.id]);
}

/** Validates that this token is in fact the table's current active device. Throws otherwise. */
export function assertActiveDevice(db: Db, eventId: string, table: number, deviceToken: string): void {
  const active = activeDeviceRow(db, eventId, table);
  if (!active || active.device_token !== deviceToken) throw new DeviceError("NO_ACTIVE_DEVICE", "this device is no longer the active device for this table");
}

/** Director action: forcibly ends the table's active session (e.g. a dead phone the director wants to clear). */
export function disconnectDevice(db: Db, eventId: string, table: number): void {
  const active = activeDeviceRow(db, eventId, table);
  if (!active) throw new DeviceError("NO_ACTIVE_DEVICE", "no active device at this table");
  db.run(`UPDATE device_session SET is_active = 0 WHERE id = ?`, [active.id]);
  addAudit(db, eventId, "director", "device_disconnected", { table, deviceId: active.id });
}

// ---------------------------------------------------------------------------
// Table locking (director authority over the table's phone, design doc 3.2)
// ---------------------------------------------------------------------------

export interface TableRow {
  event_id: string;
  number: number;
  qr_token: string;
  lock_state: "none" | "director_editing" | "locked";
  locked_by: string | null;
  locked_at: string | null;
}

export function getTable(db: Db, eventId: string, table: number): TableRow | undefined {
  return db.get<TableRow>(`SELECT * FROM "table" WHERE event_id = ? AND number = ?`, [eventId, table]);
}

export function lockTable(db: Db, eventId: string, table: number, lockedBy = "director"): void {
  const row = getTable(db, eventId, table);
  if (!row) throw new DeviceError("NOT_FOUND", "table not found");
  db.run(`UPDATE "table" SET lock_state = 'locked', locked_by = ?, locked_at = ? WHERE event_id = ? AND number = ?`, [lockedBy, now(), eventId, table]);
  addAudit(db, eventId, lockedBy, "table_locked", { table });
}

export function unlockTable(db: Db, eventId: string, table: number): void {
  const row = getTable(db, eventId, table);
  if (!row) throw new DeviceError("NOT_FOUND", "table not found");
  db.run(`UPDATE "table" SET lock_state = 'none', locked_by = NULL, locked_at = NULL WHERE event_id = ? AND number = ?`, [eventId, table]);
  addAudit(db, eventId, "director", "table_unlocked", { table });
}

/** True while the table's own device may write (not locked, not mid director-edit). */
export function isTableWritableByDevice(db: Db, eventId: string, table: number): boolean {
  const row = getTable(db, eventId, table);
  return row !== undefined && row.lock_state === "none";
}

export { addAudit };
