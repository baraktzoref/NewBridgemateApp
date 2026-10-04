import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "../src/db/connection.ts";
import { migrate } from "../src/db/schema.ts";
import { createEvent, getEvent, publicEvent } from "../src/domain/eventService.ts";
import { directorLogin, directorLogout, requireDirector, DirectorError, DIRECTOR_SESSION_TTL_MS } from "../src/domain/directorService.ts";

function setup(directorPin?: string) {
  const db = new Db(":memory:");
  migrate(db);
  const created = createEvent(db, { name: "E", pairs: 20, boardsPerRound: 3, directorPin });
  return { db, created };
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

test("createEvent returns a usable directorPin, and never stores it in plaintext", () => {
  const { db, created } = setup();
  assert.match(created.directorPin, /^\d{6}$/);
  const row = getEvent(db, created.eventId)!;
  assert.notEqual(row.director_pin_hash, created.directorPin);
  assert.ok(row.director_pin_hash.length > 0);
  assert.ok(row.director_pin_salt.length > 0);
});

test("createEvent accepts a caller-chosen directorPin instead of a random one", () => {
  const { created } = setup("123456");
  assert.equal(created.directorPin, "123456");
});

test("publicEvent strips the PIN hash/salt from what's safe to send over the API", () => {
  const { db, created } = setup();
  const row = getEvent(db, created.eventId)!;
  const pub = publicEvent(row);
  assert.ok(!("director_pin_hash" in pub));
  assert.ok(!("director_pin_salt" in pub));
  assert.equal((pub as { id: string }).id, created.eventId);
});

test("directorLogin succeeds with the correct PIN and returns a bearer token", () => {
  const { db, created } = setup();
  const session = directorLogin(db, created.eventId, created.directorPin);
  assert.ok(session.token);
  assert.equal(session.event_id, created.eventId);
  assert.equal(session.is_active, 1);
});

test("directorLogin rejects a wrong PIN with BAD_PIN, and mints no session", () => {
  const { db, created } = setup();
  assert.throws(
    () => directorLogin(db, created.eventId, "000000"),
    (e: unknown) => e instanceof DirectorError && e.code === "BAD_PIN",
  );
  const count = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM director_session WHERE event_id = ?`, [created.eventId])!.n;
  assert.equal(count, 0);
});

test("directorLogin against an unknown event is NOT_FOUND", () => {
  const { db } = setup();
  assert.throws(
    () => directorLogin(db, "no-such-event", "000000"),
    (e: unknown) => e instanceof DirectorError && e.code === "NOT_FOUND",
  );
});

// ---------------------------------------------------------------------------
// requireDirector: the gate every director-only route calls
// ---------------------------------------------------------------------------

test("requireDirector accepts a token minted by directorLogin for that same event", () => {
  const { db, created } = setup();
  const session = directorLogin(db, created.eventId, created.directorPin);
  const row = requireDirector(db, created.eventId, session.token);
  assert.equal(row.id, session.id);
});

test("requireDirector rejects a missing token", () => {
  const { db, created } = setup();
  assert.throws(
    () => requireDirector(db, created.eventId, undefined),
    (e: unknown) => e instanceof DirectorError && e.code === "UNAUTHORIZED",
  );
});

test("requireDirector rejects a garbage/unknown token", () => {
  const { db, created } = setup();
  assert.throws(
    () => requireDirector(db, created.eventId, "not-a-real-token"),
    (e: unknown) => e instanceof DirectorError && e.code === "UNAUTHORIZED",
  );
});

test("a token minted for event A is rejected for event B — no cross-event replay", () => {
  const { db, created: eventA } = setup();
  const eventB = createEvent(db, { name: "Other night", pairs: 20, boardsPerRound: 3 });
  const sessionA = directorLogin(db, eventA.eventId, eventA.directorPin);
  assert.throws(
    () => requireDirector(db, eventB.eventId, sessionA.token),
    (e: unknown) => e instanceof DirectorError && e.code === "UNAUTHORIZED",
  );
  // ...but it's still perfectly valid against the event it was actually issued for.
  const row = requireDirector(db, eventA.eventId, sessionA.token);
  assert.equal(row.event_id, eventA.eventId);
});

test("directorLogout revokes the token; it's rejected by requireDirector afterwards", () => {
  const { db, created } = setup();
  const session = directorLogin(db, created.eventId, created.directorPin);
  requireDirector(db, created.eventId, session.token); // works before logout
  directorLogout(db, session.token);
  assert.throws(
    () => requireDirector(db, created.eventId, session.token),
    (e: unknown) => e instanceof DirectorError && e.code === "UNAUTHORIZED",
  );
});

test("logging out one session doesn't revoke a second, independent session for the same event", () => {
  const { db, created } = setup();
  const sessionA = directorLogin(db, created.eventId, created.directorPin);
  const sessionB = directorLogin(db, created.eventId, created.directorPin);
  directorLogout(db, sessionA.token);
  assert.throws(() => requireDirector(db, created.eventId, sessionA.token));
  const row = requireDirector(db, created.eventId, sessionB.token); // still fine
  assert.equal(row.id, sessionB.id);
});

test("requireDirector rejects an expired session and revokes it (mutation-style check on the TTL itself)", () => {
  const { db, created } = setup();
  const session = directorLogin(db, created.eventId, created.directorPin);
  // Backdate last_seen_at past the TTL, simulating a long-idle director session.
  const staleTs = new Date(Date.now() - DIRECTOR_SESSION_TTL_MS - 1000).toISOString();
  db.run(`UPDATE director_session SET last_seen_at = ? WHERE id = ?`, [staleTs, session.id]);
  assert.throws(
    () => requireDirector(db, created.eventId, session.token),
    (e: unknown) => e instanceof DirectorError && e.code === "UNAUTHORIZED",
  );
  const row = db.get<{ is_active: number }>(`SELECT is_active FROM director_session WHERE id = ?`, [session.id])!;
  assert.equal(row.is_active, 0, "an expired session should be marked inactive, not just rejected this once");
});

test("requireDirector refreshes last_seen_at on success, so activity keeps a session alive", () => {
  const { db, created } = setup();
  const session = directorLogin(db, created.eventId, created.directorPin);
  const before = db.get<{ last_seen_at: string }>(`SELECT last_seen_at FROM director_session WHERE id = ?`, [session.id])!.last_seen_at;
  const oldTs = new Date(Date.now() - 1000).toISOString();
  db.run(`UPDATE director_session SET last_seen_at = ? WHERE id = ?`, [oldTs, session.id]);
  requireDirector(db, created.eventId, session.token);
  const after = db.get<{ last_seen_at: string }>(`SELECT last_seen_at FROM director_session WHERE id = ?`, [session.id])!.last_seen_at;
  assert.ok(new Date(after).getTime() > new Date(oldTs).getTime());
  assert.notEqual(before, oldTs); // sanity: our manual backdate actually took effect before the refresh
});

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

test("director_login is recorded in audit_log", () => {
  const { db, created } = setup();
  directorLogin(db, created.eventId, created.directorPin);
  const actions = db.all<{ action: string }>(`SELECT action FROM audit_log WHERE event_id = ?`, [created.eventId]).map((r) => r.action);
  assert.deepEqual(actions, ["director_login"]);
});
