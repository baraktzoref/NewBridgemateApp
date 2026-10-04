import { DirectorApiClient, wsUrlForEvent } from "./api.js";
import { clearSession, loadSession, saveSession } from "./session.js";

const SEAT_LABELS = { N: "צפון", E: "מזרח", S: "דרום", W: "מערב" };
const LOCK_LABELS = { none: "פתוח", director_editing: "בעריכה", locked: "נעול" };

export function initApp(doc = document, storage = window.localStorage) {
  const api = new DirectorApiClient("");
  const state = { eventId: null, overview: null, alerts: [], editing: null, overriding: null };
  let ws = null;
  let alertSeq = 0;

  const el = {
    headerInfo: doc.getElementById("header-event-info"),
    eventName: doc.getElementById("event-name"),
    roundInfo: doc.getElementById("round-info"),
    statusBar: doc.getElementById("status-bar"),
    screenLogin: doc.getElementById("screen-login"),
    screenDashboard: doc.getElementById("screen-dashboard"),
    alertsList: doc.getElementById("director-alerts"),
    tableGrid: doc.getElementById("table-grid"),
    editModal: doc.getElementById("edit-modal"),
    overrideModal: doc.getElementById("override-modal"),
  };

  function setStatus(text, isError = false) {
    if (!el.statusBar) return;
    el.statusBar.textContent = text;
    el.statusBar.classList.toggle("status-error", isError);
  }

  function showScreen(name) {
    el.screenLogin.classList.toggle("hidden", name !== "login");
    el.screenDashboard.classList.toggle("hidden", name !== "dashboard");
    el.headerInfo.classList.toggle("hidden", name !== "dashboard");
  }

  async function boot() {
    const session = loadSession(storage);
    if (!session) { showScreen("login"); return; }
    api.setToken(session.token);
    state.eventId = session.eventId;
    const res = await api.getOverview(session.eventId);
    if (!res.ok) {
      clearSession(storage);
      setStatus("ההתחברות הקודמת פגה; יש להתחבר שוב", true);
      showScreen("login");
      return;
    }
    state.overview = res.data;
    connectWs();
    renderDashboard();
    showScreen("dashboard");
  }

  doc.getElementById("login-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const eventId = doc.getElementById("login-event-id").value.trim();
    const pin = doc.getElementById("login-pin").value.trim();
    setStatus("מתחבר...");
    const res = await api.login(eventId, pin);
    if (!res.ok) {
      setStatus(res.data?.error ?? "התחברות נכשלה — בדוק מזהה אירוע ו-PIN", true);
      return;
    }
    api.setToken(res.data.directorToken);
    state.eventId = eventId;
    saveSession(storage, { eventId, token: res.data.directorToken });
    setStatus("");
    const overview = await api.getOverview(eventId);
    if (!overview.ok) { setStatus("התחברות הצליחה אך טעינת הנתונים נכשלה", true); return; }
    state.overview = overview.data;
    connectWs();
    renderDashboard();
    showScreen("dashboard");
  });

  doc.getElementById("logout-btn")?.addEventListener("click", async () => {
    if (state.eventId) await api.logout(state.eventId);
    clearSession(storage);
    try { ws?.close(); } catch { /* ignore */ }
    state.eventId = null;
    state.overview = null;
    state.alerts = [];
    api.setToken(null);
    showScreen("login");
  });

  function connectWs() {
    if (!state.eventId || typeof WebSocket === "undefined") return;
    try { ws?.close(); } catch { /* ignore */ }
    ws = new WebSocket(wsUrlForEvent(state.eventId));
    ws.addEventListener("message", (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }
      if (msg.type === "director_message") {
        state.alerts.unshift({ id: ++alertSeq, table: msg.table, text: msg.text, at: new Date().toLocaleTimeString("he-IL") });
        renderAlerts();
      } else {
        refreshOverview();
      }
    });
    ws.addEventListener("close", () => { setTimeout(() => { if (state.eventId) connectWs(); }, 3000); });
  }

  async function refreshOverview() {
    if (!state.eventId) return;
    const res = await api.getOverview(state.eventId);
    if (!res.ok) { setStatus(res.data?.error ?? "שגיאה בטעינת מצב האירוע", true); return; }
    state.overview = res.data;
    renderDashboard();
  }

  function renderDashboard() {
    const { event } = state.overview;
    el.eventName.textContent = event.name ?? "";
    el.roundInfo.textContent = `סיבוב ${event.current_round} מתוך ${event.rounds}`;
    renderAlerts();
    renderTables();
  }

  function renderAlerts() {
    el.alertsList.innerHTML = "";
    for (const alert of state.alerts) {
      const li = doc.createElement("li");
      li.className = "alert-row";
      const span = doc.createElement("span");
      span.textContent = `[${alert.at}] שולחן ${alert.table}${alert.text ? ": " + alert.text : ""}`;
      li.appendChild(span);
      const dismiss = doc.createElement("button");
      dismiss.type = "button";
      dismiss.textContent = "✕";
      dismiss.addEventListener("click", () => {
        state.alerts = state.alerts.filter((a) => a.id !== alert.id);
        renderAlerts();
      });
      li.appendChild(dismiss);
      el.alertsList.appendChild(li);
    }
  }

  doc.getElementById("advance-round-btn")?.addEventListener("click", async () => {
    const { event } = state.overview;
    const next = event.current_round + 1;
    if (next > event.rounds) { setStatus("זה הסיבוב האחרון"); return; }
    if (!window.confirm(`להעביר לסיבוב ${next}?`)) return;
    const res = await api.advanceRound(state.eventId, next);
    if (!res.ok) { setStatus(res.data?.error ?? "שגיאה בקידום סיבוב", true); return; }
    await refreshOverview();
  });

  function renderTables() {
    el.tableGrid.innerHTML = "";
    for (const t of state.overview.tables) {
      el.tableGrid.appendChild(renderTableCard(t));
    }
  }

  function renderTableCard(t) {
    const card = doc.createElement("div");
    card.className = "table-card" + (t.lockState === "locked" ? " locked" : "");

    const header = doc.createElement("div");
    header.className = "table-card-header";
    const title = doc.createElement("strong");
    title.textContent = `שולחן ${t.table}`;
    header.appendChild(title);
    const lockBadge = doc.createElement("span");
    lockBadge.className = "badge " + (t.lockState === "none" ? "ok" : "warn");
    lockBadge.textContent = LOCK_LABELS[t.lockState] ?? t.lockState;
    header.appendChild(lockBadge);
    card.appendChild(header);

    card.appendChild(row("מכשיר", t.device.connected ? "מחובר" : "לא מחובר", t.device.connected ? "ok" : "bad"));
    card.appendChild(row("צפון-דרום", t.ns.pair == null ? "—" : `זוג ${t.ns.pair}${t.ns.identified ? " ✓" : " (לא מזוהה)"}`, t.ns.pair == null ? null : t.ns.identified ? "ok" : "warn"));
    card.appendChild(row("מזרח-מערב", t.ew.pair == null ? "—" : `זוג ${t.ew.pair}${t.ew.identified ? " ✓" : " (לא מזוהה)"}`, t.ew.pair == null ? null : t.ew.identified ? "ok" : "warn"));
    card.appendChild(row("תוצאות", `${t.resultsConfirmed} אושרו, ${t.resultsEntered} ממתינות, מתוך ${t.boardsScheduled}`, null));

    const actions = doc.createElement("div");
    actions.className = "table-card-actions";

    const lockBtn = doc.createElement("button");
    lockBtn.type = "button";
    lockBtn.textContent = t.lockState === "locked" ? "שחרר נעילה" : "נעל שולחן";
    lockBtn.addEventListener("click", async () => {
      const res = t.lockState === "locked" ? await api.unlockTable(state.eventId, t.table) : await api.lockTable(state.eventId, t.table);
      if (!res.ok) setStatus(res.data?.error ?? "שגיאה", true);
      await refreshOverview();
    });
    actions.appendChild(lockBtn);

    const disconnectBtn = doc.createElement("button");
    disconnectBtn.type = "button";
    disconnectBtn.textContent = "נתק מכשיר";
    disconnectBtn.disabled = !t.device.connected;
    disconnectBtn.addEventListener("click", async () => {
      const res = await api.disconnectDevice(state.eventId, t.table);
      if (!res.ok) setStatus(res.data?.error ?? "שגיאה", true);
      await refreshOverview();
    });
    actions.appendChild(disconnectBtn);

    const detailsBtn = doc.createElement("button");
    detailsBtn.type = "button";
    detailsBtn.textContent = "פרטי בורדים";
    actions.appendChild(detailsBtn);
    card.appendChild(actions);

    const boardList = doc.createElement("ul");
    boardList.className = "board-list hidden";
    for (const board of t.boards) {
      const result = t.results.find((r) => r.board === board);
      boardList.appendChild(renderBoardRow(board, result));
    }
    card.appendChild(boardList);
    detailsBtn.addEventListener("click", () => boardList.classList.toggle("hidden"));

    return card;
  }

  function row(label, value, badgeClass) {
    const div = doc.createElement("div");
    div.className = "table-card-row";
    const l = doc.createElement("span");
    l.textContent = label;
    div.appendChild(l);
    const v = doc.createElement("span");
    if (badgeClass) {
      v.className = "badge " + badgeClass;
      v.textContent = value;
    } else {
      v.textContent = value;
    }
    div.appendChild(v);
    return div;
  }

  function renderBoardRow(board, result) {
    const li = doc.createElement("li");
    li.className = "board-row";
    const label = doc.createElement("span");
    if (!result) {
      label.textContent = `בורד ${board}: לא הוזן`;
      li.appendChild(label);
      return li;
    }
    const desc = result.contractText
      ? `${result.contractText} ע״י ${SEAT_LABELS[result.declarer] ?? result.declarer}, ${result.tricks} לקיחות`
      : "תוצאה מותאמת";
    label.textContent = `בורד ${board}: ${desc} [${result.status}]`;
    li.appendChild(label);

    const editBtn = doc.createElement("button");
    editBtn.type = "button";
    editBtn.textContent = "ערוך";
    editBtn.addEventListener("click", () => openEditModal(result));
    li.appendChild(editBtn);

    const overrideBtn = doc.createElement("button");
    overrideBtn.type = "button";
    overrideBtn.textContent = "התאמה %";
    overrideBtn.addEventListener("click", () => openOverrideModal(result));
    li.appendChild(overrideBtn);

    return li;
  }

  // ---------------------------------------------------------------------------
  // Edit modal
  // ---------------------------------------------------------------------------

  function openEditModal(result) {
    state.editing = { resultId: result.id, version: result.version };
    doc.getElementById("edit-board").textContent = String(result.board);
    const form = doc.getElementById("edit-form");
    form.reset();
    doc.getElementById("edit-error").textContent = "";
    if (result.contractText) {
      form.elements.contractText.value = result.contractText;
      const radio = form.querySelector(`[name=declarer][value="${result.declarer}"]`);
      if (radio) radio.checked = true;
      form.elements.tricks.value = result.tricks ?? "";
    } else {
      form.elements.passout.checked = true;
    }
    el.editModal.classList.remove("hidden");
  }

  doc.getElementById("edit-cancel-btn")?.addEventListener("click", () => el.editModal.classList.add("hidden"));

  doc.getElementById("edit-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const errorEl = doc.getElementById("edit-error");
    let result;
    if (form.elements.passout.checked) {
      result = { kind: "passout" };
    } else {
      const contractText = form.elements.contractText.value.trim().toUpperCase();
      const declarer = form.elements.declarer.value;
      const tricks = Number(form.elements.tricks.value);
      if (!contractText || !declarer || !Number.isInteger(tricks)) {
        errorEl.textContent = "יש למלא חוזה, מכריז ולקיחות (או לסמן Pass Out)";
        return;
      }
      result = { kind: "played", contractText, declarer, tricks };
    }
    const { resultId, version } = state.editing;
    const res = await api.editResult(state.eventId, resultId, result, version);
    if (!res.ok) { errorEl.textContent = res.data?.error ?? "שגיאה בעריכת התוצאה"; return; }
    el.editModal.classList.add("hidden");
    await refreshOverview();
  });

  // ---------------------------------------------------------------------------
  // Override modal
  // ---------------------------------------------------------------------------

  function openOverrideModal(result) {
    state.overriding = { resultId: result.id, version: result.version };
    doc.getElementById("override-board").textContent = String(result.board);
    const form = doc.getElementById("override-form");
    form.reset();
    doc.getElementById("override-error").textContent = "";
    el.overrideModal.classList.remove("hidden");
  }

  doc.getElementById("override-cancel-btn")?.addEventListener("click", () => el.overrideModal.classList.add("hidden"));

  doc.getElementById("override-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const errorEl = doc.getElementById("override-error");
    const nsPct = Number(form.elements.adjustedNsPct.value);
    const ewPct = Number(form.elements.adjustedEwPct.value);
    if (!Number.isInteger(nsPct) || !Number.isInteger(ewPct) || nsPct < 0 || nsPct > 100 || ewPct < 0 || ewPct > 100) {
      errorEl.textContent = "אחוזים חייבים להיות שלמים בין 0 ל-100";
      return;
    }
    const { resultId, version } = state.overriding;
    const res = await api.overrideResult(state.eventId, resultId, nsPct, ewPct, version);
    if (!res.ok) { errorEl.textContent = res.data?.error ?? "שגיאה בקביעת תוצאה מותאמת"; return; }
    el.overrideModal.classList.add("hidden");
    await refreshOverview();
  });

  boot();

  return { api, state };
}

if (typeof document !== "undefined" && document.getElementById("app-root")) {
  initApp(document, window.localStorage);
}
