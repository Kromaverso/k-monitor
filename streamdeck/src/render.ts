/** Draws a Stream Deck key (144x144 SVG) in the black/white style of the user's deck. */

export type Metric = "cpu" | "gpu" | "cputemp" | "gputemp" | "ram" | "vram" | "gpupower" | "pcpower" | "duo" | "temps";
export type Settings = { metric?: Metric; style?: "gauge" | "graph"; press?: "open" | "mini" | "none"; label?: string };
export type Stats = {
  cpu: { name: string; usage: number; temp: number | null; power: number | null; mhz: number };
  gpu: { name: string; usage: number; temp: number | null; power: number | null; powerLimit: number | null; clock: number | null; vramUsed: number; vramTotal: number };
  mem: { used: number; total: number };
  power?: { wall: number; cpu: number; gpu: number };
  history: { cpu: number[]; gpu: number[]; mem: number[]; cpuTemp: (number | null)[]; gpuTemp: (number | null)[] };
};

/** Key texts in the Stream Deck app's language (set by plugin.ts). */
const TEXT = {
  pt: { open: "ABRIR", noSensor: "SEM SENSOR", load: "uso" },
  en: { open: "OPEN", noSensor: "NO SENSOR", load: "load" },
  es: { open: "ABRIR", noSensor: "SIN SENSOR", load: "uso" },
};
let tx = TEXT.en;
export function setLanguage(lang: string | undefined) {
  const l = (lang ?? "en").toLowerCase();
  tx = l.startsWith("pt") ? TEXT.pt : l.startsWith("es") ? TEXT.es : TEXT.en;
}

const CYAN = "#64d2ff";
const GPU = "#30d158";
const RAM = "#d1d1d6";
const COOL = "#30d158";
const ORANGE = "#ff9f0a";
const RED = "#ff453a";
const FONT = `font-family="Segoe UI Variable Display, Segoe UI, Arial, sans-serif"`;

const load = (v: number, base: string) => (v >= 85 ? RED : v >= 60 ? ORANGE : base);
const heat = (c: number) => (c >= 85 ? RED : c >= 72 ? ORANGE : c >= 55 ? "#ffd60a" : COOL);
const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);

type Reading = { label: string; value: number | null; min: number; max: number; unit: string; color: string; sub?: string; series?: (number | null)[] };

function reading(m: Metric, s: Stats): Reading {
  const gb = (b: number) => (b / 1073741824).toFixed(1);
  switch (m) {
    case "gpu": return { label: "GPU", value: s.gpu.usage, min: 0, max: 100, unit: "%", color: load(s.gpu.usage, GPU), sub: s.gpu.temp != null ? `${s.gpu.temp}°C` : undefined, series: s.history.gpu };
    case "cputemp": return { label: "CPU TEMP", value: s.cpu.temp, min: 25, max: 100, unit: "°", color: heat(s.cpu.temp ?? 0), sub: s.cpu.temp == null ? tx.noSensor : `${Math.round(s.cpu.usage)}% ${tx.load}`, series: s.history.cpuTemp };
    case "gputemp": return { label: "GPU TEMP", value: s.gpu.temp, min: 25, max: 95, unit: "°", color: heat(s.gpu.temp ?? 0), sub: `${Math.round(s.gpu.usage)}% ${tx.load}`, series: s.history.gpuTemp };
    case "ram": return { label: "RAM", value: (s.mem.used * 100) / s.mem.total, min: 0, max: 100, unit: "%", color: load((s.mem.used * 100) / s.mem.total, RAM), sub: `${gb(s.mem.used)}/${Math.round(s.mem.total / 1073741824)} GB`, series: s.history.mem };
    case "vram": {
      const v = s.gpu.vramTotal ? (s.gpu.vramUsed * 100) / s.gpu.vramTotal : 0;
      return { label: "VRAM", value: v, min: 0, max: 100, unit: "%", color: load(v, GPU), sub: `${gb(s.gpu.vramUsed)}/${Math.round(s.gpu.vramTotal / 1073741824)} GB` };
    }
    case "gpupower": return { label: "GPU WATTS", value: s.gpu.power, min: 0, max: s.gpu.powerLimit ?? 300, unit: "W", color: load(((s.gpu.power ?? 0) * 100) / (s.gpu.powerLimit ?? 300), GPU), sub: s.gpu.clock ? `${s.gpu.clock} MHz` : undefined };
    case "pcpower": {
      const w = s.power?.wall ?? null;
      return { label: "PC WATTS", value: w, min: 0, max: 700, unit: "W", color: load(((w ?? 0) * 100) / 700, RAM), sub: s.power ? `CPU ${Math.round(s.power.cpu)} · GPU ${Math.round(s.power.gpu)}` : undefined };
    }
    default: return { label: "CPU", value: s.cpu.usage, min: 0, max: 100, unit: "%", color: load(s.cpu.usage, CYAN), sub: s.cpu.temp != null ? `${Math.round(s.cpu.temp)}°C` : `${(s.cpu.mhz / 1000).toFixed(1)} GHz`, series: s.history.cpu };
  }
}

/** 270° arc, open at the bottom, like a car gauge. */
function arc(cx: number, cy: number, r: number, frac: number) {
  const start = (135 * Math.PI) / 180;
  const end = start + (270 * Math.PI * Math.max(0.0001, Math.min(1, frac))) / 180;
  const p = (a: number) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  const large = end - start > Math.PI ? 1 : 0;
  return `M ${p(start)} A ${r} ${r} 0 ${large} 1 ${p(end)}`;
}

