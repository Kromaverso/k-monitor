import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { locale, resolveLang, setLang } from "./i18n";

export type Cpu = { name: string; usage: number; cores: number[]; mhz: number; baseMhz: number; threads: number; physical: number; temp: number | null; power: number | null; ccdTemps: number[]; tempStatus: "ok" | "noDriver" | "needsAdmin" | "unsupported" };
export type Mem = { used: number; total: number; swapUsed: number; swapTotal: number };
export type Gpu = {
  name: string; usage: number; vramUsed: number; vramTotal: number; temp: number | null; power: number | null; powerLimit: number | null;
  clock: number | null; memClock: number | null; fan: number | null; engines: [string, number][];
};
export type Proc = { pid: number; name: string; exe: string; cpu: number; mem: number; gpu: number; vram: number; cat: string };
export type Group = { id: string; cpu: number; mem: number; gpu: number; vram: number; count: number };
export type Peak = { cpu: number; gpu: number; cpuTemp: number; gpuTemp: number; gpuPower: number; mem: number };
export type Power = { cpu: number; cpuMeasured: boolean; gpu: number; rest: number; monitor: number; wall: number };
export type Snapshot = { t: number; cpu: Cpu; mem: Mem; gpus: Gpu[]; groups: Group[]; procs: Proc[]; peak: Peak; power: Power };
export type HistPoint = { t: number; cpu: number; gpu: number; mem: number; cpuTemp: number | null; gpuTemp: number | null };
export type Category = { id: string; name: string; color: string; icon: string; patterns: string[] };
export type Settings = {
  intervalMs: number; trayStyle: string; logCsv: boolean; miniPinned: boolean; miniPos: [number, number] | null; apiEnabled: boolean;
  tariff: number; taxPct: number; flag: string; baseWatts: number; psuEff: number; monitorWatts: number; location: string;
  /** "auto", "pt", "en" or "es". */
  language: string;
};
export type Bucket = { wh: number; cpu: number; gpu: number; rest: number; secs: number };
export type EnergyReport = {
  days: [string, Bucket][]; hours: [string, Bucket][];
  monthCategories: Record<string, number>; todayCategories: Record<string, number>;
};
type Initial = {
  snapshot: Snapshot | null; history: HistPoint[]; settings: Settings; categories: Category[]; autostart: boolean; apiPort: number;
  elevated: boolean; adminMode: boolean; pawnio: boolean;
};

export const OTHER: Category = { id: "other", name: "Outros apps", color: "#8e8e93", icon: "app", patterns: [] };

export const api = {
  initial: () => invoke<Initial>("initial"),
  setSettings: (settings: Settings) => invoke("set_settings", { settings }),
  setAutostart: (on: boolean) => invoke("set_autostart", { on }),
  saveCategories: (categories: Category[]) => invoke("save_categories", { categories }),
  resetCategories: () => invoke<Category[]>("reset_categories"),
  assignProcess: (name: string, category: string) => invoke<Category[]>("assign_process", { name, category }),
  endProcesses: (pids: number[]) => invoke<number>("end_processes", { pids }),
  reveal: (path: string) => invoke("reveal", { path }),
  specs: (force = false) => invoke<Specs>("hardware_specs", { force }),
  openMain: () => invoke("open_main"),
  showMini: () => invoke("show_mini"),
  hideMini: () => invoke("hide_mini"),
  openLogs: () => invoke("open_logs"),
  quit: () => invoke("quit"),
  energy: () => invoke<EnergyReport>("energy_report"),
  exportEnergy: () => invoke<string>("export_energy"),
  savePng: (bytes: Uint8Array, name: string) => invoke<string>("save_png", { bytes: Array.from(bytes), name }),
  enableCpuSensors: () => invoke("enable_cpu_sensors"),
  disableAdminMode: () => invoke<boolean>("disable_admin_mode"),
  openUrl: (url: string) => invoke("open_url", { url }),
};

const HISTORY = 300;

