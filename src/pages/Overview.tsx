import { useMemo } from "react";
import { LuChevronRight } from "react-icons/lu";
import { catOf, fmt, loadColor, mainGpu, tempColor } from "../api";
import { Area, CatIcon, Meter, Ring, Stat } from "../components/ui";
import { locale, plural, t } from "../i18n";
import type { Monitor } from "../App";

export default function Overview({ m, go }: { m: Monitor; go: (p: "processes" | "categories" | "settings") => void }) {
  const s = m.snap;
  const g = mainGpu(s);
  const hist = m.hist.slice(-120);
  const memPct = s && s.mem.total ? (s.mem.used * 100) / s.mem.total : 0;
  const groups = useMemo(() => (s?.groups ?? []).filter((x) => x.cpu + x.gpu > 0.05 || x.mem > 200e6).slice(0, 7), [s]);

  if (!s) return <div className="page"><div className="empty">{t("Coletando dados…")}</div></div>;

  const cpuColor = loadColor(s.cpu.usage, "var(--cpu)");
  const gpuColor = loadColor(g?.usage ?? 0, "var(--gpu)");
  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>{t("Visão geral")}</h1>
          <p>{t("Atualiza a cada {s} s · picos desde que o kMonitor abriu", { s: ((m.settings?.intervalMs ?? 1000) / 1000).toLocaleString(locale()) })}</p>
        </div>
      </div>

      <div className="grid3">
        <section className="card hero-card">
          <h3><span className="chip-dot" style={{ background: "var(--cpu)" }} />{t("Processador")}<span className="right num">{fmt.ghz(s.cpu.mhz)}</span></h3>
          <div className="hero">
            <Ring size={104} stroke={10} value={s.cpu.usage} color={cpuColor}><b className="num">{Math.round(s.cpu.usage)}%</b><small>{t("uso")}</small></Ring>
            <div className="hero-text">
              <span className="name" title={s.cpu.name}>{s.cpu.name}</span>
              <div className="kv num">
                <span>{t("Núcleos")}</span><b>{s.cpu.physical} / {s.cpu.threads} threads</b>
                <span>{t("Temperatura")}</span>
                {s.cpu.temp != null || s.cpu.tempStatus === "unsupported"
                  ? <b style={{ color: tempColor(s.cpu.temp, "inherit") }} title={s.cpu.ccdTemps.length ? s.cpu.ccdTemps.map((v, i) => `CCD${i}: ${Math.round(v)}°C`).join(" · ") : undefined}>{fmt.temp(s.cpu.temp)}</b>
                  : <b><button className="inline-link" onClick={() => go("settings")}>{t("Ativar")}</button></b>}
                <span>{t("Energia")}</span><b>{s.cpu.power != null ? fmt.watts(s.cpu.power) : "—"}</b>
                <span>{t("Pico")}</span><b>{fmt.pct(s.peak.cpu)}</b>
              </div>
            </div>
          </div>
        </section>

        <section className="card hero-card">
          <h3><span className="chip-dot" style={{ background: "var(--gpu)" }} />{t("Placa de vídeo")}<span className="right num">{fmt.mhz(g?.clock)}</span></h3>
          <div className="hero">
            <Ring size={104} stroke={10} value={g?.usage ?? 0} color={gpuColor}><b className="num">{Math.round(g?.usage ?? 0)}%</b><small>{t("uso")}</small></Ring>
            <div className="hero-text">
              <span className="name" title={g?.name}>{g?.name ?? t("Nenhuma GPU encontrada")}</span>
              <div className="kv num">
                <span>{t("Temperatura")}</span><b style={{ color: tempColor(g?.temp, "inherit") }}>{fmt.temp(g?.temp)}</b>
                <span>{t("Energia")}</span><b title={g?.powerLimit ? t("limite {w} W", { w: Math.round(g.powerLimit) }) : undefined}>{fmt.watts(g?.power)}</b>
                <span>VRAM</span><b>{g ? `${fmt.bytes(g.vramUsed)} / ${fmt.bytes(g.vramTotal, 0)}` : "—"}</b>
              </div>
            </div>
          </div>
        </section>

        <section className="card hero-card">
          <h3><span className="chip-dot" style={{ background: "var(--mem)" }} />{t("Memória")}<span className="right num">{fmt.bytes(s.mem.total, 0)}</span></h3>
          <div className="hero">
            <Ring size={104} stroke={10} value={memPct} color={loadColor(memPct, "var(--mem)")}><b className="num">{Math.round(memPct)}%</b><small>{t("em uso")}</small></Ring>
            <div className="hero-text">
              <div className="kv num">
                <span>{t("Em uso")}</span><b>{fmt.bytes(s.mem.used)}</b>
                <span>{t("Livre")}</span><b>{fmt.bytes(s.mem.total - s.mem.used)}</b>
                <span>{t("Paginação")}</span><b>{fmt.bytes(s.mem.swapUsed)}</b>
                <span>{t("Pico")}</span><b>{fmt.bytes(s.peak.mem)}</b>
              </div>
            </div>
          </div>
        </section>
      </div>

      <section className="card">
        <h3>
          {t("Histórico · 2 min")}
          <span className="right legend">
            <span><i style={{ background: "var(--cpu)" }} />CPU</span>
            <span><i style={{ background: "var(--gpu)" }} />GPU</span>
            <span><i style={{ background: "var(--mem)" }} />RAM</span>
          </span>
        </h3>
        <Area height={150} series={[
          { values: hist.map((p) => p.mem), color: "#30d158" },
          { values: hist.map((p) => p.gpu), color: "#bf5af2" },
          { values: hist.map((p) => p.cpu), color: "#64d2ff" },
        ]} />
      </section>

      <div className="grid2">
        <section className="card">
          <h3>{t("Núcleos lógicos")}<span className="right num">{s.cpu.threads} threads</span></h3>
          <div className="cores num">
            {s.cpu.cores.map((v, i) => (
              <div className="core" key={i} title={`Thread ${i}: ${Math.round(v)}%`}>
                <i style={{ height: `${Math.max(3, v)}%`, background: loadColor(v, "linear-gradient(180deg, #64d2ff, #2f7fff)") }} />
                <span>{Math.round(v)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <h3>{g?.name ?? "GPU"}<span className="right">{t("motores")}</span></h3>
          <div className="stats num" style={{ marginBottom: 12 }}>
            <Stat label="Clock" value={fmt.mhz(g?.clock)} />
            <Stat label={t("Memória")} value={fmt.mhz(g?.memClock)} />
            <Stat label={t("Ventoinha")} value={fmt.pct(g?.fan)} />
            <Stat label={t("Pico temp.")} value={fmt.temp(s.peak.gpuTemp || null)} sub={t("pico {w}", { w: fmt.watts(s.peak.gpuPower || null) })} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(g?.engines.length ? g.engines : [["3D", 0] as [string, number]]).map(([name, v]) => (
              <div key={name} style={{ display: "grid", gridTemplateColumns: "92px 1fr 40px", alignItems: "center", gap: 10, fontSize: 12.5 }}>
                <span className="muted">{name}</span>
                <Meter value={v} color="var(--gpu)" />
                <b className="num" style={{ textAlign: "right", fontWeight: 600 }}>{Math.round(v)}%</b>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="card">
        <h3>
          {t("Quem está pesando agora")}
          <button className="right btn ghost" style={{ height: 26 }} onClick={() => go("processes")}>{t("Ver processos")} <LuChevronRight size={14} /></button>
        </h3>
        <div className="top-list num">
          {groups.map((x) => {
            const c = catOf(m.categories, x.id);
            return (
              <div className="top-row" key={x.id}>
                <CatIcon cat={c} />
                <div className="t"><b>{t(c.name)}</b><small>{plural(x.count, "{n} processo", "{n} processos")}</small></div>
                <div className="v" style={{ color: loadColor(x.cpu, "inherit") }}>{x.cpu.toFixed(1)}%<small>CPU</small></div>
                <div className="v" style={{ color: loadColor(x.gpu, "inherit") }}>{x.gpu.toFixed(0)}%<small>GPU</small></div>
                <div className="v">{fmt.bytes(x.mem)}<small>RAM</small></div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
