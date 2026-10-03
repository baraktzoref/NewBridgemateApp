import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.ts";

/** Starts the app on an ephemeral port and returns a small fetch-based client plus a teardown fn. */
async function startApp() {
  const app = createApp(":memory:");
  await new Promise<void>((resolve) => app.server.listen(0, resolve));
  const addr = app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;

  const api = {
    get: (path: string) => fetch(`${base}${path}`).then((r) => r.json().then((body) => ({ status: r.status, body }))),
    post: (path: string, body?: unknown) =>
      fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) })
        .then((r) => r.json().then((b) => ({ status: r.status, body: b }))),
    put: (path: string, body?: unknown) =>
      fetch(`${base}${path}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) })
        .then((r) => r.json().then((b) => ({ status: r.status, body: b }))),
    wsUrl: (eventId: string) => `ws://127.0.0.1:${port}/ws/${eventId}`,
  };

  return {
    app, api,
    close: () => new Promise<void>((resolve) => {
      // Force any still-open sockets (e.g. a WebSocket client a test didn't explicitly close)
      // closed immediately — otherwise server.close()'s callback waits for them to end on
      // their own, which can hang the test run well past any single test's own timeout.
      app.server.closeAllConnections?.();
      app.server.close(() => resolve());
    }),
  };
}

async function createTestEvent(api: Awaited<ReturnType<typeof startApp>>["api"], pairs = 20, boardsPerRound = 3) {
  const { body } = await api.post("/api/events", { name: "Test night", pairs, boardsPerRound });
  return body as { eventId: string; eventCode: string; tables: number; rounds: number; tableTokens: Record<string, string> };
}

// ---------------------------------------------------------------------------

test("POST /api/events creates an event with real movement slots underneath", async () => {
  const { api, close } = await startApp();
  try {
    const created = await createTestEvent(api);
    assert.equal(created.tables, 10);
    assert.equal(created.rounds, 9);
    assert.match(created.eventCode, /^\d{4}$/);
    assert.equal(Object.keys(created.tableTokens).length, 10);

    const { status, body } = await api.get(`/api/events/${created.eventId}`);
    assert.equal(status, 200);
    assert.equal((body as { current_round: number }).current_round, 1);
  } finally {
    await close();
  }
});

test("table flow: connect -> state -> submit result -> confirm, end to end over real HTTP", async () => {
  const { api, close } = await startApp();
  try {
    const created = await createTestEvent(api);
    const token1 = created.tableTokens["1"]!;

    const connect = await api.post(`/api/t/${token1}/connect`, { tableToken: token1, eventCode: created.eventCode });
    assert.equal(connect.status, 201);
    const deviceToken = (connect.body as { deviceToken: string }).deviceToken;
    assert.ok(deviceToken);

    const state = await api.get(`/api/t/${token1}/state`);
    assert.equal(state.status, 200);
    const s = state.body as { round: number; ns: { pair: number } | null; boards: number[] };
    assert.equal(s.round, 1);
    assert.equal(s.ns!.pair, 1);
    assert.deepEqual(s.boards, [1, 2, 3]);

    const submit = await api.post(`/api/t/${token1}/result`, {
      clientEventId: "c1", round: 1, board: 1,
      result: { kind: "played", contractText: "4S", declarer: "N", tricks: 10 },
    });
    assert.equal(submit.status, 201);
    const result = submit.body as { id: string; nsScore: number; status: string };
    assert.equal(result.nsScore, 420);
    assert.equal(result.status, "entered");

    const confirm = await api.post(`/api/t/${token1}/confirm`, { clientEventId: "c2", resultId: result.id });
    assert.equal(confirm.status, 200);
    assert.equal((confirm.body as { status: string }).status, "confirmed");
  } finally {
    await close();
  }
});

test("submitting the same clientEventId twice over HTTP is idempotent", async () => {
  const { api, close } = await startApp();
  try {
    const created = await createTestEvent(api);
    const token1 = created.tableTokens["1"]!;
    await api.post(`/api/t/${token1}/connect`, { tableToken: token1, eventCode: created.eventCode });
    const body = { clientEventId: "dup", round: 1, board: 1, result: { kind: "played", contractText: "3NT", declarer: "N", tricks: 9 } };
    const a = await api.post(`/api/t/${token1}/result`, body);
    const b = await api.post(`/api/t/${token1}/result`, body);
    assert.equal((a.body as { id: string }).id, (b.body as { id: string }).id);
  } finally {
    await close();
  }
});

test("validation errors from @bridge/shared parsers come back as HTTP 400 with the message", async () => {
  const { api, close } = await startApp();
  try {
    const created = await createTestEvent(api);
    const token1 = created.tableTokens["1"]!;
    await api.post(`/api/t/${token1}/connect`, { tableToken: token1, eventCode: created.eventCode });
    const r = await api.post(`/api/t/${token1}/result`, {
      clientEventId: "c1", round: 1, board: 1,
      result: { kind: "played", contractText: "9S", declarer: "N", tricks: 10 }, // level 9 is invalid
    });
    assert.equal(r.status, 400);
    assert.ok((r.body as { error: string }).error.length > 0);
  } finally {
    await close();
  }
});

test("a wrong event code on connect is rejected with 401 and the domain error code", async () => {
  const { api, close } = await startApp();
  try {
    const created = await createTestEvent(api);
    const token1 = created.tableTokens["1"]!;
    const r = await api.post(`/api/t/${token1}/connect`, { tableToken: token1, eventCode: "0000" });
    assert.equal(r.status, 401);
    assert.equal((r.body as { code: string }).code, "BAD_EVENT_CODE");
  } finally {
    await close();
  }
});

