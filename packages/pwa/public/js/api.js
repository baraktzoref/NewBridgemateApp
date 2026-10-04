// Thin fetch wrapper over packages/api's table-phone HTTP endpoints. Every
// method resolves with { ok, status, data } instead of throwing, since a
// failed submit is an ordinary, expected outcome here (offline, 423 locked,
// 409 conflict) that callers need to branch on, not a bug.

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export class ApiClient {
  /** @param {string} baseUrl e.g. "" for same-origin, or "http://host:8080" */
  constructor(baseUrl = "") {
    this.baseUrl = baseUrl;
  }

  async #request(method, path, body) {
    let res;
    try {
      res = await fetch(this.baseUrl + path, {
        method,
        headers: body !== undefined ? { "content-type": "application/json" } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      return { ok: false, status: 0, data: null, networkError: true, message: e?.message ?? "network error" };
    }
    let data = null;
    try { data = await res.json(); } catch { /* no/invalid body */ }
    return { ok: res.ok, status: res.status, data, networkError: false };
  }

  connect(tableToken, eventCode, deviceLabel) {
    return this.#request("POST", `/api/t/${tableToken}/connect`, { tableToken, eventCode, deviceLabel });
  }

  takeover(tableToken, eventCode, reason) {
    return this.#request("POST", `/api/t/${tableToken}/takeover`, { tableToken, eventCode, reason });
  }

  getState(tableToken) {
    return this.#request("GET", `/api/t/${tableToken}/state`);
  }

  heartbeat(tableToken, deviceToken) {
    return this.#request("POST", `/api/t/${tableToken}/heartbeat`, { deviceToken });
  }

  identify(tableToken, { clientEventId, side, player1, player2 }) {
    return this.#request("POST", `/api/t/${tableToken}/identify`, { clientEventId, side, player1, player2 });
  }

  submitResult(tableToken, { clientEventId, round, board, result }) {
    return this.#request("POST", `/api/t/${tableToken}/result`, { clientEventId, round, board, result });
  }

  confirmResult(tableToken, { clientEventId, resultId, opponentCode }) {
    return this.#request("POST", `/api/t/${tableToken}/confirm`, { clientEventId, resultId, opponentCode });
  }

  callDirector(tableToken, { clientEventId, message }) {
    return this.#request("POST", `/api/t/${tableToken}/call-director`, { clientEventId, message });
  }
}

/** Builds a ws:// / wss:// URL for `eventId` from the page's own origin. */
export function wsUrlForEvent(eventId, location = globalThis.location) {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws/${eventId}`;
}
