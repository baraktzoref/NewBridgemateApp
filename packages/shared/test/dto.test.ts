import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseConnectRequest, parseTakeoverRequest, parsePairIdentificationRequest, parseResultSubmission,
  parseConfirmResultRequest, parseCallDirectorRequest, parseDirectorLoginRequest,
  parseDirectorEditResultRequest, parseDirectorOverrideRequest, parseTableLockRequest, parseDisconnectDeviceRequest,
} from "../src/dto.ts";
import { isWsEvent, WS_EVENT_TYPES } from "../src/ws-events.ts";
import type { Result } from "../src/validation.ts";

function assertAccepts<T>(r: Result<T>): asserts r is { ok: true; value: T } {
  assert.equal(r.ok, true, r.ok ? "" : `unexpected rejection: ${r.errors.join("; ")}`);
}
function assertRejects<T>(r: Result<T>): void {
  assert.equal(r.ok, false, "expected rejection but input was accepted");
}

/** For every key in a valid object, try each broken replacement and assert rejection. */
function eachBrokenField<T extends Record<string, unknown>>(
  valid: T,
  parse: (x: unknown) => Result<unknown>,
  breaks: Partial<Record<keyof T, unknown[]>>,
): void {
  for (const [key, values] of Object.entries(breaks)) {
    for (const bad of values as unknown[]) {
      const broken = { ...valid, [key]: bad };
      const r = parse(broken);
      assert.equal(r.ok, false, `expected "${key}"=${JSON.stringify(bad)} to be rejected`);
    }
  }
}

// ---------------------------------------------------------------------------
test("parseConnectRequest: valid input accepted", () => {
  const r = parseConnectRequest({ tableToken: "tok-123", eventCode: "4821", deviceLabel: "iPhone NS" });
  assertAccepts(r);
  assert.equal(r.value.tableToken, "tok-123");
});

test("parseConnectRequest: deviceLabel is optional", () => {
  assertAccepts(parseConnectRequest({ tableToken: "tok-123", eventCode: "4821" }));
});

test("parseConnectRequest: rejects malformed input", () => {
  assertRejects(parseConnectRequest(null));
  assertRejects(parseConnectRequest("tok-123"));
  eachBrokenField(
    { tableToken: "tok-123", eventCode: "4821" },
    parseConnectRequest,
    { tableToken: [undefined, "", 42, null], eventCode: [undefined, "", 123] },
  );
});

test("parseTakeoverRequest: extends connect, reason optional", () => {
  assertAccepts(parseTakeoverRequest({ tableToken: "t", eventCode: "1234", reason: "battery died" }));
  assertAccepts(parseTakeoverRequest({ tableToken: "t", eventCode: "1234" }));
  assertRejects(parseTakeoverRequest({ tableToken: "t", eventCode: "1234", reason: "" }));
  assertRejects(parseTakeoverRequest({ eventCode: "1234" }));
});

// ---------------------------------------------------------------------------
test("parsePairIdentificationRequest: member and guest identities accepted", () => {
  const r1 = parsePairIdentificationRequest({
    clientEventId: "c1", side: "NS",
    player1: { kind: "member", memberId: "1234" },
    player2: { kind: "guest", name: "Guest Player" },
  });
  assertAccepts(r1);
  assert.equal(r1.value.player1.kind, "member");
  assert.equal(r1.value.player2.kind, "guest");
});

test("parsePairIdentificationRequest: rejects bad side and malformed players", () => {
  const valid = { clientEventId: "c1", side: "NS", player1: { kind: "member", memberId: "1" }, player2: { kind: "member", memberId: "2" } };
  eachBrokenField(valid, parsePairIdentificationRequest, {
    side: ["north", "", 1, undefined],
    clientEventId: [undefined, ""],
  });
  assertRejects(parsePairIdentificationRequest({ ...valid, player1: { kind: "member" } }));
  assertRejects(parsePairIdentificationRequest({ ...valid, player1: { kind: "guest" } }));
  assertRejects(parsePairIdentificationRequest({ ...valid, player1: { kind: "alien", memberId: "1" } }));
  assertRejects(parsePairIdentificationRequest({ ...valid, player2: "not an object" }));
});

// ---------------------------------------------------------------------------
test("parseResultSubmission: played result accepted, contract normalized to uppercase", () => {
  const r = parseResultSubmission({
    clientEventId: "c1", round: 2, table: 5, board: 7,
    result: { kind: "played", contractText: "4sx", declarer: "N", tricks: 10 },
  });
  assertAccepts(r);
  assert.equal(r.value.result.kind, "played");
  if (r.value.result.kind === "played") assert.equal(r.value.result.contractText, "4SX");
});

test("parseResultSubmission: pass-out accepted", () => {
  assertAccepts(parseResultSubmission({ clientEventId: "c1", round: 1, table: 1, board: 1, result: { kind: "passout" } }));
});

test("parseResultSubmission: rejects bad round/table/board and bad contract shape", () => {
  const valid = { clientEventId: "c1", round: 1, table: 1, board: 1, result: { kind: "played", contractText: "4S", declarer: "N", tricks: 10 } };
  eachBrokenField(valid, parseResultSubmission, {
    round: [0, -1, 1.5, "1", undefined],
    table: [0, -1, undefined],
    board: [0, -1, undefined],
  });
  assertRejects(parseResultSubmission({ ...valid, result: { kind: "played", contractText: "8S", declarer: "N", tricks: 10 } }));
  assertRejects(parseResultSubmission({ ...valid, result: { kind: "played", contractText: "4S", declarer: "X", tricks: 10 } }));
  assertRejects(parseResultSubmission({ ...valid, result: { kind: "played", contractText: "4S", declarer: "N", tricks: 14 } }));
  assertRejects(parseResultSubmission({ ...valid, result: { kind: "played", contractText: "4S", declarer: "N", tricks: -1 } }));
  assertRejects(parseResultSubmission({ ...valid, result: { kind: "unknown" } }));
  assertRejects(parseResultSubmission({ ...valid, result: null }));
});

