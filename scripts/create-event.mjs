#!/usr/bin/env node
/**
 * Creates a tournament event against a running packages/api server and
 * produces a printable setup sheet (HTML) with every table's direct URL and
 * the director's login details — the "paperwork" a club needs before a
 * pilot night: nobody should have to construct a URL or dig a token out of
 * curl output by hand at the table.
 *
 * Usage:
 *   node scripts/create-event.mjs --name "ערב חמישי" --pairs 12 --boardsPerRound 3
 *
 * Flags (all except --name/--pairs/--boardsPerRound are optional):
 *   --name, --pairs, --boardsPerRound   required (prompted interactively if omitted)
 *   --rounds <n>                        override the auto-computed round count
 *   --phantomSide NS|EW                 for an odd number of pairs
 *   --directorPin <6 digits>            choose the PIN instead of a random one
 *   --port <n>                          the server's port (default 8080)
 *   --server <url>                      full base URL instead of auto-detecting the LAN IP
 *   --out <dir>                         where to write the setup sheet + credentials (default ./generated)
 */
import { createInterface } from "node:readline/promises";
import { networkInterfaces } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) { out[key] = true; continue; }
    out[key] = next;
    i++;
  }
  return out;
}

async function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/** The first non-loopback IPv4 address — what phones on the same WiFi should use, not "localhost". */
function detectLanIp() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return null;
}

function openInBrowser(filePath) {
  const cmd = process.platform === "win32" ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
  // With shell:true on Windows the args are joined by spaces, so the path must be pre-quoted.
  const args = process.platform === "win32" ? ["\"\"", `"${filePath}"`] : [filePath];
  try {
    const child = spawn(cmd, args, { shell: process.platform === "win32", stdio: "ignore", detached: true });
    child.unref();
  } catch {
    // Best-effort only — the script still prints the file path either way.
  }
}

function buildSetupHtml({ event, base, created }) {
  const rows = Object.entries(created.tableTokens)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([table, token]) => {
      const url = `${base}/t/${token}`;
      return `
        <div class="table-card">
          <div class="table-number">שולחן ${table}</div>
          <div class="url">${url}</div>
          <div class="hint">להקליד/להדביק בדפדפן הטלפון של צפון-דרום, ואז קוד אירוע: <strong>${created.eventCode}</strong></div>
        </div>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<title>הגדרת ערב — ${event.name}</title>
<style>
  body { font-family: system-ui, Arial, sans-serif; margin: 2rem; color: #111; }
  h1 { margin-bottom: 0.25rem; }
  .meta { background: #f4f6f4; border: 1px solid #ccc; border-radius: 8px; padding: 1rem; margin-bottom: 1.5rem; }
  .meta div { margin: 0.3rem 0; font-size: 1.1rem; }
  .meta strong { font-size: 1.3rem; }
  .director-link { font-family: monospace; font-size: 1.1rem; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; }
  .table-card { border: 2px solid #1b4332; border-radius: 10px; padding: 1rem; page-break-inside: avoid; }
  .table-number { font-size: 1.4rem; font-weight: bold; margin-bottom: 0.5rem; }
  .url { font-family: monospace; font-size: 1rem; word-break: break-all; background: #f0f0f0; padding: 0.4rem; border-radius: 6px; }
  .hint { margin-top: 0.5rem; font-size: 0.9rem; color: #444; }
  @media print { .no-print { display: none; } }
</style>
</head>
<body>
  <h1>${event.name}</h1>
  <div class="meta">
    <div>מזהה אירוע (eventId): <span class="director-link">${created.eventId}</span></div>
    <div>קוד אירוע לטלפונים (eventCode): <strong>${created.eventCode}</strong></div>
    <div>PIN למנהל (חד-פעמי, לשמור בסודיות!): <strong>${created.directorPin}</strong></div>
    <div>מסך מנהל: <span class="director-link">${base}/director</span></div>
    <div>${created.tables} שולחנות, ${created.rounds} סבבים</div>
  </div>
  <p class="no-print">לחצו Ctrl+P כדי להדפיס את גיליון השולחנות.</p>
  <div class="grid">
    ${rows}
  </div>
</body>
</html>`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const name = args.name ?? await prompt("שם הערב: ");
  const pairs = Number(args.pairs ?? await prompt("מספר זוגות: "));
  const boardsPerRound = Number(args.boardsPerRound ?? await prompt("לוחות לסיבוב: "));
  if (!name || !Number.isInteger(pairs) || pairs < 2 || !Number.isInteger(boardsPerRound) || boardsPerRound < 1) {
    console.error("קלט לא תקין — יש צורך בשם, מספר זוגות (>=2) ולוחות-לסיבוב (>=1) תקינים.");
    process.exit(1);
  }

  const port = args.port ?? "8080";
  const base = typeof args.server === "string" ? args.server.replace(/\/$/, "") : (() => {
    const lanIp = detectLanIp();
    if (!lanIp) {
      console.warn("לא אותרה כתובת רשת מקומית — משתמש ב-localhost (יעבוד רק על המחשב הזה, לא מהטלפונים).");
      return `http://localhost:${port}`;
    }
    return `http://${lanIp}:${port}`;
  })();

  const body = {
    name, pairs, boardsPerRound,
    rounds: args.rounds !== undefined ? Number(args.rounds) : undefined,
    phantomSide: args.phantomSide === "NS" || args.phantomSide === "EW" ? args.phantomSide : undefined,
    directorPin: typeof args.directorPin === "string" ? args.directorPin : undefined,
  };

  console.log(`יוצר אירוע מול ${base} ...`);
  let res;
  try {
    res = await fetch(`${base}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.error(`לא ניתן להתחבר לשרת ב-${base}. ודאו שהשרת רץ (windows\\start-server.bat) ושה-port תואם.`);
    console.error(String(e?.message ?? e));
    process.exit(1);
  }
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    console.error(`השרת החזיר שגיאה (${res.status}): ${errBody?.error ?? "unknown"}`);
    process.exit(1);
  }
  const created = await res.json();

  console.log("\n=== האירוע נוצר בהצלחה ===");
  console.log(`eventId:      ${created.eventId}`);
  console.log(`eventCode:    ${created.eventCode}`);
  console.log(`directorPin:  ${created.directorPin}   <-- שמרו את זה, לא ישוחזר!`);
  console.log(`שולחנות:      ${created.tables}`);
  console.log(`סבבים:        ${created.rounds}`);
  console.log(`מסך מנהל:     ${base}/director\n`);

  const outDir = typeof args.out === "string" ? args.out : "generated";
  await mkdir(outDir, { recursive: true });

  const credsPath = path.join(outDir, `event-${created.eventId}.json`);
  await writeFile(credsPath, JSON.stringify({ name, base, ...created }, null, 2), "utf8");
  console.log(`פרטי האירוע נשמרו ב: ${credsPath}`);

  const htmlPath = path.join(outDir, `event-${created.eventId}-setup.html`);
  await writeFile(htmlPath, buildSetupHtml({ event: { name }, base, created }), "utf8");
  console.log(`גיליון שולחנות להדפסה: ${htmlPath}`);

  if (!args["no-open"]) openInBrowser(path.resolve(htmlPath));
}

main();
