// Capture mode: runs the UI in a plain browser with sample data, for README screenshots.
// Loaded only outside Tauri with ?capture in the URL (see main.tsx). Nothing here ships to users' data.

type Any = Record<string, unknown>;

const now = Date.now();
const wave = (i: number, base: number, amp: number, f: number) => Math.max(0, base + amp * Math.sin(i / f) + amp * 0.5 * Math.sin(i / (f * 0.37)));

const categories = [
  ["unreal", "Unreal Engine", "#0a84ff", "unreal"], ["unity", "Unity", "#e5e7eb", "unity"], ["godot", "Godot", "#60a5fa", "godot"],
  ["blender", "Blender", "#fb923c", "blender"], ["design", "Design & Criação", "#ff375f", "palette"], ["adobe", "Adobe", "#f87171", "adobe"],
  ["ai", "IA & Assistentes", "#fbbf24", "ai"], ["dev", "Desenvolvimento", "#34d399", "dev"], ["browsers", "Navegadores", "#38bdf8", "browser"],
  ["productivity", "Produtividade", "#ffd60a", "shapes"], ["comms", "Comunicação", "#5ac8fa", "chat"], ["media", "Mídia & Streaming", "#f472b6", "media"],
  ["launchers", "Lojas de jogos", "#94a3b8", "store"], ["games", "Jogos", "#4ade80", "game"], ["drivers", "Drivers & Utilitários", "#a3a3a3", "chip"],
  ["system", "Windows", "#64748b", "windows"],
].map(([id, name, color, icon]) => ({ id, name, color, icon, patterns: id === "unreal" ? ["unreal*", "shadercompileworker*", "\\engine\\binaries\\"] : id === "browsers" ? ["chrome", "msedge", "firefox"] : [`${id}*`] }));

const procs: [string, string, number, number, number, number][] = [
  // name, category, cpu %, gpu %, memory MB, vram MB
  ["UnrealEditor", "unreal", 18.4, 61, 9800, 6900], ["ShaderCompileWorker", "unreal", 6.1, 0, 420, 0], ["ShaderCompileWorker", "unreal", 5.8, 0, 410, 0],
  ["ShaderCompileWorker", "unreal", 5.2, 0, 398, 0], ["UnrealTraceServer", "unreal", 0.4, 0, 120, 0], ["zenserver", "unreal", 1.1, 0, 640, 0],
  ["chrome", "browsers", 2.1, 1.5, 1450, 210], ["chrome", "browsers", 0.8, 0, 610, 0], ["chrome", "browsers", 0.4, 0, 380, 0], ["msedgewebview2", "browsers", 0.2, 0, 220, 0],
  ["Code", "dev", 1.6, 0.4, 980, 60], ["node", "dev", 0.9, 0, 310, 0], ["rust-analyzer", "dev", 0.6, 0, 1200, 0], ["WindowsTerminal", "dev", 0.2, 0.3, 140, 30],
  ["Discord", "comms", 0.7, 0.6, 520, 90], ["Slack", "comms", 0.3, 0, 410, 0], ["Spotify", "media", 0.5, 0.2, 380, 40], ["obs64", "media", 1.8, 4.5, 690, 380],
  ["Figma", "design", 1.2, 2.1, 1900, 260], ["Notion", "productivity", 0.4, 0, 560, 0], ["Claude", "ai", 0.6, 0.2, 700, 50],
  ["steam", "launchers", 0.2, 0, 210, 0], ["steamwebhelper", "launchers", 0.3, 0, 330, 0], ["nvcontainer", "drivers", 0.1, 0, 140, 0],
  ["kMonitor", "drivers", 0.3, 0.1, 82, 12], ["dwm", "system", 1.0, 3.2, 180, 520], ["explorer", "system", 0.4, 0.3, 260, 40], ["svchost", "system", 0.6, 0, 820, 0],
  ["MsMpEng", "system", 0.5, 0, 310, 0], ["Spooler", "other", 0, 0, 30, 0], ["PowerToys", "other", 0.2, 0, 160, 0],
];

