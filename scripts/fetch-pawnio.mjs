// Downloads the official PawnIO installer bundled with kMonitor, once, and checks it.
// It is not kept in git: it's a third-party binary, fetched from its own release page.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const URL = "https://github.com/namazso/PawnIO.Setup/releases/download/2.2.0/PawnIO_setup.exe";
// PawnIO 2.2.0, signed by namazso.eu.
const SHA256 = "1f519a22e47187f70a1379a48ca604981c4fcf694f4e65b734aaa74a9fba3032";
const OUT = "src-tauri/pawnio/PawnIO_setup.exe";

const hash = (b) => createHash("sha256").update(b).digest("hex");

if (existsSync(OUT) && hash(readFileSync(OUT)) === SHA256) process.exit(0);

console.log("Downloading PawnIO 2.2.0 setup…");
const res = await fetch(URL);
if (!res.ok) throw new Error(`PawnIO download failed: HTTP ${res.status}`);
const buf = Buffer.from(await res.arrayBuffer());
if (hash(buf) !== SHA256) throw new Error("PawnIO setup checksum mismatch, refusing to bundle it");
mkdirSync("src-tauri/pawnio", { recursive: true });
writeFileSync(OUT, buf);
console.log("PawnIO setup verified.");
