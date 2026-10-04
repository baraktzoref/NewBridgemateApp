import { test } from "node:test";
import assert from "node:assert/strict";
import { clearSession, createMemoryStorage, loadSession, saveSession } from "../../public/js/session.js";

test("loadSession returns null when nothing was saved", () => {
  const storage = createMemoryStorage();
  assert.equal(loadSession(storage), null);
});

test("saveSession then loadSession round-trips eventId and token", () => {
  const storage = createMemoryStorage();
  saveSession(storage, { eventId: "ev1", token: "tok1" });
  assert.deepEqual(loadSession(storage), { eventId: "ev1", token: "tok1" });
});

test("clearSession removes a previously saved session", () => {
  const storage = createMemoryStorage();
  saveSession(storage, { eventId: "ev1", token: "tok1" });
  clearSession(storage);
  assert.equal(loadSession(storage), null);
});

test("loadSession treats corrupt JSON as no session rather than throwing", () => {
  const storage = createMemoryStorage();
  storage.setItem("bridgemate-director-session", "{not json");
  assert.equal(loadSession(storage), null);
});

test("loadSession rejects a value missing eventId or token", () => {
  const storage = createMemoryStorage();
  storage.setItem("bridgemate-director-session", JSON.stringify({ eventId: "ev1" }));
  assert.equal(loadSession(storage), null);
  storage.setItem("bridgemate-director-session", JSON.stringify({ token: "tok1" }));
  assert.equal(loadSession(storage), null);
});

test("saveSession overwrites a previous session rather than merging it", () => {
  const storage = createMemoryStorage();
  saveSession(storage, { eventId: "ev1", token: "tok1" });
  saveSession(storage, { eventId: "ev2", token: "tok2" });
  assert.deepEqual(loadSession(storage), { eventId: "ev2", token: "tok2" });
});