function snapshot(): Any {
  const list = procs.map(([name, cat, cpu, gpu, mem, vram], i) => ({ pid: 1000 + i * 37, name, exe: "", cpu, gpu, mem: mem * 1048576, vram: vram * 1048576, cat }));
  const groups = new Map<string, Any & { cpu: number; gpu: number; mem: number; vram: number; count: number }>();
  for (const p of list) {
    const g = groups.get(p.cat) ?? { id: p.cat, cpu: 0, gpu: 0, mem: 0, vram: 0, count: 0 };
    g.cpu += p.cpu; g.gpu += p.gpu; g.mem += p.mem; g.vram += p.vram; g.count += 1;
    groups.set(p.cat, g);
  }
  const cores = Array.from({ length: 32 }, (_, i) => Math.round(wave(i * 3.1, i % 8 === 0 ? 68 : 34, 22, 2.3)));
  const usage = cores.reduce((a, b) => a + b, 0) / cores.length;
  return {
    t: now,
    cpu: { name: "AMD Ryzen 9 9950X3D 16-Core Processor", usage, cores, mhz: 5320, baseMhz: 4300, threads: 32, physical: 16, temp: 71.5, power: 142, ccdTemps: [69.8, 64.1], tempStatus: "ok" },
    mem: { used: 38.6e9, total: 66.19e9, swapUsed: 6.2e9, swapTotal: 18e9 },
    gpus: [
      { name: "NVIDIA GeForce RTX 5070 Ti", usage: 64, vramUsed: 11.8e9, vramTotal: 16.77e9, temp: 63, power: 214, powerLimit: 300, clock: 2805, memClock: 13801, fan: 46, engines: [["3D", 64], ["Compute", 21], ["Copy", 6], ["VideoEncode", 4]] },
      { name: "AMD Radeon(TM) Graphics", usage: 1, vramUsed: 0.3e9, vramTotal: 2.1e9, temp: null, power: null, powerLimit: null, clock: null, memClock: null, fan: null, engines: [] },
    ],
    groups: [...groups.values()].sort((a, b) => b.cpu + b.gpu - (a.cpu + a.gpu)),
    procs: list,
    peak: { cpu: 92, gpu: 99, cpuTemp: 84, gpuTemp: 71, gpuPower: 288, mem: 41e9 },
    power: { cpu: 142, cpuMeasured: true, gpu: 214, rest: 55, monitor: 0, wall: 457 },
  };
}

const history = Array.from({ length: 300 }, (_, i) => ({
  t: now - (300 - i) * 1000,
  cpu: wave(i, 36, 14, 9), gpu: wave(i + 40, 55, 20, 13), mem: 57 + 2 * Math.sin(i / 50),
  cpuTemp: wave(i, 66, 5, 11), gpuTemp: wave(i, 60, 4, 17),
}));

function energy(): Any {
  const days: [string, Any][] = [];
  const d0 = new Date();
  for (let i = 0; i < 40; i++) {
    const d = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() - i);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const wh = i === 0 ? 3100 : 3000 + 2600 * Math.abs(Math.sin(i * 1.7)) + (d.getDay() % 6 === 0 ? 1800 : 0);
    days.push([k, { wh, cpu: wh * 0.31, gpu: wh * 0.42, rest: wh * 0.27, secs: 3600 * (12 + (i % 7)) }]);
  }
  const t = days[0][0];
  const hours: [string, Any][] = Array.from({ length: 24 }, (_, h) => {
    const wh = h < 8 ? 120 + 20 * (h % 3) : h <= new Date().getHours() ? 260 + 190 * Math.abs(Math.sin(h / 2.4)) : 0;
    return [`${t} ${String(h).padStart(2, "0")}`, { wh, cpu: wh * 0.3, gpu: wh * 0.45, rest: wh * 0.25, secs: 3600 }] as [string, Any];
  }).filter(([, b]) => (b.wh as number) > 0);
  const cats = { __base: 41000, unreal: 38500, games: 21000, browsers: 6200, dev: 4100, media: 2600, design: 2100, comms: 900 };
  return { days, hours, monthCategories: cats, todayCategories: Object.fromEntries(Object.entries(cats).map(([k, v]) => [k, v / 11])) };
}

