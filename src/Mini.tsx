import { getCurrentWindow } from "@tauri-apps/api/window";
import { LuMaximize2, LuPin, LuPinOff, LuX } from "react-icons/lu";
import { api, catOf, fmt, loadColor, mainGpu, tempColor, useMonitor } from "./api";
import { Area, CatIcon, Meter, Ring } from "./components/ui";
import { t } from "./i18n";

/** The compact view: opens from the tray, or stays pinned as a floating widget. */
export default function Mini() {
  const m = useMonitor();
  const s = m.snap;
  const g = mainGpu(s);
  const pinned = !!m.settings?.miniPinned;
  const memPct = s && s.mem.total ? (s.mem.used * 100) / s.mem.total : 0;
  const hist = m.hist.slice(-60);
  const cats = (s?.groups ?? []).filter((x) => x.cpu + x.gpu > 0.05).slice(0, 5);
  const drag = (e: React.MouseEvent) => { if (pinned && e.button === 0) getCurrentWindow().startDragging(); };

  return (
    <div className="mini">
      <div className="ambient" />
      <div className="mini-head">
        <img src="/icon.png" alt="" onMouseDown={drag} />
        <b onMouseDown={drag}>kMonitor</b>
        <span className="push" onMouseDown={drag} />
        <button className={pinned ? "on" : ""} title={pinned ? t("Soltar da tela") : t("Fixar na tela")} aria-label={t("Fixar na tela")}
          onClick={() => m.settings && m.setSettings({ ...m.settings, miniPinned: !pinned })}>
          {pinned ? <LuPinOff size={14} /> : <LuPin size={14} />}
        </button>
        <button title={t("Abrir o kMonitor")} aria-label={t("Abrir o kMonitor")} onClick={() => { api.openMain(); if (!pinned) api.hideMini(); }}><LuMaximize2 size={13} /></button>
        <button title={t("Fechar")} aria-label={t("Fechar")} onClick={() => api.hideMini()}><LuX size={15} /></button>
      </div>

      <div className="mini-rings num">
        <div className="mini-ring">
          <Ring value={s?.cpu.usage ?? 0} color={loadColor(s?.cpu.usage ?? 0, "var(--cpu)")} size={86} stroke={8}><b>{Math.round(s?.cpu.usage ?? 0)}</b><small>%</small></Ring>
          <span style={{ color: "var(--cpu)" }}>CPU</span>
          <small style={{ color: tempColor(s?.cpu.temp, "var(--muted)") }}>{s?.cpu.temp != null ? fmt.temp(s.cpu.temp) : fmt.ghz(s?.cpu.mhz)}</small>
        </div>
        <div className="mini-ring">
          <Ring value={g?.usage ?? 0} color={loadColor(g?.usage ?? 0, "var(--gpu)")} size={86} stroke={8}><b>{Math.round(g?.usage ?? 0)}</b><small>%</small></Ring>
          <span style={{ color: "var(--gpu)" }}>GPU</span>
          <small style={{ color: tempColor(g?.temp, "var(--muted)") }}>{fmt.temp(g?.temp)} · {fmt.watts(g?.power)}</small>
        </div>
        <div className="mini-ring">
          <Ring value={memPct} color={loadColor(memPct, "var(--mem)")} size={86} stroke={8}><b>{Math.round(memPct)}</b><small>%</small></Ring>
          <span style={{ color: "var(--mem)" }}>RAM</span>
          <small>{s ? `${(s.mem.used / 1073741824).toFixed(1)} / ${Math.round(s.mem.total / 1073741824)} GB` : "—"}</small>
        </div>
      </div>

      <div className="mini-card">
        <div className="legend">
          <span><i style={{ background: "var(--cpu)" }} />CPU</span>
          <span><i style={{ background: "var(--gpu)" }} />GPU</span>
          <span className="faint" style={{ marginLeft: "auto" }}>VRAM {g ? `${fmt.bytes(g.vramUsed)} / ${fmt.bytes(g.vramTotal, 0)}` : "—"}</span>
        </div>
        <Area height={62} series={[{ values: hist.map((p) => p.gpu), color: "#30d158" }, { values: hist.map((p) => p.cpu), color: "#64d2ff" }]} />
      </div>

      <div className="mini-card mini-cats num" style={{ flex: 1 }}>
        {cats.map((x) => {
          const c = catOf(m.categories, x.id);
          return (
            <div className="mini-cat" key={x.id}>
              <CatIcon cat={c} size={22} />
              <div className="n"><b>{t(c.name)}</b><Meter thin value={Math.min(100, x.cpu * 2)} color={c.color} /></div>
              <span className="v"><b>{x.cpu.toFixed(1)}%</b></span>
              <span className="v">{x.gpu.toFixed(0)}% <small className="faint">G</small></span>
            </div>
          );
        })}
        {!cats.length && <div className="faint" style={{ textAlign: "center", fontSize: 12 }}>{t("Tudo tranquilo por aqui.")}</div>}
      </div>

      <div className="mini-foot num">
        <span>{fmt.ghz(s?.cpu.mhz)}</span>
        <span>GPU {fmt.mhz(g?.clock)}</span>
        <span>{t("Ventoinha")} {fmt.pct(g?.fan)}</span>
      </div>
    </div>
  );
}
