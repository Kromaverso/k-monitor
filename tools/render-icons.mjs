// Renders the icons from the SVG sources in assets/.
//   heart-icon.png  512x512 full square for kHeart (no margin, no corners)
//   assets/icon.png 1024x1024 app tile, the source for `npx tauri icon assets/icon.png`
// Uses the resvg dependency of the Stream Deck plugin: run `npm install` in streamdeck/ first.

import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";

const require = createRequire(new URL("../streamdeck/package.json", import.meta.url));
const { Resvg } = require("@resvg/resvg-js");

const render = (svg, size, out) => {
  writeFileSync(out, new Resvg(readFileSync(svg, "utf8"), { fitTo: { mode: "width", value: size } }).render().asPng());
  console.log(`ok  ${out}`);
};

render("assets/heart-icon.svg", 512, "heart-icon.png");
render("assets/icon.svg", 1024, "assets/icon.png");
