// Thin fetch wrapper over packages/api's director-only endpoints. Mirrors
// packages/pwa/public/js/api.js's shape (resolve with {ok,status,data},
// never throw on an ordinary failure like a wrong PIN or a 401) but every
// call here also attaches the director bearer token once logged in.

export class DirectorApiClient {
  constructor(baseUrl = "") {
    this.baseUrl = baseUrl;
    this.token = null;
  }

  setToken(token) {
    this.token = token;
  }

  async #request(method, path, body, { auth = true } = {}) {
    const headers = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (auth && this.token) headers["x-director-token"] = this.token;
    let res;
    try {
      res = await fetch(this.baseUrl + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch (e) {
      return { ok: false, status: 0, data: null, networkError: true, message: e?.message ?? "network error" };
    }
    let data = null;
    try { data = await res.json(); } catch { /* no/invalid body */ }
    return { ok: res.ok, status: res.status, data, networkError: false };
  }

  login(eventId, pin) {
    return this.#request("POST", `/api/events/${eventId}/director-login`, { pin }, { auth: false });
  }

  logout(eventId) {
    return this.#request("POST", `/api/events/${eventId}/director-logout`, {});
  }

  getEvent(eventId) {
    return this.#request("GET", `/api/events/${eventId}`, undefined, { auth: false });
  }

  getOverview(eventId) {
    return this.#request("GET", `/api/events/${eventId}/overview`);
  }

  getStandings(eventId) {
    return this.#request("GET", `/api/events/${eventId}/standings`, undefined, { auth: false });
  }

  advanceRound(eventId, round) {
    return this.#request("POST", `/api/events/${eventId}/round`, { round });
  }

  lockTable(eventId, table) {
    return this.#request("POST", `/api/events/${eventId}/table/${table}/lock`, { table, action: "lock" });
  }

  unlockTable(eventId, table) {
    return this.#request("POST", `/api/events/${eventId}/table/${table}/lock`, { table, action: "unlock" });
  }

  disconnectDevice(eventId, table) {
    return this.#request("POST", `/api/events/${eventId}/table/${table}/disconnect`, {});
  }

  editResult(eventId, resultId, result, ifVersion) {
    return this.#request("PUT", `/api/events/${eventId}/result/${resultId}`, { result, ifVersion });
  }

  overrideResult(eventId, resultId, adjustedNsPct, adjustedEwPct, ifVersion) {
    return this.#request("POST", `/api/events/${eventId}/result/${resultId}/override`, { adjustedNsPct, adjustedEwPct, ifVersion });
  }
}

/** Builds a ws:// / wss:// URL for `eventId` from the page's own origin. */
export function wsUrlForEvent(eventId, location = globalThis.location) {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws/${eventId}`;
}
