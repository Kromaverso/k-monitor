// Renders docs/images/share-card.png from the sample specs in src/capture.ts (not this PC).
// Run from the repo root: node tools/share-card.mjs [lang]

import { build } from "esbuild";
import { createRequire } from "node:module";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const lang = process.argv[2] ?? "en";
const require = createRequire(new URL("../streamdeck/package.json", import.meta.url));
const { Resvg } = require("@resvg/resvg-js");

// Bundle the card code for Node; the sample data and the card come from the app's own sources.
const out = join(tmpdir(), `kmonitor-share-${process.pid}.mjs`);
await build({
  stdin: {
    contents: `export { specSvg } from "./src/share.ts"; export { specs } from "./src/capture.ts"; export { setLang } from "./src/i18n.ts";`,
    resolveDir: process.cwd(), loader: "ts",
  },
  bundle: true, platform: "node", format: "esm", outfile: out, logLevel: "warning",
});
const { specSvg, specs, setLang } = await import(pathToFileURL(out).href);
rmSync(out, { force: true });

globalThis.document = { documentElement: {} };
setLang(lang);
const logo = "data:image/png;base64," + readFileSync("public/icon.png").toString("base64");
const svg = specSvg(specs, logo);
writeFileSync("docs/images/share-card.png", new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: "Segoe UI" } }).render().asPng());
console.log("ok  docs/images/share-card.png");
