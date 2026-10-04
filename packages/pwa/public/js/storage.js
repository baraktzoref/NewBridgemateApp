// Pluggable key-value + list storage used by the offline queue and app state.
// Two implementations below; both satisfy the same small interface:
//   get(key) -> Promise<any|undefined>
//   set(key, value) -> Promise<void>
//   remove(key) -> Promise<void>
//   listQueue() -> Promise<Array<{id, payload}>>
//   enqueue(payload) -> Promise<string>  (returns generated id)
//   dequeue(id) -> Promise<void>
//
// app.js uses createIndexedDbStorage() in the browser. Tests inject
// createMemoryStorage() so offlineQueue.js is testable under plain Node with
// no DOM/IndexedDB available.

export function createMemoryStorage() {
  const kv = new Map();
  const queue = [];
  let seq = 0;
  return {
    async get(key) { return kv.get(key); },
    async set(key, value) { kv.set(key, value); },
    async remove(key) { kv.delete(key); },
    async listQueue() { return queue.map((item) => ({ ...item })); },
    async enqueue(payload) {
      const id = `mem-${++seq}`;
      queue.push({ id, payload });
      return id;
    },
    async dequeue(id) {
      const i = queue.findIndex((item) => item.id === id);
      if (i !== -1) queue.splice(i, 1);
    },
  };
}

const DB_NAME = "bridgemate-pwa";
const DB_VERSION = 1;
const KV_STORE = "kv";
const QUEUE_STORE = "queue";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE);
      if (!db.objectStoreNames.contains(QUEUE_STORE)) db.createObjectStore(QUEUE_STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, storeName, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    const request = fn(store);
    t.oncomplete = () => resolve(request ? request.result : undefined);
    t.onerror = () => reject(t.error);
  });
}

/** Real browser storage, backed by IndexedDB. Falls back to in-memory if IndexedDB is unavailable (e.g. private mode). */
export function createIndexedDbStorage() {
  if (typeof indexedDB === "undefined") return createMemoryStorage();
  const dbPromise = openDb();
  let seq = 0;
  return {
    async get(key) {
      const db = await dbPromise;
      return tx(db, KV_STORE, "readonly", (s) => s.get(key));
    },
    async set(key, value) {
      const db = await dbPromise;
      await tx(db, KV_STORE, "readwrite", (s) => s.put(value, key));
    },
    async remove(key) {
      const db = await dbPromise;
      await tx(db, KV_STORE, "readwrite", (s) => s.delete(key));
    },
    async listQueue() {
      const db = await dbPromise;
      const all = await tx(db, QUEUE_STORE, "readonly", (s) => s.getAll());
      return (all ?? []).sort((a, b) => a.seq - b.seq);
    },
    async enqueue(payload) {
      const db = await dbPromise;
      const id = `q-${Date.now()}-${++seq}`;
      await tx(db, QUEUE_STORE, "readwrite", (s) => s.put({ id, payload, seq }));
      return id;
    },
    async dequeue(id) {
      const db = await dbPromise;
      await tx(db, QUEUE_STORE, "readwrite", (s) => s.delete(id));
    },
  };
}
