/**
 * Real-browser end-to-end test: a genuine Chromium page (via Playwright,
 * launched from the pre-installed browser at /opt/pw-browsers) driving the
 * actual PWA served by a real packages/api HTTP+WS server — no mocking of
 * fetch, no mocking of the DOM. This is the same rigor already applied to
 * packages/api's own integration tests, one layer up: here the client under
 * test is the browser page itself, not a fetch() call.
 *
 * Playwright isn't npm-installable in this environment (no registry access);
 * packages/pwa/node_modules/playwright(-core) are symlinks to the
 * system-wide install at /opt/npm-tools/node_modules, so plain ESM `import`
 * resolution works without any bundler or NODE_PATH trick.
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
    body: JSON.stringify({ name: "E2E night", pairs, boardsPerRound }),
  });
  return (await res.json()) as {
    eventId: string; eventCode: string; tables: number; rounds: number;
    tableTokens: Record<string, string>; directorPin: string;
  };
}

/** Logs in as director (PIN from createEvent) and returns the bearer token for director-only routes. */
async function directorToken(base: string, eventId: string, pin: string) {
  const res = await fetch(`${base}/api/events/${eventId}/director-login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pin }),
  });
  const body = (await res.json()) as { directorToken: string };
  return body.directorToken;
}

test("full table flow in a real browser: connect -> identify NS+EW -> enter result -> EW confirms", async (t) => {
  const { base, close } = await startServer();
  const browser = await chromium.launch();
  try {
    const created = await createEvent(base, 6, 2); // 3 tables, round 1 identification needed
    const tableToken = created.tableTokens["1"];
    assert.ok(tableToken, "table 1 should have a token");

    const page = await browser.newPage();
    try {
      await page.goto(`${base}/t/${tableToken}`);
      await page.waitForSelector("#screen-connect:not(.hidden)", { timeout: 5000 });

      await page.fill("#connect-event-code", created.eventCode);
      await page.click("#connect-form button[type=submit]");

      // Round 1: both NS and EW need identifying before the board list appears.
      await page.waitForSelector("#screen-identify:not(.hidden)", { timeout: 5000 });
      await t.test("identifies NS", async () => {
        await page.fill('[name=guest1]', "Alice");
        await page.fill('[name=guest2]', "Bob");
        await page.click("#identify-form button[type=submit]");
      });

      await page.waitForFunction(() => {
        const el = document.getElementById("identify-side-label");
        return el?.textContent === "מזרח-מערב";
      }, { timeout: 5000 });

      await t.test("identifies EW", async () => {
        await page.fill('[name=guest1]', "Carol");
        await page.fill('[name=guest2]', "Dave");
        await page.click("#identify-form button[type=submit]");
      });

      await page.waitForSelector("#screen-round:not(.hidden)", { timeout: 5000 });
      const boardRows = await page.locator("#board-list .board-row").count();
      assert.equal(boardRows, 2, "boardsPerRound=2 should produce two board rows");

      await t.test("enters a played result for board 1", async () => {
        await page.locator("#board-list .board-row").first().locator("button").click();
        await page.waitForSelector("#screen-result-entry:not(.hidden)");
        await page.fill('[name=contractText]', "4S");
        await page.check('[name=declarer][value=N]');
        await page.fill('[name=tricks]', "10");
        await page.click("#result-entry-form button[type=submit]");
      });

      await page.waitForSelector("#screen-round:not(.hidden)", { timeout: 5000 });
      const firstRowStatus = await page.locator("#board-list .board-row").first().locator(".board-status").textContent();
      assert.equal(firstRowStatus, "ממתין לאישור יריבים");

      await t.test("EW confirms the result on the same (NS) phone", async () => {
        await page.locator("#board-list .board-row").first().locator("button").click();
        await page.waitForSelector("#screen-confirm:not(.hidden)");
        const summary = await page.locator("#confirm-summary").textContent();
        assert.match(summary ?? "", /4S/);
        await page.click("#confirm-accept");
      });

      await page.waitForSelector("#screen-round:not(.hidden)", { timeout: 5000 });
      const confirmedStatus = await page.locator("#board-list .board-row").first().locator(".board-status").textContent();
      assert.equal(confirmedStatus, "אושר");

      // Cross-check against the server's own view of the result, not just the DOM.
      const state = await (await fetch(`${base}/api/t/${tableToken}/state`)).json() as any;
      const board1 = state.results.find((r: any) => r.board === 1);
      assert.equal(board1.status, "confirmed");
      assert.equal(board1.contractText, "4S");
      assert.equal(board1.declarer, "N");
      assert.equal(board1.tricks, 10);
    } finally {
      await page.close();
    }
  } finally {
    await browser.close();
    await close();
  }
});

test("a locked table blocks result submission and the phone shows the lock banner", async () => {
  const { app, base, close } = await startServer();
  const browser = await chromium.launch();
  try {
    const created = await createEvent(base, 4, 2); // 2 tables
    const tableToken = created.tableTokens["1"];

    const page = await browser.newPage();
    try {
      await page.goto(`${base}/t/${tableToken}`);
      await page.fill("#connect-event-code", created.eventCode);
      await page.click("#connect-form button[type=submit]");
      await page.waitForSelector("#screen-identify:not(.hidden)");
      await page.fill('[name=guest1]', "Alice");
      await page.fill('[name=guest2]', "Bob");
      await page.click("#identify-form button[type=submit]");
      await page.waitForFunction(() => document.getElementById("identify-side-label")?.textContent === "מזרח-מערב");
      await page.fill('[name=guest1]', "Carol");
      await page.fill('[name=guest2]', "Dave");
      await page.click("#identify-form button[type=submit]");
      await page.waitForSelector("#screen-round:not(.hidden)");

      // Director logs in with the PIN createEvent returned, then locks the table out from under the live page.
      const token = await directorToken(base, created.eventId, created.directorPin);
      const lockRes = await fetch(`${base}/api/events/${created.eventId}/table/1/lock`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-director-token": token },
        body: JSON.stringify({ table: 1, action: "lock" }),
      });
      assert.equal(lockRes.status, 200);

      await page.waitForSelector("#lock-banner:not(.hidden)", { timeout: 5000 });

      // The submission itself is still rejected server-side even if a stale page tried it.
      const submitRes = await fetch(`${base}/api/t/${tableToken}/result`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientEventId: "ce-locked", round: 1, board: 1, result: { kind: "passout" } }),
      });
      assert.equal(submitRes.status, 423);
    } finally {
      await page.close();
    }
  } finally {
    await browser.close();
    await close();
  }
});
