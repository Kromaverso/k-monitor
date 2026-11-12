// Shareable version of the hardware specs: plain text and a 1200x675 image card.
// Leaves out anything personal (computer name, network, serials).

import { arr, Specs } from "./api";
import { locale, t } from "./i18n";

const RAM_TYPES: Record<number, string> = { 20: "DDR", 21: "DDR2", 24: "DDR3", 26: "DDR4", 30: "LPDDR4", 34: "DDR5", 35: "LPDDR5" };

const clean = (s?: string | null) => (s ?? "").replace(/\(R\)|\(TM\)|®|™/gi, "").replace(/\s+/g, " ").trim();
/** Friendlier vendor names than what the firmware reports. */
const VENDORS: [RegExp, string][] = [
  [/^ASUSTeK( COMPUTER)?( INC\.?)?/i, "ASUS"], [/^Micro-Star International( Co\., Ltd\.?)?/i, "MSI"], [/^Gigabyte Technology( Co\., Ltd\.?)?/i, "Gigabyte"],
  [/^ASRock(\s+Incorporation)?/i, "ASRock"], [/^G ?Skill( Intl)?/i, "G.Skill"], [/^Kingston\b.*/i, "Kingston"], [/^Corsair\b.*/i, "Corsair"],
  [/^Samsung\b.*/i, "Samsung"], [/^SK ?Hynix\b.*/i, "SK hynix"], [/^Micron\b.*/i, "Micron"],
];
const vendor = (s?: string | null) => {
  const c = clean(s);
  for (const [re, name] of VENDORS) if (re.test(c)) return c.replace(re, name).trim();
  return c;
};
const gb = (b: number) => `${Math.round(b / 1073741824)} GB`;
const tb = (b: number) => (b >= 1e12 ? `${(Math.round(b / 1e11) / 10).toLocaleString(locale())} TB` : `${Math.round(b / 1e9)} GB`);

export type Line = { key: string; label: string; value: string; sub?: string; color: string };

/** The spec lines shown in both the text and the image. */
export function specLines(s: Specs): Line[] {
  const lines: Line[] = [];
  if (s.cpu) {
    const cpu = clean(s.cpu.name).replace(/\s*\d+-Core Processor$/i, "");
    lines.push({ key: "cpu", label: t("Processador"), value: cpu, sub: `${t("{c} núcleos · {t} threads", { c: s.cpu.cores, t: s.cpu.threads })}${s.cpu.l3Kb ? ` · ${Math.round(s.cpu.l3Kb / 1024)} MB L3` : ""}`, color: "#64d2ff" });
  }
  const gpus = arr(s.gpus).filter((g) => !/basic|virtual|parsec|meta|idd/i.test(g.name));
  // The discrete card first (most VRAM).
  gpus.sort((a, b) => (b.vram ?? 0) - (a.vram ?? 0));
  gpus.forEach((g, i) => {
    lines.push({ key: `gpu${i}`, label: i === 0 ? t("Placa de vídeo") : t("Vídeo integrado"), value: clean(g.name), sub: g.vram ? `${gb(g.vram)} VRAM` : undefined, color: i === 0 ? "#30d158" : "#8e8e93" });
  });
  const ram = arr(s.ram);
  if (ram.length) {
    const total = ram.reduce((a, r) => a + (r.bytes || 0), 0);
    const same = ram.every((r) => r.bytes === ram[0].bytes);
    const type = RAM_TYPES[ram[0].type ?? 0] ?? "";
    const speed = ram[0].configuredMhz || ram[0].mhz;
    const maker = vendor(ram[0].maker);
    lines.push({
      key: "ram", label: t("Memória"), value: `${gb(total)} ${type}`.trim(),
      sub: [same ? `${ram.length}×${gb(ram[0].bytes)}` : t("{n} pentes", { n: ram.length }), speed ? `${speed} MT/s` : "", maker && !/^unknown|^0+$/i.test(maker) ? maker : ""].filter(Boolean).join(" · "),
      color: "#d1d1d6",
    });
  }
  if (s.board?.product) {
    lines.push({ key: "board", label: t("Placa-mãe"), value: `${vendor(s.board.maker)} ${clean(s.board.product)}`.trim(), color: "#ff9f0a" });
  }
  const disks = arr(s.disks).filter((d) => d.bytes > 0 && !/usb/i.test(d.bus));
  if (disks.length) {
    const total = disks.reduce((a, d) => a + d.bytes, 0);
    lines.push({ key: "disks", label: t("Armazenamento"), value: t("{n} no total", { n: tb(total) }), sub: disks.map((d) => `${clean(d.name)} ${tb(d.bytes)}`).join(" · "), color: "#ffd60a" });
  }
  const displays = arr(s.displays).filter((d) => d.name);
  if (displays.length) {
    lines.push({ key: "displays", label: displays.length > 1 ? t("Monitores") : t("Monitor"), value: displays.map((d) => clean(d.name)).join(" · "), color: "#66d4cf" });
  }
  if (s.os) {
    lines.push({ key: "os", label: t("Sistema"), value: clean(s.os.name).replace(/^Microsoft /, ""), sub: s.os.version ? `${s.os.version}` : undefined, color: "#0a84ff" });
  }
  return lines;
}