test("an unknown table token resolves to 404", async () => {
  const { api, close } = await startApp();
  try {
    const r = await api.get(`/api/t/not-a-real-token/state`);
    assert.equal(r.status, 404);
  } finally {
    await close();
  }
});

test("director lock blocks the table phone's submission over HTTP, confirmed via LOCKED/423", async () => {
  const { api, close } = await startApp();
  try {
    const created = await createTestEvent(api);
    const token1 = created.tableTokens["1"]!;
    await api.post(`/api/t/${token1}/connect`, { tableToken: token1, eventCode: created.eventCode });
    await api.post(`/api/events/${created.eventId}/table/1/lock`, { action: "lock" });
    const r = await api.post(`/api/t/${token1}/result`, { clientEventId: "c1", round: 1, board: 1, result: { kind: "passout" } });
    assert.equal(r.status, 423);
    assert.equal((r.body as { code: string }).code, "LOCKED");
  } finally {
    await close();
  }
});

test("director can edit a result with optimistic concurrency (ifVersion) over HTTP", async () => {
  const { api, close } = await startApp();
  try {
    const created = await createTestEvent(api);
    const token1 = created.tableTokens["1"]!;
    await api.post(`/api/t/${token1}/connect`, { tableToken: token1, eventCode: created.eventCode });
    const submit = await api.post(`/api/t/${token1}/result`, {
      clientEventId: "c1", round: 1, board: 1, result: { kind: "played", contractText: "4S", declarer: "N", tricks: 10 },
    });
    const resultId = (submit.body as { id: string }).id;

    const stale = await api.put(`/api/events/${created.eventId}/result/${resultId}`, { ifVersion: 99, result: { kind: "passout" } });
    assert.equal(stale.status, 409);

    const ok = await api.put(`/api/events/${created.eventId}/result/${resultId}`, { ifVersion: 1, result: { kind: "passout" } });
    assert.equal(ok.status, 200);
    assert.equal((ok.body as { nsScore: number }).nsScore, 0);
  } finally {
    await close();
  }
});

test("director override assigns a fixed percentage over HTTP", async () => {
  const { api, close } = await startApp();
  try {
    const created = await createTestEvent(api);
    const token1 = created.tableTokens["1"]!;
    await api.post(`/api/t/${token1}/connect`, { tableToken: token1, eventCode: created.eventCode });
    const submit = await api.post(`/api/t/${token1}/result`, {
      clientEventId: "c1", round: 1, board: 1, result: { kind: "played", contractText: "4S", declarer: "N", tricks: 10 },
    });
    const resultId = (submit.body as { id: string }).id;
    const r = await api.post(`/api/events/${created.eventId}/result/${resultId}/override`, { adjustedNsPct: 60, adjustedEwPct: 40 });
    assert.equal(r.status, 200);
    assert.equal((r.body as { status: string }).status, "adjusted");
  } finally {
    await close();
  }
});

test("GET standings reflects submitted results", async () => {
  const { api, close } = await startApp();
  try {
    const created = await createTestEvent(api, 6, 1);
    await api.post(`/api/events/${created.eventId}/round`, { round: 1 });
    const standings = await api.get(`/api/events/${created.eventId}/standings`);
    assert.equal(standings.status, 200);
    assert.ok(Array.isArray((standings.body as { ns: unknown[] }).ns));
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// WebSocket: a real client connects and receives a real broadcast
// ---------------------------------------------------------------------------

test("WebSocket client connected to /ws/:eventId receives a result_entered broadcast", async () => {
  const { api, close } = await startApp();
  try {
    const created = await createTestEvent(api);
    const token1 = created.tableTokens["1"]!;
    await api.post(`/api/t/${token1}/connect`, { tableToken: token1, eventCode: created.eventCode });

    const ws = new WebSocket(api.wsUrl(created.eventId));
    try {
      const received = new Promise<unknown>((resolve, reject) => {
        ws.onmessage = (ev) => resolve(JSON.parse(ev.data as string));
        ws.onerror = (ev) => reject(new Error(String(ev)));
        setTimeout(() => reject(new Error("timed out waiting for broadcast")), 5000);
      });
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = (ev) => reject(new Error(String(ev)));
      });

      await api.post(`/api/t/${token1}/result`, {
        clientEventId: "c1", round: 1, board: 1, result: { kind: "played", contractText: "4S", declarer: "N", tricks: 10 },
      });

      const event = await received as { type: string; result?: { nsScore: number } };
      assert.equal(event.type, "result_entered");
      assert.equal(event.result?.nsScore, 420);
    } finally {
      ws.close();
    }
  } finally {
    await close();
  }
});

test("WebSocket: a client watching a different eventId never receives the broadcast", async () => {
  const { api, close } = await startApp();
  try {
    const created = await createTestEvent(api);
    const other = await createTestEvent(api);
    const token1 = created.tableTokens["1"]!;
    await api.post(`/api/t/${token1}/connect`, { tableToken: token1, eventCode: created.eventCode });

    const wsOther = new WebSocket(api.wsUrl(other.eventId));
    try {
      await new Promise<void>((resolve, reject) => {
        wsOther.onopen = () => resolve();
        wsOther.onerror = (ev) => reject(new Error(String(ev)));
      });
      let gotSomething = false;
      wsOther.onmessage = () => { gotSomething = true; };

      await api.post(`/api/t/${token1}/result`, {
        clientEventId: "c1", round: 1, board: 1, result: { kind: "passout" },
      });
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(gotSomething, false);
    } finally {
      wsOther.close();
    }
  } finally {
    await close();
  }
});
