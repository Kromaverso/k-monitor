// Renders sample keys with live data from kMonitor into a contact sheet (for checking the look).
import { Resvg } from "@resvg/resvg-js";
import { writeFileSync } from "node:fs";
const { render } = await import("./render.mjs");
// --sample uses fixed numbers (README image); otherwise live data from kMonitor.
const sampleStats = {
  cpu: { name: "", usage: 39, temp: 72, power: 142, mhz: 5320 },
  gpu: { name: "", usage: 64, temp: 63, power: 214, powerLimit: 300, clock: 2805, vramUsed: 11.8e9, vramTotal: 16.77e9 },
  mem: { used: 38.6e9, total: 66.19e9 },
  power: { wall: 457, cpu: 142, gpu: 214 },
  history: {
    cpu: Array.from({ length: 40 }, (_, i) => 36 + 14 * Math.sin(i / 4)),
    gpu: Array.from({ length: 40 }, (_, i) => 55 + 20 * Math.sin(i / 6)),
    mem: Array.from({ length: 40 }, () => 58), cpuTemp: [], gpuTemp: [],
  },
};
const sample = process.argv.includes("--sample");
const stats = sample ? sampleStats : await fetch("http://127.0.0.1:47615/v1/stats").then((r) => r.json()).catch(() => null);
const keys = [
  { metric: "cpu" }, { metric: "gpu" }, { metric: "cputemp" }, { metric: "gputemp" }, { metric: "duo" },
  { metric: "ram" }, { metric: "vram" }, { metric: "gpupower" }, { metric: "cpu", style: "graph" }, { metric: "temps" },
];
const cells = keys.map((k, i) => {
  const svg = render(k, stats).replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  const x = 10 + (i % 5) * 164, y = 10 + Math.floor(i / 5) * 164;
  return `<g transform="translate(${x} ${y})"><clipPath id="c${i}"><rect width="144" height="144" rx="22"/></clipPath><g clip-path="url(#c${i})">${svg}</g><rect width="144" height="144" rx="22" fill="none" stroke="#3a3a3a" stroke-width="3"/></g>`;
});
cells.push(`<g transform="translate(10 338)"><clipPath id="off"><rect width="144" height="144" rx="22"/></clipPath><g clip-path="url(#off)">${render({ metric: "gpu" }, null).replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "")}</g></g>`);
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="830" height="492" viewBox="0 0 830 492"><rect width="830" height="492" fill="#2b2b2b"/>${cells.join("")}</svg>`;
writeFileSync(process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "preview.png", new Resvg(sheet, { font: { loadSystemFonts: true, defaultFontFamily: "Segoe UI" } }).render().asPng());
console.log("preview ok", !!stats);
