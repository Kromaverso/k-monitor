// Renders the README screenshots into docs/images with headless Edge.
// Start the UI first (`npx vite`), then: node tools/capture.mjs [lang]
// The pages run in capture mode (src/capture.ts): sample data, no Tauri, nothing personal.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const lang = process.argv[2] ?? "en";
const base = "http://localhost:1433/";
const out = resolve("docs/images");
mkdirSync(out, { recursive: true });

const edge = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
if (!edge) throw new Error("Microsoft Edge not found");

const shots = [
  ["overview", "?capture=overview", 1440, 900],
  ["processes", "?capture=processes", 1440, 900],
  ["energy", "?capture=energy", 1440, 1180],
  ["system", "?capture=system", 1440, 1000],
  ["settings", "?capture=settings", 1440, 900],
  ["mini", "?capture=mini#mini", 560, 600],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const [name, query, w, h] of shots) {
  const file = join(out, `${name}.png`);
  rmSync(file, { force: true });
  const url = `${base}${query.replace("#", `&lang=${lang}#`)}${query.includes("#") ? "" : `&lang=${lang}`}`;
  const profile = join(tmpdir(), `kmonitor-capture-${process.pid}-${name}`);
  execFileSync(edge, [
    "--headless", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
    `--window-size=${w},${h}`, "--virtual-time-budget=5000", `--user-data-dir=${profile}`, `--screenshot=${file}`, url,
  ]);
  // Edge can return before the file is flushed.
  for (let i = 0; i < 40 && !(existsSync(file) && statSync(file).size > 0); i++) await sleep(250);
  console.log(existsSync(file) ? `ok  ${name}.png` : `FAIL ${name}`);
  // Edge may still hold the profile for a moment; a leftover temp folder is harmless.
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {}
}