test("parseResultSubmission: contract with letter N is accepted as NT", () => {
  const r = parseResultSubmission({ clientEventId: "c1", round: 1, table: 1, board: 1, result: { kind: "played", contractText: "3n", declarer: "S", tricks: 9 } });
  assertAccepts(r);
});

// ---------------------------------------------------------------------------
test("parseConfirmResultRequest: opponentCode optional", () => {
  assertAccepts(parseConfirmResultRequest({ clientEventId: "c1", resultId: "r1" }));
  assertAccepts(parseConfirmResultRequest({ clientEventId: "c1", resultId: "r1", opponentCode: "7" }));
  eachBrokenField({ clientEventId: "c1", resultId: "r1" }, parseConfirmResultRequest, {
    resultId: [undefined, "", 5], clientEventId: [undefined, ""],
  });
});

test("parseCallDirectorRequest: message optional", () => {
  assertAccepts(parseCallDirectorRequest({ clientEventId: "c1" }));
  assertAccepts(parseCallDirectorRequest({ clientEventId: "c1", message: "need help with a revoke" }));
  assertRejects(parseCallDirectorRequest({ clientEventId: "c1", message: "" }));
});

// ---------------------------------------------------------------------------
test("parseDirectorLoginRequest", () => {
  assertAccepts(parseDirectorLoginRequest({ pin: "1234" }));
  assertRejects(parseDirectorLoginRequest({ pin: "" }));
  assertRejects(parseDirectorLoginRequest({}));
  assertRejects(parseDirectorLoginRequest("1234"));
});

test("parseDirectorEditResultRequest: ifVersion and reason optional, contract validated", () => {
  assertAccepts(parseDirectorEditResultRequest({ resultId: "r1", result: { kind: "passout" } }));
  assertAccepts(parseDirectorEditResultRequest({
    resultId: "r1", ifVersion: 3, reason: "corrected declarer",
    result: { kind: "played", contractText: "6NTXX", declarer: "E", tricks: 12 },
  }));
  assertRejects(parseDirectorEditResultRequest({ resultId: "r1", ifVersion: 0, result: { kind: "passout" } }));
  assertRejects(parseDirectorEditResultRequest({ resultId: "r1", result: { kind: "played", contractText: "9S", declarer: "N", tricks: 9 } }));
});

test("parseDirectorOverrideRequest: percentages bounded 0..100", () => {
  assertAccepts(parseDirectorOverrideRequest({ resultId: "r1", adjustedNsPct: 60, adjustedEwPct: 40 }));
  assertRejects(parseDirectorOverrideRequest({ resultId: "r1", adjustedNsPct: 101, adjustedEwPct: 40 }));
  assertRejects(parseDirectorOverrideRequest({ resultId: "r1", adjustedNsPct: -1, adjustedEwPct: 40 }));
  assertRejects(parseDirectorOverrideRequest({ resultId: "r1", adjustedNsPct: 60.5, adjustedEwPct: 40 }));
});

test("parseTableLockRequest: action must be lock or unlock", () => {
  assertAccepts(parseTableLockRequest({ table: 3, action: "lock" }));
  assertAccepts(parseTableLockRequest({ table: 3, action: "unlock" }));
  assertRejects(parseTableLockRequest({ table: 3, action: "freeze" }));
  assertRejects(parseTableLockRequest({ table: 0, action: "lock" }));
});

test("parseDisconnectDeviceRequest", () => {
  assertAccepts(parseDisconnectDeviceRequest({ table: 4 }));
  assertRejects(parseDisconnectDeviceRequest({ table: -1 }));
  assertRejects(parseDisconnectDeviceRequest({}));
});

// ---------------------------------------------------------------------------
test("isWsEvent: recognizes every declared event type and rejects unknown ones", () => {
  for (const type of WS_EVENT_TYPES) assert.equal(isWsEvent({ type }), true, type);
  assert.equal(isWsEvent({ type: "not_a_real_event" }), false);
  assert.equal(isWsEvent(null), false);
  assert.equal(isWsEvent("round_started"), false);
  assert.equal(isWsEvent({}), false);
});

// ---------------------------------------------------------------------------
// Fuzz: parsers must never throw on arbitrary JSON-shaped garbage.
test("fuzz: parsers never throw on random garbage input", () => {
  let seed = 42;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const garbageValue = (): unknown => {
    const kinds = [
      () => undefined, () => null, () => rnd(), () => (rnd() > 0.5),
      () => Math.random().toString(36).slice(2), () => [], () => ({}),
      () => ({ kind: "played" }), () => ({ foo: "bar", nested: { a: 1 } }),
    ];
    return kinds[Math.floor(rnd() * kinds.length)]!();
  };
  const parsers = [
    parseConnectRequest, parseTakeoverRequest, parsePairIdentificationRequest, parseResultSubmission,
    parseConfirmResultRequest, parseCallDirectorRequest, parseDirectorLoginRequest,
    parseDirectorEditResultRequest, parseDirectorOverrideRequest, parseTableLockRequest, parseDisconnectDeviceRequest,
  ];
  for (let i = 0; i < 500; i++)
    for (const p of parsers) assert.doesNotThrow(() => p(garbageValue()));
});
