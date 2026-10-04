import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStorage } from "../../public/js/storage.js";
import { OfflineQueue } from "../../public/js/offlineQueue.js";

/** A fake ApiClient whose submitResult/confirmResult behavior is scripted per test. */
function fakeApi(behavior: (payload: unknown) => { ok: boolean; status: number; data: unknown; networkError?: boolean }) {
  return {
    calls: [] as unknown[],
    submitResult(tableToken: string, payload: unknown) {
      this.calls.push({ kind: "result", tableToken, payload });
      return behavior(payload);
    },
    confirmResult(tableToken: string, payload: unknown) {
      this.calls.push({ kind: "confirm", tableToken, payload });
      return behavior(payload);
    },
  };
}

test("queueResult stores the item even before any flush is attempted", async () => {
  const storage = createMemoryStorage();
  const api = fakeApi(() => ({ ok: true, status: 201, data: {} }));
  const queue = new OfflineQueue(storage, api as any);
  await queue.queueResult("tok1", { clientEventId: "c1", round: 1, board: 1, result: { kind: "passout" } });
  const pending = await queue.pending();
  assert.equal(pending.length, 1);
  assert.equal(api.calls.length, 0, "flush should not happen implicitly on queue");
});

test("flush sends queued items in order and removes them on success", async () => {
  const storage = createMemoryStorage();
  const api = fakeApi(() => ({ ok: true, status: 201, data: {} }));
  const queue = new OfflineQueue(storage, api as any);
  await queue.queueResult("tok1", { clientEventId: "c1", round: 1, board: 1, result: { kind: "passout" } });
  await queue.queueResult("tok1", { clientEventId: "c2", round: 1, board: 2, result: { kind: "passout" } });

  const outcome = await queue.flush();
  assert.deepEqual(outcome, { sent: 2, failed: 0, remaining: 0 });
  assert.equal((await queue.pending()).length, 0);
  assert.deepEqual(
    api.calls.map((c: any) => c.payload.clientEventId),
    ["c1", "c2"],
  );
});

test("flush stops at the first network error, keeping later items queued (no reordering)", async () => {
  const storage = createMemoryStorage();
  let n = 0;
  const api = fakeApi(() => {
    n++;
    if (n === 1) return { ok: true, status: 201, data: {} };
    return { ok: false, status: 0, data: null, networkError: true };
  });
  const queue = new OfflineQueue(storage, api as any);
  await queue.queueResult("tok1", { clientEventId: "c1", round: 1, board: 1, result: { kind: "passout" } });
  await queue.queueResult("tok1", { clientEventId: "c2", round: 1, board: 2, result: { kind: "passout" } });
  await queue.queueResult("tok1", { clientEventId: "c3", round: 1, board: 3, result: { kind: "passout" } });

  const outcome = await queue.flush();
  assert.equal(outcome.sent, 1);
  assert.equal(outcome.remaining, 2);
  const remaining = await queue.pending();
  assert.deepEqual(remaining.map((i: any) => i.payload.payload.clientEventId), ["c2", "c3"]);
});

test("flush drops (does not retry forever) an item the server actively rejects", async () => {
  const storage = createMemoryStorage();
  const api = fakeApi(() => ({ ok: false, status: 400, data: { error: "board must be an integer" } }));
  const queue = new OfflineQueue(storage, api as any);
  const rejections: unknown[] = [];
  const observed = new OfflineQueue(storage, api as any, (ev) => { if (ev.type === "rejected") rejections.push(ev); });
  await observed.queueResult("tok1", { clientEventId: "c1", round: 1, board: 1, result: { kind: "passout" } });

  const outcome = await observed.flush();
  assert.deepEqual(outcome, { sent: 0, failed: 1, remaining: 0 });
  assert.equal(rejections.length, 1);
});

test("a second flush call while one is already in flight is a safe no-op (reentrancy guard)", async () => {
  const storage = createMemoryStorage();
  let inFlight = 0;
  let maxConcurrent = 0;
  const api = fakeApi(() => {
    inFlight++;
    maxConcurrent = Math.max(maxConcurrent, inFlight);
    inFlight--;
    return { ok: true, status: 201, data: {} };
  });
  const queue = new OfflineQueue(storage, api as any);
  await queue.queueResult("tok1", { clientEventId: "c1", round: 1, board: 1, result: { kind: "passout" } });

  const [a, b] = await Promise.all([queue.flush(), queue.flush()]);
  assert.equal(maxConcurrent, 1);
  // Exactly one of the two calls should have actually sent the single queued item.
  assert.equal(a.sent + b.sent, 1);
});

test("queueConfirm round-trips through confirmResult", async () => {
  const storage = createMemoryStorage();
  const api = fakeApi(() => ({ ok: true, status: 200, data: { id: "r1" } }));
  const queue = new OfflineQueue(storage, api as any);
  await queue.queueConfirm("tok1", { clientEventId: "ce1", resultId: "r1" });
  const outcome = await queue.flush();
  assert.equal(outcome.sent, 1);
  assert.equal((api.calls[0] as { kind: string }).kind, "confirm");
});