/** Live data: the latest snapshot plus a rolling history, shared by both windows. */
export function useMonitor() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [hist, setHist] = useState<HistPoint[]>([]);
  const [settings, setSettingsState] = useState<Settings | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [autostart, setAutostartState] = useState(false);
  const [apiPort, setApiPort] = useState(0);
  const [sys, setSys] = useState({ elevated: false, adminMode: false, pawnio: false });

  useEffect(() => {
    let alive = true;
    api.initial().then((i) => {
      if (!alive) return;
      if (i.snapshot) setSnap(i.snapshot);
      setHist(i.history);
      setSettingsState(i.settings);
      setCategories(i.categories);
      setAutostartState(i.autostart);
      setApiPort(i.apiPort);
      setSys({ elevated: i.elevated, adminMode: i.adminMode, pawnio: i.pawnio });
    });
    // The other window (main or mini) changed a setting, such as the language.
    const unSettings = listen<Settings>("settings", (e) => setSettingsState(e.payload));
    const un = listen<Snapshot>("snapshot", (e) => {
      const s = e.payload;
      setSnap(s);
      const g = mainGpu(s);
      setHist((h) => {
        if (h.length && h[h.length - 1].t >= s.t) return h;
        const p: HistPoint = { t: s.t, cpu: s.cpu.usage, gpu: g?.usage ?? 0, mem: s.mem.total ? (s.mem.used * 100) / s.mem.total : 0, cpuTemp: s.cpu.temp, gpuTemp: g?.temp ?? null };
        return [...h.slice(-(HISTORY - 1)), p];
      });
    });
    return () => { alive = false; un.then((u) => u()); unSettings.then((u) => u()); };
  }, []);

  // Set before the children render, so every t() in this pass uses the chosen language.
  setLang(resolveLang(settings?.language));

  const setSettings = (s: Settings) => { setSettingsState(s); api.setSettings(s); };
  const setAutostart = (on: boolean) => { setAutostartState(on); api.setAutostart(on).catch(() => setAutostartState(!on)); };
  return { snap, hist, settings, setSettings, categories, setCategories, autostart, setAutostart, apiPort, sys };
}

export function mainGpu(s: Snapshot | null): Gpu | undefined {
  if (!s?.gpus.length) return undefined;
  return [...s.gpus].sort((a, b) => b.vramTotal - a.vramTotal)[0];
}

export function catOf(cats: Category[], id: string): Category {
  return cats.find((c) => c.id === id) ?? OTHER;
}

export const fmt = {
  pct: (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v)}%`),
  bytes: (b: number, digits = 1) => {
    if (!b) return "0 B";
    const u = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
    const v = b / 1024 ** i;
    return `${v.toFixed(i >= 3 ? digits : 0)} ${u[i]}`;
  },
  ghz: (mhz: number | null | undefined) => (mhz ? `${(mhz / 1000).toFixed(2)} GHz` : "—"),
  mhz: (mhz: number | null | undefined) => (mhz ? `${mhz} MHz` : "—"),
  temp: (c: number | null | undefined) => (c == null ? "—" : `${Math.round(c)}°C`),
  watts: (w: number | null | undefined) => (w == null ? "—" : `${Math.round(w)} W`),
};

/** Load colour: calm under 60%, amber under 85%, red above. */
export function loadColor(v: number, base: string) {
  return v >= 85 ? "var(--hot)" : v >= 60 ? "var(--warn)" : base;
}
export function tempColor(c: number | null | undefined, base: string) {
  if (c == null) return base;
  return c >= 85 ? "var(--hot)" : c >= 72 ? "var(--warn)" : base;
}

export type Specs = {
  computer?: { name: string; maker: string; model: string };
  os?: { name: string; version: string; build: string; arch: string; installed: string; boot: string };
  cpu?: { name: string; maker: string; cores: number; threads: number; maxMhz: number; l2Kb: number; l3Kb: number; socket: string; virtualization: boolean };
  board?: { maker: string; product: string; version: string; bios: string; biosDate: string };
  ram?: { slot: string; bank: string; maker: string; part: string; bytes: number; mhz: number; configuredMhz: number; volts: number; type?: number }[];
  ramSlots?: number;
  gpus?: { name: string; maker: string; driver: string; driverDate: string; vram: number | null; mode: string }[];
  disks?: { name: string; media: string; bus: string; bytes: number; health: string }[];
  volumes?: { letter: string; label: string; fs: string; bytes: number; free: number }[];
  displays?: { name: string; maker: string; year: number }[];
  network?: { name: string; desc: string; speed: string }[];
};

/** PowerShell turns single-element arrays into objects; this undoes that. */
export function arr<T>(v: T[] | T | undefined | null): T[] {
  return v == null ? [] : Array.isArray(v) ? v : [v];
}

/** Bandeiras tarifárias (ANEEL), extra in R$ per kWh. */
export const FLAGS: [string, string, number][] = [
  ["verde", "Verde", 0],
  ["amarela", "Amarela", 0.01885],
  ["vermelha1", "Vermelha 1", 0.04463],
  ["vermelha2", "Vermelha 2", 0.07877],
];

/** Final R$/kWh: (tariff + flag) grossed up by ICMS + PIS/COFINS, which Brazil charges "por dentro". */
export function pricePerKwh(s: Settings) {
  const flag = FLAGS.find((f) => f[0] === s.flag)?.[2] ?? 0;
  return (s.tariff + flag) / (1 - Math.min(60, Math.max(0, s.taxPct)) / 100);
}

export const brl = (v: number) => v.toLocaleString(locale(), { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 3 : 2 });
export const kwh = (wh: number) =>
  wh < 1000 ? `${Math.round(wh)} Wh` : `${(wh / 1000).toLocaleString(locale(), { maximumFractionDigits: wh < 10000 ? 2 : 1 })} kWh`;