function frame(inner: string, label: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
<rect width="144" height="144" fill="#000"/>
${inner}
<text x="72" y="133" text-anchor="middle" ${FONT} font-size="17" font-weight="800" letter-spacing="1" fill="#fff">${esc(label.toUpperCase())}</text>
</svg>`;
}

function gauge(r: Reading, label: string) {
  const frac = r.value == null ? 0 : (r.value - r.min) / (r.max - r.min);
  const value = r.value == null ? "—" : Math.round(r.value).toString();
  return frame(
    // The arc's ends sit around y=93, so the small line goes below them, above the label.
    `<path d="${arc(72, 56, 42, 1)}" fill="none" stroke="#262626" stroke-width="10" stroke-linecap="round"/>
${r.value == null ? "" : `<path d="${arc(72, 56, 42, frac)}" fill="none" stroke="${r.color}" stroke-width="10" stroke-linecap="round"/>`}
<text x="72" y="69" text-anchor="middle" ${FONT} font-size="34" font-weight="700" fill="#fff">${value}<tspan font-size="16" font-weight="600" fill="#bbb" dx="1">${esc(r.unit)}</tspan></text>
${r.sub ? `<text x="72" y="111" text-anchor="middle" ${FONT} font-size="13" font-weight="600" fill="#8e8e93">${esc(r.sub)}</text>` : ""}`,
    label || r.label,
  );
}

function graph(r: Reading, label: string) {
  const vals = (r.series ?? []).map((v) => (v == null ? null : (v - r.min) / (r.max - r.min)));
  const pts = vals.map((v, i) => (v == null ? null : [8 + (i * 128) / Math.max(1, vals.length - 1), 108 - Math.max(0, Math.min(1, v)) * 58]));
  const line = pts.filter(Boolean).map((p, i) => `${i ? "L" : "M"}${p![0].toFixed(1)} ${p![1].toFixed(1)}`).join(" ");
  const value = r.value == null ? "—" : Math.round(r.value).toString();
  const first = pts.find(Boolean);
  const last = [...pts].reverse().find(Boolean);
  return frame(
    `<text x="72" y="42" text-anchor="middle" ${FONT} font-size="34" font-weight="700" fill="#fff">${value}<tspan font-size="16" fill="#bbb" dx="1">${esc(r.unit)}</tspan></text>
${line && first && last ? `<path d="${line} L${last[0]} 110 L${first[0]} 110 Z" fill="${r.color}" fill-opacity=".22"/><path d="${line}" fill="none" stroke="${r.color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>` : `<line x1="8" y1="108" x2="136" y2="108" stroke="#262626" stroke-width="3"/>`}`,
    label || r.label,
  );
}

/** Two concentric arcs: CPU outside, GPU inside. */
function duo(a: Reading, b: Reading, label: string) {
  const fa = a.value == null ? 0 : (a.value - a.min) / (a.max - a.min);
  const fb = b.value == null ? 0 : (b.value - b.min) / (b.max - b.min);
  const v = (r: Reading) => (r.value == null ? "—" : Math.round(r.value) + r.unit);
  return frame(
    `<path d="${arc(72, 62, 50, 1)}" fill="none" stroke="#262626" stroke-width="9" stroke-linecap="round"/>
${a.value == null ? "" : `<path d="${arc(72, 62, 50, fa)}" fill="none" stroke="${a.color}" stroke-width="9" stroke-linecap="round"/>`}
<path d="${arc(72, 62, 37, 1)}" fill="none" stroke="#262626" stroke-width="9" stroke-linecap="round"/>
${b.value == null ? "" : `<path d="${arc(72, 62, 37, fb)}" fill="none" stroke="${b.color}" stroke-width="9" stroke-linecap="round"/>`}
<text x="72" y="60" text-anchor="middle" ${FONT} font-size="19" font-weight="700" fill="${a.color}">${v(a)}</text>
<text x="72" y="81" text-anchor="middle" ${FONT} font-size="19" font-weight="700" fill="${b.color}">${v(b)}</text>`,
    label,
  );
}

function offline(label: string) {
  return frame(
    `<path d="${arc(72, 62, 46, 1)}" fill="none" stroke="#1c1c1e" stroke-width="11" stroke-linecap="round"/>
<text x="72" y="60" text-anchor="middle" ${FONT} font-size="15" font-weight="700" fill="#8e8e93">${tx.open}</text>
<text x="72" y="79" text-anchor="middle" ${FONT} font-size="15" font-weight="700" fill="#8e8e93">KMONITOR</text>`,
    label,
  );
}

export function render(settings: Settings, s: Stats | null): string {
  const metric = settings.metric ?? "cpu";
  const label = settings.label?.trim() ?? "";
  if (!s) return offline(label || (metric === "duo" ? "CPU · GPU" : metric === "temps" ? "TEMPS" : reading(metric, fallback).label));
  if (metric === "duo") return duo(reading("cpu", s), reading("gpu", s), label || "CPU · GPU");
  if (metric === "temps") {
    const c = reading("cputemp", s);
    const g = reading("gputemp", s);
    return duo({ ...c, color: c.value == null ? "#555" : CYAN }, { ...g, color: GPU }, label || "TEMPS");
  }
  const r = reading(metric, s);
  return settings.style === "graph" && r.series ? graph(r, label) : gauge(r, label);
}

const fallback: Stats = {
  cpu: { name: "", usage: 0, temp: null, power: null, mhz: 0 },
  gpu: { name: "", usage: 0, temp: null, power: null, powerLimit: null, clock: null, vramUsed: 0, vramTotal: 0 },
  mem: { used: 0, total: 1 },
  history: { cpu: [], gpu: [], mem: [], cpuTemp: [], gpuTemp: [] },
};
