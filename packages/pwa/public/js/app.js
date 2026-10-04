import { ApiClient, wsUrlForEvent } from "./api.js";
import { createIndexedDbStorage } from "./storage.js";
import { OfflineQueue } from "./offlineQueue.js";
import { isValidContractText, normalizeContractText, SEATS } from "./contract.js";

const SEAT_LABELS = { N: "צפון", E: "מזרח", S: "דרום", W: "מערב" };

function tableTokenFromUrl() {
  const path = location.pathname.match(/\/t\/([^/]+)/);
  if (path) return decodeURIComponent(path[1]);
  return new URL(location.href).searchParams.get("t");
}

function newClientEventId() {
  return (crypto.randomUUID ? crypto.randomUUID() : `ce-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

export function initApp(doc = document) {
  const tableToken = tableTokenFromUrl();
  const screens = {
    missingToken: doc.getElementById("screen-missing-token"),
    connect: doc.getElementById("screen-connect"),
    identify: doc.getElementById("screen-identify"),
    round: doc.getElementById("screen-round"),
    resultEntry: doc.getElementById("screen-result-entry"),
    confirm: doc.getElementById("screen-confirm"),
  };
  const statusBar = doc.getElementById("status-bar");
  const lockBanner = doc.getElementById("lock-banner");

  if (!tableToken) {
    show("missingToken");
    return { tableToken: null };
  }

  const storage = createIndexedDbStorage();
  const api = new ApiClient("");
  const queue = new OfflineQueue(storage, api, (ev) => {
    if (ev.type === "rejected") setStatus(`התוצאה נדחתה: ${ev.response?.data?.error ?? "שגיאה"}`, true);
  });

  const state = { eventId: null, deviceToken: null, current: null, pendingBoard: null, pendingResultForConfirm: null };
  let ws = null;

  function show(name) {
    for (const key of Object.keys(screens)) {
      if (!screens[key]) continue;
      screens[key].classList.toggle("hidden", key !== name);
    }
  }

  function setStatus(text, isError = false) {
    if (!statusBar) return;
    statusBar.textContent = text;
    statusBar.classList.toggle("status-error", isError);
  }

  async function boot() {
    const storedDeviceToken = await storage.get(`deviceToken:${tableToken}`);
    const storedEventId = await storage.get(`eventId:${tableToken}`);
    if (storedDeviceToken && storedEventId) {
      state.deviceToken = storedDeviceToken;
      state.eventId = storedEventId;
      const hb = await api.heartbeat(tableToken, storedDeviceToken);
      if (hb.ok) {
        connectWs();
        await refreshState();
        return;
      }
    }
    show("connect");
  }

  doc.getElementById("connect-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const eventCode = doc.getElementById("connect-event-code").value.trim();
    const deviceLabel = doc.getElementById("connect-device-label")?.value?.trim() || undefined;
    setStatus("מתחבר...");
    const res = await api.connect(tableToken, eventCode, deviceLabel);
    if (!res.ok) {
      setStatus(res.data?.error ?? "קוד אירוע שגוי", true);
      return;
    }
    state.deviceToken = res.data.deviceToken;
    state.eventId = res.data.eventId;
    await storage.set(`deviceToken:${tableToken}`, state.deviceToken);
    await storage.set(`eventId:${tableToken}`, state.eventId);
    setStatus("");
    connectWs();
    await refreshState();
  });

  function connectWs() {
    if (!state.eventId || typeof WebSocket === "undefined") return;
    try { ws?.close(); } catch { /* ignore */ }
    ws = new WebSocket(wsUrlForEvent(state.eventId));
    ws.addEventListener("message", (evt) => {
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }
      if (["result_entered", "result_confirmed", "result_changed_by_director", "round_started", "table_locked", "table_unlocked"].includes(msg.type)) {
        refreshState();
      } else if (msg.type === "device_took_over") {
        setStatus("מכשיר אחר השתלט על שולחן זה", true);
      } else if (msg.type === "director_message") {
        setStatus(`המנהל: ${msg.text}`);
      }
    });
    ws.addEventListener("close", () => { setTimeout(() => { if (state.eventId) connectWs(); }, 3000); });
  }

  async function refreshState() {
    const res = await api.getState(tableToken);
    if (!res.ok) { setStatus(res.data?.error ?? "שגיאה בטעינת מצב השולחן", true); return; }
    state.current = res.data;
    if (lockBanner) lockBanner.classList.toggle("hidden", res.data.lockState !== "locked");
    await queue.flush();
    if (res.data.identificationRequired) {
      renderIdentify();
      show("identify");
    } else {
      renderRound();
      show("round");
    }
  }

  function renderIdentify() {
    const s = state.current;
    const side = !isIdentified(s.ns) ? "NS" : "EW";
    doc.getElementById("identify-side-label").textContent = side === "NS" ? "צפון-דרום" : "מזרח-מערב";
    doc.getElementById("identify-form").dataset.side = side;
  }

  function isIdentified(pairInfo) {
    // Round-1 identify screen re-renders after each submit via refreshState();
    // a pair with real (non-"member:…"/non-empty) names has been identified.
    return pairInfo?.players?.length === 2 && pairInfo.players.every((p) => p?.name);
  }

  doc.getElementById("identify-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const side = form.dataset.side;
    const player1 = readPlayerIdentity(form, "1");
    const player2 = readPlayerIdentity(form, "2");
    const res = await api.identify(tableToken, { clientEventId: newClientEventId(), side, player1, player2 });
    if (!res.ok) { setStatus(res.data?.error ?? "שגיאה בזיהוי זוג", true); return; }
    form.reset();
    await refreshState();
  });

  function readPlayerIdentity(form, n) {
    const memberId = form.querySelector(`[name=member${n}]`)?.value?.trim();
    const guestName = form.querySelector(`[name=guest${n}]`)?.value?.trim();
    if (memberId) return { kind: "member", memberId };
    return { kind: "guest", name: guestName || `שחקן ${n}` };
  }

  function renderRound() {
    const s = state.current;
    doc.getElementById("round-number").textContent = String(s.round);
    doc.getElementById("round-ns-pair").textContent = s.ns ? String(s.ns.pair) : "—";
    doc.getElementById("round-ew-pair").textContent = s.ew ? String(s.ew.pair) : "—";
    const list = doc.getElementById("board-list");
    list.innerHTML = "";
    for (const board of s.boards) {
      const result = s.results.find((r) => r.board === board);
      const li = doc.createElement("li");
      li.className = "board-row";
      const label = doc.createElement("span");
      label.textContent = `בורד ${board}`;
      li.appendChild(label);
      const statusSpan = doc.createElement("span");
      statusSpan.className = "board-status";
      const btn = doc.createElement("button");
      btn.type = "button";
      if (!result) {
        statusSpan.textContent = "לא הוזן";
        btn.textContent = "הזן תוצאה";
        btn.addEventListener("click", () => openResultEntry(board));
      } else if (result.status === "entered") {
        statusSpan.textContent = "ממתין לאישור יריבים";
        btn.textContent = "אישור יריבים";
        btn.addEventListener("click", () => openConfirm(result));
      } else {
        statusSpan.textContent = result.status === "adjusted" ? "נקבע ע״י מנהל" : "אושר";
        btn.textContent = "צפה";
        btn.disabled = true;
      }
      li.appendChild(statusSpan);
      li.appendChild(btn);
      list.appendChild(li);
    }
  }

  function openResultEntry(board) {
    state.pendingBoard = board;
    doc.getElementById("result-entry-board").textContent = String(board);
    const form = doc.getElementById("result-entry-form");
    form.reset();
    doc.getElementById("result-entry-error").textContent = "";
    show("resultEntry");
  }

  doc.getElementById("result-entry-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const errorEl = doc.getElementById("result-entry-error");
    if (form.elements.passout.checked) {
      await submitBoardResult({ kind: "passout" });
      return;
    }
    const contractTextRaw = form.elements.contractText.value;
    const declarer = form.elements.declarer.value;
    const tricks = Number(form.elements.tricks.value);
    if (!isValidContractText(contractTextRaw)) {
      errorEl.textContent = "חוזה לא תקין, למשל 4S או 3NTX";
      return;
    }
    if (!SEATS.includes(declarer)) {
      errorEl.textContent = "יש לבחור מכריז";
      return;
    }
    if (!Number.isInteger(tricks) || tricks < 0 || tricks > 13) {
      errorEl.textContent = "מספר לקיחות לא תקין";
      return;
    }
    await submitBoardResult({ kind: "played", contractText: normalizeContractText(contractTextRaw), declarer, tricks });
  });

  async function submitBoardResult(result) {
    const clientEventId = newClientEventId();
    await queue.queueResult(tableToken, { clientEventId, round: state.current.round, board: state.pendingBoard, result });
    setStatus("נשלח (או בתור, אם אין חיבור)...");
    await queue.flush();
    await refreshState();
    show("round");
  }

  function openConfirm(result) {
    state.pendingResultForConfirm = result;
    const el = doc.getElementById("confirm-summary");
    el.textContent = result.contractText
      ? `בורד ${result.board}: ${result.contractText} ע״י ${SEAT_LABELS[result.declarer] ?? result.declarer}, ${result.tricks} לקיחות`
      : `בורד ${result.board}: תוצאה מתוקנת`;
    show("confirm");
  }

  doc.getElementById("confirm-accept")?.addEventListener("click", async () => {
    const result = state.pendingResultForConfirm;
    await queue.queueConfirm(tableToken, { clientEventId: newClientEventId(), resultId: result.id });
    await queue.flush();
    await refreshState();
    show("round");
  });

  doc.getElementById("confirm-reject")?.addEventListener("click", () => {
    // Disputed — don't confirm; call the director instead of silently resubmitting.
    show("round");
    setStatus("לא אושר — נא לקרוא למנהל במקרה של חילוקי דעות");
  });

  doc.getElementById("call-director-btn")?.addEventListener("click", async () => {
    const message = prompt("הודעה למנהל (לא חובה):") ?? undefined;
    await api.callDirector(tableToken, { clientEventId: newClientEventId(), message });
    setStatus("המנהל נקרא");
  });

  doc.getElementById("back-to-round-btn")?.addEventListener("click", () => show("round"));

  window.addEventListener("online", () => queue.flush().then(refreshState));

  boot();

  return { tableToken, api, queue, storage, state };
}

if (typeof document !== "undefined" && document.getElementById("app-root")) {
  initApp(document);
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => { /* non-fatal */ });
  }
}
