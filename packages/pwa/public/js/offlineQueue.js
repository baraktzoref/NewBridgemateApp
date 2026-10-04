// Offline-first result queue (design doc: "the table must be able to keep
// scoring a round even if the club wifi drops"). Submissions are always
// written to the queue first (so nothing is lost if the tab is killed before
// the network call completes), then flushed opportunistically. Each queued
// item carries the same clientEventId every retry, so a flush that partially
// reached the server before a drop is a no-op resubmission, not a duplicate
// (the server's UNIQUE(event_id, client_event_id) constraint is the backstop).
//
// Pure logic, no DOM/IndexedDB dependency — storage and apiClient are both
// injected, so this is directly unit-testable under plain Node (see
// test/offlineQueue.test.ts) with a fake storage and a fake apiClient.

/**
 * @typedef {{ kind: "result", tableToken: string, payload: object }
 *         | { kind: "confirm", tableToken: string, payload: object }} QueueItem
 */

export class OfflineQueue {
  /**
   * @param {{listQueue():Promise<any[]>, enqueue(payload:any):Promise<string>, dequeue(id:string):Promise<void>}} storage
   * @param {import("./api.js").ApiClient} apiClient
   * @param {(event: {type: string, item: any, error?: any}) => void} [onEvent] optional observer for UI feedback
   */
  constructor(storage, apiClient, onEvent) {
    this.storage = storage;
    this.apiClient = apiClient;
    this.onEvent = onEvent ?? (() => {});
    this.flushing = false;
  }

  /** Queues a result submission. Returns immediately; never throws for "offline". */
  async queueResult(tableToken, payload) {
    const id = await this.storage.enqueue({ kind: "result", tableToken, payload });
    this.onEvent({ type: "queued", item: { id, kind: "result", tableToken, payload } });
    return id;
  }

  async queueConfirm(tableToken, payload) {
    const id = await this.storage.enqueue({ kind: "confirm", tableToken, payload });
    this.onEvent({ type: "queued", item: { id, kind: "confirm", tableToken, payload } });
    return id;
  }

  async pending() {
    return this.storage.listQueue();
  }

  /**
   * Attempts to send every queued item, in order. Stops at the first item
   * that fails because of a network error (so order is preserved and we
   * don't skip ahead while offline); an item the server actively rejects
   * (4xx — a genuine validation problem, not "offline") is dropped from the
   * queue after reporting it, since retrying it unmodified would only fail
   * the same way forever.
   * Returns { sent, failed, remaining }.
   */
  async flush() {
    if (this.flushing) return { sent: 0, failed: 0, remaining: (await this.pending()).length };
    this.flushing = true;
    let sent = 0;
    let failed = 0;
    try {
      const items = await this.pending();
      for (const entry of items) {
        const res = await this.#send(entry.payload);
        if (res.ok) {
          await this.storage.dequeue(entry.id);
          sent++;
          this.onEvent({ type: "sent", item: entry, response: res });
        } else if (res.networkError) {
          // Still offline (or server unreachable) — stop here, keep the rest queued.
          break;
        } else {
          // Server responded but rejected it (validation, already-confirmed, etc).
          await this.storage.dequeue(entry.id);
          failed++;
          this.onEvent({ type: "rejected", item: entry, response: res });
        }
      }
    } finally {
      this.flushing = false;
    }
    const remaining = (await this.pending()).length;
    return { sent, failed, remaining };
  }

  async #send(item) {
    if (item.kind === "result") return this.apiClient.submitResult(item.tableToken, item.payload);
    return this.apiClient.confirmResult(item.tableToken, item.payload);
  }
}
