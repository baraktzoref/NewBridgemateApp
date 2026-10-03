import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "../src/db/connection.ts";
import { migrate } from "../src/db/schema.ts";
import { createEvent } from "../src/domain/eventService.ts";
import {
  connectDevice, takeoverDevice, heartbeat, assertActiveDevice, getActiveDevice, disconnectDevice,
  lockTable, unlockTable, isTableWritableByDevice, DeviceError,
} from "../src/domain/deviceService.ts";
import { submitResult, confirmResult, directorEditResult, ServerError } from "../src/domain/resultService.ts";

function setup() {
  const db = new Db(":memory:");
  migrate(db);
  const created = createEvent(db, { name: "E", pairs: 20, boardsPerRound: 3 });
  return { db, created };
}

// ---------------------------------------------------------------------------
// Connect / takeover
// ---------------------------------------------------------------------------

test("connectDevice: first connect succeeds with the right event code", () => {
  const { db, created } = setup();
  const d = connectDevice(db, created.eventId, 1, created.eventCode);
  assert.ok(d.device_token);
  assert.equal(d.is_active, 1);
  assert.equal(getActiveDevice(db, created.eventId, 1)!.id, d.id);
});

test("connectDevice: wrong event code is rejected", () => {
  const { db, created } = setup();
  assert.throws(() => connectDevice(db, created.eventId, 1, "0000"), (e: unknown) => e instanceof DeviceError && e.code === "BAD_EVENT_CODE");
});

test("connectDevice: a second connect to the same table is rejected, must use takeover", () => {
  const { db, created } = setup();
  connectDevice(db, created.eventId, 1, created.eventCode);
  assert.throws(() => connectDevice(db, created.eventId, 1, created.eventCode), (e: unknown) => e instanceof DeviceError && e.code === "ALREADY_ACTIVE");
});

test("takeoverDevice: deactivates the old device and activates a new one", () => {
  const { db, created } = setup();
  const first = connectDevice(db, created.eventId, 1, created.eventCode);
  const second = takeoverDevice(db, created.eventId, 1, created.eventCode, "battery died");
  assert.notEqual(second.device_token, first.device_token);
  assert.equal(getActiveDevice(db, created.eventId, 1)!.id, second.id);
  // The old device's token is no longer the active one.
  assert.throws(() => assertActiveDevice(db, created.eventId, 1, first.device_token), DeviceError);
});

test("takeoverDevice: works even with no prior device (e.g. a table nobody connected to yet)", () => {
  const { db, created } = setup();
  const d = takeoverDevice(db, created.eventId, 1, created.eventCode);
  assert.equal(d.is_active, 1);
});

test("assertActiveDevice: accepts the current token, rejects any other", () => {
  const { db, created } = setup();
  const d = connectDevice(db, created.eventId, 1, created.eventCode);
  assert.doesNotThrow(() => assertActiveDevice(db, created.eventId, 1, d.device_token));
  assert.throws(() => assertActiveDevice(db, created.eventId, 1, "some-other-token"), DeviceError);
});

test("heartbeat: updates last_seen_at for an active device, rejects a dead token", () => {
  const { db, created } = setup();
  const d = connectDevice(db, created.eventId, 1, created.eventCode);
  heartbeat(db, d.device_token);
  const row = getActiveDevice(db, created.eventId, 1)!;
  assert.ok(row.last_seen_at >= d.connected_at);
  assert.throws(() => heartbeat(db, "nonexistent"), DeviceError);
});

test("disconnectDevice: director clears the active device; a new connect then succeeds", () => {
  const { db, created } = setup();
  connectDevice(db, created.eventId, 1, created.eventCode);
  disconnectDevice(db, created.eventId, 1);
  assert.equal(getActiveDevice(db, created.eventId, 1), undefined);
  assert.doesNotThrow(() => connectDevice(db, created.eventId, 1, created.eventCode));
});

test("disconnectDevice: no active device is an error", () => {
  const { db, created } = setup();
  assert.throws(() => disconnectDevice(db, created.eventId, 1), DeviceError);
});

// ---------------------------------------------------------------------------
// Table locking blocks the table's device; director authority bypasses it
// ---------------------------------------------------------------------------

test("isTableWritableByDevice: true by default, false once locked, true again after unlock", () => {
  const { db, created } = setup();
  assert.equal(isTableWritableByDevice(db, created.eventId, 1), true);
  lockTable(db, created.eventId, 1);
  assert.equal(isTableWritableByDevice(db, created.eventId, 1), false);
  unlockTable(db, created.eventId, 1);
  assert.equal(isTableWritableByDevice(db, created.eventId, 1), true);
});

test("submitResult: rejected with LOCKED while the director has the table locked", () => {
  const { db, created } = setup();
  lockTable(db, created.eventId, 1);
  assert.throws(
    () => submitResult(db, created.eventId, 1, 1, 1, "c1", { kind: "passout" }),
    (e: unknown) => e instanceof ServerError && e.code === "LOCKED",
  );
});

test("confirmResult: rejected with LOCKED while the table is locked (checked via the result's own table)", () => {
  const { db, created } = setup();
  const r = submitResult(db, created.eventId, 1, 1, 1, "c1", { kind: "passout" });
  lockTable(db, created.eventId, 1);
  assert.throws(() => confirmResult(db, created.eventId, r.id), (e: unknown) => e instanceof ServerError && e.code === "LOCKED");
});

test("directorEditResult: the director can still edit a result at a LOCKED table (locking blocks the phone, never the director)", () => {
  const { db, created } = setup();
  const r = submitResult(db, created.eventId, 1, 1, 1, "c1", { kind: "played", contractText: "4S", declarer: "N", tricks: 10 });
  lockTable(db, created.eventId, 1);
  const edited = directorEditResult(db, created.eventId, r.id, { kind: "passout" });
  assert.equal(edited.ns_score, 0);
});

test("unlocking restores the table phone's ability to submit", () => {
  const { db, created } = setup();
  lockTable(db, created.eventId, 1);
  unlockTable(db, created.eventId, 1);
  assert.doesNotThrow(() => submitResult(db, created.eventId, 1, 1, 1, "c1", { kind: "passout" }));
});

test("locking an unknown table is NOT_FOUND", () => {
  const { db, created } = setup();
  assert.throws(() => lockTable(db, created.eventId, 999), (e: unknown) => e instanceof DeviceError && e.code === "NOT_FOUND");
});

// ---------------------------------------------------------------------------
// Audit trail: every authority action leaves a row
// ---------------------------------------------------------------------------

test("audit_log records connect, takeover, disconnect, lock and unlock", () => {
  const { db, created } = setup();
  connectDevice(db, created.eventId, 1, created.eventCode);
  takeoverDevice(db, created.eventId, 1, created.eventCode, "dead battery");
  lockTable(db, created.eventId, 1);
  unlockTable(db, created.eventId, 1);
  disconnectDevice(db, created.eventId, 1);
  const actions = db.all<{ action: string }>(`SELECT action FROM audit_log WHERE event_id = ? ORDER BY id`, [created.eventId]).map((r) => r.action);
  assert.deepEqual(actions, ["device_connected", "device_took_over", "table_locked", "table_unlocked", "device_disconnected"]);
});
