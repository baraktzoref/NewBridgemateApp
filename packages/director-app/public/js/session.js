// Persists the director's logged-in session (eventId + bearer token) so a
// page refresh doesn't force a re-login. Deliberately plain localStorage,
// not IndexedDB like the table pwa's offline queue — there's no offline
// writing to protect here, just "stay logged in on this browser/tablet".
// `storage` is injected (defaults to window.localStorage) so this is
// directly unit-testable under plain Node with a fake in-memory storage.

const KEY = "bridgemate-director-session";

export function saveSession(storage, session) {
  storage.setItem(KEY, JSON.stringify(session));
}

export function loadSession(storage) {
  const raw = storage.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.eventId === "string" && typeof parsed.token === "string") return parsed;
  } catch { /* corrupt value, treat as no session */ }
  return null;
}

export function clearSession(storage) {
  storage.removeItem(KEY);
}

/** A minimal localStorage-shaped in-memory store, for tests. */
export function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}
