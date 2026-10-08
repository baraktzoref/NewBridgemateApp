#!/usr/bin/env node
/**
 * Assembles the self-contained Windows bundle that the Inno Setup script packs
 * into a single setup.exe. The app has no runtime npm dependencies (packages
 * import each other by relative path, SQLite is built into Node), so the bundle
 * is just: a portable node.exe + the TypeScript sources + the static front-ends
 * + the launcher .bat files.
 *
 * Usage: node windows/installer/stage.mjs --out <dir> [--node <path-to-node.exe>]
 *   --node  optional: copied in as <out>/node.exe (CI passes the downloaded one)
 */
import { cpSync, existsSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };

const out = opt("out");
if (!out) { console.error("usage: stage.mjs --out <dir> [--node <node.exe>]"); process.exit(1); }
const outDir = path.resolve(out);

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const copy = (rel, destRel = rel) => cpSync(path.join(root, rel), path.join(outDir, destRel), { recursive: true });

copy("package.json");
for (const pkg of ["api", "server", "shared", "movement", "scoring"]) {
  copy(`packages/${pkg}/package.json`);
  copy(`packages/${pkg}/src`);
}
for (const app of ["pwa", "director-app"]) {
  copy(`packages/${app}/package.json`);
  copy(`packages/${app}/public`);
}
copy("scripts/create-event.mjs");
copy("README-WINDOWS.md");
for (const f of readdirSync(path.join(root, "windows/installer/launchers"))) {
  copy(`windows/installer/launchers/${f}`, f);
}
const nodeExe = opt("node");
if (nodeExe) {
  if (!existsSync(nodeExe)) { console.error(`node binary not found: ${nodeExe}`); process.exit(1); }
  cpSync(nodeExe, path.join(outDir, "node.exe"));
}
console.log(`staged bundle at ${outDir}`);
