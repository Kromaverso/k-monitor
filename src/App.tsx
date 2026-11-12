import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LuActivity, LuLayers, LuListTree, LuPanelBottomOpen, LuSettings2, LuComputer, LuZap } from "react-icons/lu";
import { api, loadColor, mainGpu, useMonitor } from "./api";
import { Meter } from "./components/ui";
import { t } from "./i18n";
import Overview from "./pages/Overview";
import Processes from "./pages/Processes";
import Categories from "./pages/Categories";
import System from "./pages/System";
import Settings from "./pages/Settings";
import Energy from "./pages/Energy";

const PAGES = [
  ["overview", "Visão geral", LuActivity],
  ["processes", "Processos", LuListTree],
  ["categories", "Categorias", LuLayers],
  ["energy", "Consumo", LuZap],
  ["system", "Meu PC", LuComputer],
  ["settings", "Ajustes", LuSettings2],
] as const;
type Page = (typeof PAGES)[number][0];

export default function App() {
  const m = useMonitor();
  // ?capture=<page> opens a given page (README screenshots).
  const [page, setPage] = useState<Page>(() => {
    const c = new URLSearchParams(location.search).get("capture");
    return (PAGES.find(([id]) => id === c)?.[0] ?? "overview") as Page;
  });
  const [toast, setToast] = useState<string | null>(null);
  const win = getCurrentWindow();
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3200); return () => clearTimeout(t); }, [toast]);
  // Maximize and restore use different glyphs, like native Windows title bars.
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    win.isMaximized().then(setMaximized);
    const un = win.onResized(() => win.isMaximized().then(setMaximized));
    return () => { un.then((u) => u()); };
  }, []);

  const s = m.snap;
  const g = mainGpu(s);
  const memPct = s && s.mem.total ? (s.mem.used * 100) / s.mem.total : 0;

  return (
    <div className="app">
      <div className="ambient" />
      <header className="titlebar" data-tauri-drag-region>
        <img src="/icon.png" alt="" data-tauri-drag-region />
        <b data-tauri-drag-region>kMonitor</b>
        <span className="sub" data-tauri-drag-region>{s?.cpu.name}</span>
        <span style={{ flex: 1 }} data-tauri-drag-region />
        <button className="wc" aria-label={t("Mini monitor")} title={t("Mini monitor (clique no ícone da bandeja)")} onClick={() => { api.showMini(); win.hide(); }}>
          <LuPanelBottomOpen size={15} />
        </button>
        {/* Segoe Fluent Icons: the same glyphs Windows 11 draws on native title bars. */}
        <button className="wc" aria-label={t("Minimizar")} title={t("Minimizar")} onClick={() => win.minimize()}><span className="glyph">{""}</span></button>
        <button className="wc" aria-label={maximized ? t("Restaurar") : t("Maximizar")} title={maximized ? t("Restaurar") : t("Maximizar")} onClick={() => win.toggleMaximize()}>
          <span className="glyph">{maximized ? "" : ""}</span>
        </button>
        <button className="wc close" aria-label={t("Fechar para a bandeja")} title={t("Fechar")} onClick={() => win.close()}><span className="glyph">{""}</span></button>
      </header>
      <div className="shell">
        <nav className="nav">
          {PAGES.map(([id, label, Icon]) => (
            <button key={id} className={page === id ? "on" : ""} onClick={() => setPage(id)}>
              <Icon size={17} /> {t(label)}
            </button>
          ))}
          <span className="push" />
          {s && (
            <div className="nav-mini num">
              <div>CPU <Meter thin value={s.cpu.usage} color={loadColor(s.cpu.usage, "var(--cpu)")} /><b>{Math.round(s.cpu.usage)}%</b></div>
              <div>GPU <Meter thin value={g?.usage ?? 0} color={loadColor(g?.usage ?? 0, "var(--gpu)")} /><b>{Math.round(g?.usage ?? 0)}%</b></div>
              <div>RAM <Meter thin value={memPct} color={loadColor(memPct, "var(--mem)")} /><b>{Math.round(memPct)}%</b></div>
            </div>
          )}
        </nav>
        <main className="main">
          {page === "overview" && <Overview m={m} go={setPage} />}
          {page === "processes" && <Processes m={m} say={setToast} />}
          {page === "categories" && <Categories m={m} />}
          {page === "energy" && <Energy m={m} />}
          {page === "system" && <System m={m} />}
          {page === "settings" && <Settings m={m} />}
        </main>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export type Monitor = ReturnType<typeof useMonitor>;
export { api };
