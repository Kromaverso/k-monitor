// Bundles the plugin and rasterises its icons into the .sdPlugin folder.
import { build } from "esbuild";
import { Resvg } from "@resvg/resvg-js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const P = "com.kromaverso.kmonitor.sdPlugin";
mkdirSync(`${P}/bin`, { recursive: true });
await build({ entryPoints: ["src/plugin.ts"], bundle: true, platform: "node", target: "node20", format: "esm", outfile: `${P}/bin/plugin.js`, minify: true,
  // Bundled CommonJS deps (ws) call require(); give the ESM bundle a real one.
  banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' } });
writeFileSync(`${P}/bin/package.json`, JSON.stringify({ type: "module" }));

const png = (svg, size, out) => writeFileSync(out, new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng());
const both = (svg, size, base) => { png(svg, size, `${base}.png`); png(svg, size * 2, `${base}@2x.png`); };

// White line glyph (gauge + pulse) for the action list and category.
const glyph = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><g fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
<path d="M8.3 29.5 A14 14 0 1 1 31.7 29.5"/><polyline points="11,24 15,24 17.5,19 21,28 24,16 26.5,24 29,24"/></g></svg>`;
both(glyph, 20, `${P}/imgs/action`);
both(glyph, 28, `${P}/imgs/category`);
const appIcon = readFileSync("../assets/icon.svg", "utf8");
both(appIcon, 256, `${P}/imgs/plugin`);

await build({ entryPoints: ["src/render.ts"], format: "esm", platform: "node", outfile: "scripts/render.mjs", logLevel: "warning" });
const { render } = await import("./render.mjs");
both(render({ metric: "cpu" }, null), 72, `${P}/imgs/key`);
// .streamDeckPlugin is a zip with the plugin folder at its root; double-click installs it.
const { execFileSync } = await import("node:child_process");
const out = "../release/kMonitor.streamDeckPlugin";
mkdirSync("../release", { recursive: true });
execFileSync("powershell.exe", ["-NoProfile", "-Command",
  `Remove-Item -ErrorAction SilentlyContinue '${out}', '${out}.zip'; Compress-Archive -Path '${P}' -DestinationPath '${out}.zip'; Move-Item '${out}.zip' '${out}'`]);
console.log("ok ->", out);