export const specs = {
  computer: { name: "DESKTOP", maker: "ASUS", model: "System Product Name" },
  os: { name: "Microsoft Windows 11 Pro", version: "24H2", build: "26100.4061", arch: "64-bit", installed: "2025-03-14", boot: "2026-11-01 08:30" },
  cpu: { name: "AMD Ryzen 9 9950X3D 16-Core Processor", maker: "AuthenticAMD", cores: 16, threads: 32, maxMhz: 4300, l2Kb: 16384, l3Kb: 131072, socket: "AM5", virtualization: true },
  board: { maker: "ASUSTeK COMPUTER INC.", product: "TUF GAMING X870-PLUS WIFI", version: "Rev 1.xx", bios: "American Megatrends Inc. 1203", biosDate: "2026-02-20" },
  ram: [
    { slot: "DIMM 1", bank: "P0 CHANNEL A", maker: "Kingston", part: "KF564C32BBK2-64", bytes: 34359738368, mhz: 6400, configuredMhz: 6400, volts: 1350, type: 34 },
    { slot: "DIMM 1", bank: "P0 CHANNEL B", maker: "Kingston", part: "KF564C32BBK2-64", bytes: 34359738368, mhz: 6400, configuredMhz: 6400, volts: 1350, type: 34 },
  ],
  ramSlots: 4,
  gpus: [
    { name: "NVIDIA GeForce RTX 5070 Ti", maker: "NVIDIA", driver: "32.0.15.7680", driverDate: "2026-08-04", vram: 17179869184, mode: "3440x1440 @ 175 Hz" },
    { name: "AMD Radeon(TM) Graphics", maker: "Advanced Micro Devices, Inc.", driver: "32.0.12011.1036", driverDate: "2026-07-22", vram: 2147483648, mode: "1920x1080 @ 60 Hz" },
  ],
  disks: [
    { name: "Samsung SSD 990 PRO", media: "SSD", bus: "NVMe", bytes: 2000398934016, health: "Healthy" },
    { name: "WD_BLACK SN850X", media: "SSD", bus: "NVMe", bytes: 2000398934016, health: "Healthy" },
  ],
  volumes: [
    { letter: "C:", label: "Windows", fs: "NTFS", bytes: 2000396169216, free: 812e9 },
    { letter: "D:", label: "Projects", fs: "NTFS", bytes: 2000396169216, free: 1310e9 },
  ],
  displays: [{ name: "LG ULTRAGEAR", maker: "GSM", year: 2023 }, { name: "DELL U2723QE", maker: "DEL", year: 2022 }],
  network: [{ name: "Ethernet", desc: "Ethernet 2.5GbE", speed: "2.5 Gbps" }],
};

export function installCaptureMocks(lang: string) {
  const settings = {
    intervalMs: 1000, trayStyle: "bars", logCsv: false, miniPinned: true, miniPos: null, apiEnabled: true,
    tariff: 0.78938, taxPct: 23, flag: "verde", baseWatts: 55, psuEff: 0.9, monitorWatts: 0, location: "São Paulo, SP · Enel SP", language: lang,
  };
  const reply: Record<string, () => unknown> = {
    initial: () => ({ snapshot: snapshot(), history, settings, categories, autostart: true, apiPort: 47615, elevated: true, adminMode: true, pawnio: true }),
    energy_report: energy,
    hardware_specs: () => specs,
  };
  let cb = 0;
  (window as unknown as Any).__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
    transformCallback: () => ++cb,
    unregisterCallback: () => {},
    invoke: async (cmd: string) => (reply[cmd] ? reply[cmd]() : cmd.startsWith("plugin:window|is_") ? false : null),
    convertFileSrc: (p: string) => p,
  };
  (window as unknown as Any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  document.documentElement.classList.add("capture");
}
