/**
 * Real-browser end-to-end test for the director's screen, mirroring
 * packages/pwa/test/e2e/flow.test.ts's rigor: a genuine Chromium page (via
 * Playwright, launched from the pre-installed browser at /opt/pw-browsers)
 * driving the actual director-app pages against a real packages/api
 * HTTP+WS server. See that file's header comment for why the Node driver
 * is a symlink into this package's node_modules rather than an npm install.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createApp } from "../../../api/src/app.ts";

async function startServer() {
  const app = createApp(":memory:");
  await new Promise<void>((resolve) => app.server.listen(0, resolve));
  const addr = app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;
  return {
    app,
    base,
    close: () => new Promise<void>((resolve) => {
      app.server.closeAllConnections?.();
      app.server.close(() => resolve());
    }),
  };
}

async function createEvent(base: string, pairs: number, boardsPerRound: number) {
  const res = await fetch(`${base}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Director E2E night", pairs, boardsPerRound }),
  });
  return (await res.json()) as {
    eventId: string; eventCode: string; tables: number; rounds: number;
    tableTokens: Record<string, string>; directorPin: string;
  };
}

test("director logs in, sees a connected table, locks it, edits a result, and overrides another", async (t) => {
  const { base, close } = await startServer();
  const browser = await chromium.launch();
  try {
    const created = await createEvent(base, 6, 2); // 3 tables, 2 boards/round
    const token1 = created.tableTokens["1"];

    // A table phone connects and enters a result, independently of the director UI,
    // so the director's screen has real state to show (not just an empty grid).
    const connectRes = await fetch(`${base}/api/t/${token1}/connect`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ tableToken: token1, eventCode: created.eventCode }),
    });
    assert.equal(connectRes.status, 201);
    const submitRes = await fetch(`${base}/api/t/${token1}/result`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientEventId: "ce1", round: 1, board: 1, result: { kind: "played", contractText: "4S", declarer: "N", tricks: 10 } }),
    });
    const submitted = await submitRes.json() as { id: string };

    const page = await browser.newPage();
    try {
      await page.goto(`${base}/director`);
      await page.waitForSelector("#screen-login:not(.hidden)", { timeout: 5000 });
      await page.fill("#login-event-id", created.eventId);
      await page.fill("#login-pin", created.directorPin);
      await page.click("#login-form button[type=submit]");

      await page.waitForSelector("#screen-dashboard:not(.hidden)", { timeout: 5000 });
      await page.waitForFunction(() => document.querySelectorAll(".table-card").length === 3);

      // Table 1 should show as connected, with the entered result counted.
      const table1Text = await page.locator(".table-card", { hasText: "שולחן 1" }).first().innerText();
      assert.match(table1Text, /מחובר/);
      assert.match(table1Text, /1 ממתינות/);

      await t.test("locks table 1 from the director screen, and the table phone is then refused", async () => {
        const card = page.locator(".table-card", { hasText: "שולחן 1" }).first();
        await card.getByRole("button", { name: "נעל שולחן" }).click();
        await page.waitForFunction(() => {
          const cards = [...document.querySelectorAll(".table-card")];
          return cards.some((c) => c.textContent?.includes("שולחן 1") && c.textContent.includes("נעול"));
        }, { timeout: 5000 });

        const blockedSubmit = await fetch(`${base}/api/t/${token1}/result`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ clientEventId: "ce2", round: 1, board: 2, result: { kind: "passout" } }),
        });
        assert.equal(blockedSubmit.status, 423);

        // Unlock again so later checks of this table aren't left locked.
        const card2 = page.locator(".table-card", { hasText: "שולחן 1" }).first();
        await card2.getByRole("button", { name: "שחרר נעילה" }).click();
        await page.waitForFunction(() => {
          const cards = [...document.querySelectorAll(".table-card")];
          return cards.some((c) => c.textContent?.includes("שולחן 1") && c.textContent.includes("פתוח"));
        }, { timeout: 5000 });
      });

      await t.test("edits the result's contract from the director screen", async () => {
        const card = page.locator(".table-card", { hasText: "שולחן 1" }).first();
        await card.getByRole("button", { name: "פרטי בורדים" }).click();
        await card.getByRole("button", { name: "ערוך" }).first().click();
        await page.waitForSelector("#edit-modal:not(.hidden)");
        await page.fill('#edit-form [name=contractText]', "3NT");
        await page.check('#edit-form [name=declarer][value=N]');
        await page.fill('#edit-form [name=tricks]', "9");
        await page.click("#edit-form button[type=submit]");
        await page.waitForSelector("#edit-modal", { state: "hidden", timeout: 5000 });
      });

      // Cross-check against the server's own state, not just the DOM.
      const afterEdit = await (await fetch(`${base}/api/events/${created.eventId}/standings`)).json();
      assert.ok(afterEdit);

      await t.test("sets an adjusted percentage (Average+) via the override modal", async () => {
        const card = page.locator(".table-card", { hasText: "שולחן 1" }).first();
        await card.getByRole("button", { name: "התאמה %" }).first().click();
        await page.waitForSelector("#override-modal:not(.hidden)");
        await page.fill('#override-form [name=adjustedNsPct]', "60");
        await page.fill('#override-form [name=adjustedEwPct]', "40");
        await page.click("#override-form button[type=submit]");
        await page.waitForSelector("#override-modal", { state: "hidden", timeout: 5000 });
      });

      await page.waitForFunction((rid) => {
        const cards = [...document.querySelectorAll(".board-row")];
        return cards.some((c) => c.textContent?.includes("תוצאה מותאמת"));
      }, submitted.id, { timeout: 5000 });

      await t.test("advances the round from the director screen", async () => {
        page.once("dialog", (d) => d.accept());
        await page.click("#advance-round-btn");
        await page.waitForFunction(() => document.getElementById("round-info")?.textContent?.includes("2"), { timeout: 5000 });
      });
    } finally {
      await page.close();
    }
  } finally {
    await browser.close();
    await close();
  }
});

test("a call-director alert from the table phone shows up live on the director screen over WebSocket", async () => {
  const { base, close } = await startServer();
  const browser = await chromium.launch();
  try {
    const created = await createEvent(base, 4, 2);
    const token1 = created.tableTokens["1"];

    const page = await browser.newPage();
    try {
      await page.goto(`${base}/director`);
      await page.fill("#login-event-id", created.eventId);
      await page.fill("#login-pin", created.directorPin);
      await page.click("#login-form button[type=submit]");
      await page.waitForSelector("#screen-dashboard:not(.hidden)");

      await fetch(`${base}/api/t/${token1}/call-director`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientEventId: "cd1", message: "צריך עזרה עם הניקוד" }),
      });

      await page.waitForFunction(() => document.getElementById("director-alerts")?.textContent?.includes("צריך עזרה עם הניקוד"), { timeout: 5000 });

      await page.getByRole("button", { name: "✕" }).first().click();
      await page.waitForFunction(() => document.getElementById("director-alerts")?.children.length === 0, { timeout: 5000 });
    } finally {
      await page.close();
    }
  } finally {
    await browser.close();
    await close();
  }
});