export function specText(s: Specs): string {
  const lines = specLines(s).map((l) => `${l.label}: ${l.value}${l.sub ? ` (${l.sub})` : ""}`);
  return [t("Meu PC"), ...lines, "", t("via kMonitor")].join("\n");
}

const esc = (t: string) => t.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
/** Rough width so long values shrink instead of overflowing (Segoe UI averages ~0.53em). */
const fit = (text: string, max: number, size: number) => Math.min(size, Math.floor(max / Math.max(1, text.length * 0.53)));

/** The card as an SVG string (1200x675, a common social image size). */
export function specSvg(s: Specs, logo: string): string {
  const lines = specLines(s);
  const W = 1200, H = 675;
  const F = `font-family="Segoe UI Variable Display, Segoe UI, sans-serif"`;
  const top = 168;
  const rowH = Math.min(64, (H - top - 70) / Math.max(1, lines.length));
  const rows = lines.map((l, i) => {
    const y = top + i * rowH;
    const vSize = fit(l.value, 610, 26);
    return `
    <circle cx="96" cy="${y + 15}" r="6" fill="${l.color}"/>
    <text x="120" y="${y + 22}" ${F} font-size="17" font-weight="600" fill="#8e8e93" letter-spacing=".3">${esc(l.label.toUpperCase())}</text>
    <text x="360" y="${y + 23}" ${F} font-size="${vSize}" font-weight="700" fill="#f5f5f7">${esc(l.value)}</text>
    ${l.sub ? `<text x="360" y="${y + 47}" ${F} font-size="${fit(l.sub, 730, 16)}" font-weight="500" fill="#98989f">${esc(l.sub)}</text>` : ""}`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
  </defs>
  <rect width="${W}" height="${H}" fill="#16181d"/>
  <rect x="40" y="40" width="${W - 80}" height="${H - 80}" rx="32" fill="#ffffff" fill-opacity=".05" stroke="#ffffff" stroke-opacity=".12"/>
  <image href="${logo}" x="80" y="78" width="52" height="52"/>
  <text x="150" y="104" ${F} font-size="34" font-weight="800" fill="#f5f5f7" letter-spacing="-.5">${esc(t("Meu PC"))}</text>
  <text x="151" y="128" ${F} font-size="16" font-weight="500" fill="#8e8e93">${esc(t("Especificações"))}</text>
  <rect x="80" y="${top - 20}" width="${W - 160}" height="2" rx="1" fill="#ffffff" opacity=".12"/>
  ${rows.join("")}
  <text x="${W - 80}" y="${H - 64}" text-anchor="end" ${F} font-size="15" font-weight="600" fill="#636366">kMonitor</text>
</svg>`;
}

/** Renders the SVG card to a PNG blob at 2x for crisp text. */
export async function specPng(svg: string, scale = 2): Promise<Blob> {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.width * scale;
  c.height = img.height * scale;
  const ctx = c.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("não consegui gerar a imagem"))), "image/png"));
}

/** The app logo as a data URL, so the SVG stays self-contained when drawn to a canvas. */
export async function logoDataUrl(): Promise<string> {
  const b = await fetch("/icon.png").then((r) => r.blob());
  return new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.readAsDataURL(b);
  });
}

