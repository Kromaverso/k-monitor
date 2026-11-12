import { useEffect, useMemo, useState } from "react";
import { LuDownload, LuInfo, LuMapPin, LuPlug, LuServer, LuZap } from "react-icons/lu";
import { api, brl, Bucket, catOf, EnergyReport, FLAGS, kwh, pricePerKwh } from "../api";
import { CatIcon, Segmented } from "../components/ui";
import { locale, t } from "../i18n";
import type { Monitor } from "../App";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const sum = (bs: Bucket[]) => bs.reduce((a, b) => ({ wh: a.wh + b.wh, cpu: a.cpu + b.cpu, gpu: a.gpu + b.gpu, rest: a.rest + b.rest, secs: a.secs + b.secs }), { wh: 0, cpu: 0, gpu: 0, rest: 0, secs: 0 });

function Bars({ items, height = 130, color, label }: { items: { key: string; value: number; tip: string; dim?: boolean }[]; height?: number; color: string; label: (k: string) => string }) {
  const max = Math.max(...items.map((i) => i.value), 0.0001);
  return (
    <div className="bars" style={{ height: height + 22 }}>
      {items.map((i) => (
        <div key={i.key} className="bar-col" title={i.tip}>
          <div className="bar-track" style={{ height }}>
            <i style={{ height: `${Math.max(i.value > 0 ? 3 : 0, (i.value / max) * 100)}%`, background: i.dim ? "var(--glass-3)" : color }} />
          </div>
          <span>{label(i.key)}</span>
        </div>
      ))}
    </div>
  );
}

function NumField({ label, value, onChange, step, suffix, hint }: { label: string; value: number; onChange: (v: number) => void; step: number; suffix: string; hint?: string }) {
  const [text, setText] = useState(String(value).replace(".", ","));
  useEffect(() => setText(String(value).replace(".", ",")), [value]);
  return (
    <div className="list-row">
      <div className="t"><b>{t(label)}</b>{hint && <small>{t(hint)}</small>}</div>
      <div className="num-field">
        <input
          className="input num" inputMode="decimal" value={text} step={step}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => { const v = Number(text.replace(",", ".")); if (Number.isFinite(v) && v >= 0) onChange(v); else setText(String(value)); }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        <span>{suffix}</span>
      </div>
    </div>
  );
}

export default function Energy({ m }: { m: Monitor }) {
  const [rep, setRep] = useState<EnergyReport | null>(null);
  const [catRange, setCatRange] = useState<"today" | "month">("month");
  const [exported, setExported] = useState<string | null>(null);
  useEffect(() => {
    const load = () => api.energy().then(setRep).catch(() => {});
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  const s = m.settings;
  const p = m.snap?.power;
  const price = s ? pricePerKwh(s) : 0;
  const set = (patch: Partial<NonNullable<typeof s>>) => s && m.setSettings({ ...s, ...patch });

  const data = useMemo(() => {
    const days = new Map(rep?.days ?? []);
    const t = today();
    const month = t.slice(0, 7);
    const monthDays = [...days.entries()].filter(([k]) => k.startsWith(month)).map(([, b]) => b);
    const monthSum = sum(monthDays);
    const now = new Date();
    const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    // Projection: average per logged day (today counts as the fraction already gone), times the days in the month.
    const fracToday = (now.getHours() * 60 + now.getMinutes()) / 1440;
    const loggedDays = monthDays.length - (days.has(t) ? 1 : 0) + (days.has(t) ? fracToday : 0);
    const projected = loggedDays > 0.02 ? (monthSum.wh / loggedDays) * dim : 0;
    const last30 = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29 + i);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return { key: k, b: days.get(k) };
    });
    const hours = new Map(rep?.hours ?? []);
    const todayHours = Array.from({ length: 24 }, (_, h) => ({ h, b: hours.get(`${t} ${String(h).padStart(2, "0")}`) }));
    const year = [...days.entries()].filter(([k]) => k.startsWith(t.slice(0, 4))).map(([, b]) => b);
    return { today: days.get(t), monthSum, projected, last30, todayHours, yearSum: sum(year), logged: days.size };
  }, [rep]);

  if (!s) return null;
  const todayWh = data.today?.wh ?? 0;
  const ms = data.monthSum;
  const split = ms.wh > 0 ? [ms.cpu / ms.wh, ms.gpu / ms.wh, ms.rest / ms.wh] : p ? [p.cpu / p.wall, p.gpu / p.wall, (p.rest + p.monitor) / p.wall] : [0, 0, 0];
  const hourCost = p ? (p.wall / 1000) * price : 0;

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>{t("Consumo")}</h1>
          <p><LuMapPin size={12} style={{ verticalAlign: -1 }} /> {s.location} · {t("{price}/kWh com impostos e bandeira {flag}", { price: brl(price), flag: t(FLAGS.find((f) => f[0] === s.flag)?.[1] ?? "Verde").toLowerCase() })}</p>
        </div>
        <button className="btn ghost" title={exported ?? undefined} onClick={() => api.exportEnergy().then(setExported).catch((e) => setExported(String(e)))}>
          <LuDownload size={14} /> {t("Exportar planilha")}
        </button>
      </div>
      {exported && <div className="note">{t("Planilhas salvas em")} <b>{exported}</b>: {t("consumo por dia, por hora e por categoria.")}</div>}

      <div className="energy-stats num">
        <section className="card energy-now">
          <h3><LuZap size={14} /> {t("Agora, na tomada")}</h3>
          <b className="big">{p ? Math.round(p.wall) : "—"}<small> W</small></b>
          <span className="muted">{t("{v} por hora ligado", { v: brl(hourCost) })}</span>
          {p && (
            <div className="split">
              <i style={{ flex: p.cpu, background: "var(--cpu)" }} title={`CPU ${Math.round(p.cpu)} W`} />
              <i style={{ flex: p.gpu, background: "var(--gpu)" }} title={`GPU ${Math.round(p.gpu)} W`} />
              <i style={{ flex: p.rest + p.monitor, background: "var(--mem)" }} title={`${t("Resto")} ${Math.round(p.rest + p.monitor)} W`} />
            </div>
          )}
          {p && (
            <div className="split-legend">
              <span><i style={{ background: "var(--cpu)" }} />CPU {Math.round(p.cpu)} W{p.cpuMeasured ? "" : "*"}</span>
              <span><i style={{ background: "var(--gpu)" }} />GPU {Math.round(p.gpu)} W</span>
              <span><i style={{ background: "var(--mem)" }} />{t("Resto")} {Math.round(p.rest + p.monitor)} W</span>
            </div>
          )}
        </section>
        <section className="card">
          <h3>{t("Hoje")}</h3>
          <b className="big">{brl((todayWh / 1000) * price)}</b>
          <span className="muted">{kwh(todayWh)} · {t("{h} h ligado", { h: (Math.round((data.today?.secs ?? 0) / 360) / 10).toLocaleString(locale()) })}</span>
        </section>
        <section className="card">
          <h3>{t("Este mês")}</h3>
          <b className="big">{brl((ms.wh / 1000) * price)}</b>
          <span className="muted">{kwh(ms.wh)}</span>
        </section>
        <section className="card">
          <h3>{t("Projeção do mês")}</h3>
          <b className="big">{brl((data.projected / 1000) * price)}</b>
          <span className="muted">{t("{v} no ritmo atual", { v: kwh(data.projected) })}</span>
        </section>
      </div>

      <section className="card">
        <h3>{t("Últimos 30 dias")}<span className="right">{t("{kwh} · {brl} no ano", { kwh: kwh(data.yearSum.wh), brl: brl((data.yearSum.wh / 1000) * price) })}</span></h3>
        <Bars
          color="linear-gradient(180deg, #64d2ff, #5e8bff)"
          items={data.last30.map(({ key, b }) => ({ key, value: b?.wh ?? 0, dim: key === today(), tip: `${new Date(key + "T12:00").toLocaleDateString(locale())}: ${kwh(b?.wh ?? 0)} · ${brl(((b?.wh ?? 0) / 1000) * price)}` }))}
          label={(k) => (k.endsWith("-01") || k === data.last30[0].key || k === today() ? k.slice(8) + "/" + k.slice(5, 7) : k.slice(8))}
        />
      </section>

      <div className="grid2">
        <section className="card">
          <h3>{t("Hoje, hora a hora")}</h3>
          <Bars
            height={110}
            color="linear-gradient(180deg, #bf5af2, #5e5ce6)"
            items={data.todayHours.map(({ h, b }) => ({ key: String(h), value: b?.wh ?? 0, tip: `${h}h: ${Math.round(b?.wh ?? 0)} Wh · ${brl(((b?.wh ?? 0) / 1000) * price)}` }))}
            label={(k) => (Number(k) % 3 === 0 ? `${k}h` : "")}
          />
        </section>
        <section className="card">
          <h3>{t("Para onde vai a energia")}{ms.wh > 0 ? ` · ${t("este mês")}` : ""}</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 4 }}>
            {([["Processador", "var(--cpu)", split[0], ms.cpu], ["Placa de vídeo", "var(--gpu)", split[1], ms.gpu], ["Resto do PC", "var(--mem)", split[2], ms.rest]] as const).map(([n, c, f, wh]) => (
              <div key={n} className="share">
                <span>{t(n)}</span>
                <div className="meter"><i style={{ width: `${f * 100}%`, background: c }} /></div>
                <b className="num">{Math.round(f * 100)}%</b>
                <small className="num">{ms.wh > 0 ? brl((wh / 1000) * price) : ""}</small>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="card">
        <h3>
          {t("Gasto por categoria")}
          <span className="right"><Segmented value={catRange} onChange={setCatRange} options={[["today", t("Hoje")], ["month", t("Este mês")]]} /></span>
        </h3>
        <div className="top-list num">
          {(() => {
            const src = (catRange === "today" ? rep?.todayCategories : rep?.monthCategories) ?? {};
            const rows = Object.entries(src).sort((a, b) => b[1] - a[1]);
            const total = rows.reduce((a, [, v]) => a + v, 0) || 1;
            if (!rows.length) return <div className="empty">{t("Ainda sem dados. A divisão começa a ser registrada agora.")}</div>;
            return rows.map(([id, wh]) => {
              const base = id === "__base";
              const c = base ? { name: t("Base do PC"), color: "#8e8e93", icon: "chip" } : catOf(m.categories, id);
              return (
                <div className="cat-energy" key={id} title={base ? t("Ociosidade da CPU e GPU, placa-mãe, memória, discos, ventoinhas e monitor") : undefined}>
                  {base ? <span className="cat-icon" style={{ width: 30, height: 30, borderRadius: 8, ["--c" as string]: c.color }}><LuServer size={15} /></span> : <CatIcon cat={c} />}
                  <div className="t"><b>{t(c.name)}</b><div className="meter thin"><i style={{ width: `${(wh / total) * 100}%`, background: c.color }} /></div></div>
                  <span className="v">{Math.round((wh / total) * 100)}%</span>
                  <span className="v">{kwh(wh)}</span>
                  <b className="v">{brl((wh / 1000) * price)}</b>
                </div>
              );
            });
          })()}
        </div>
      </section>

      <div className="section-title">{t("Tarifa")}</div>
      <div className="list">
        <div className="list-row">
          <div className="t"><b>{t("Bandeira tarifária")}</b><small>{t("A ANEEL define a cada mês; a da sua conta aparece na fatura.")}</small></div>
          <Segmented value={s.flag} onChange={(v) => set({ flag: v })} options={FLAGS.map(([id, name]) => [id, t(name)] as [string, string])} />
        </div>
        <NumField label="Tarifa sem impostos" hint="Enel SP · B1 residencial · REH ANEEL 3.596/2026, vigente de 04/07/2026 a 03/07/2027" value={s.tariff} step={0.001} suffix="R$/kWh" onChange={(v) => set({ tariff: v })} />
        <NumField label="Impostos (ICMS + PIS/COFINS)" hint="ICMS 18% em SP acima de 200 kWh/mês, mais cerca de 5% de PIS/COFINS. Ajuste pelo que vem na sua conta." value={s.taxPct} step={0.5} suffix="%" onChange={(v) => set({ taxPct: v })} />
        <div className="list-row">
          <div className="t"><b>{t("Preço final")}</b><small>{t("(tarifa + bandeira) ÷ (1 − impostos)")}</small></div>
          <b className="num" style={{ fontSize: 16 }}>{brl(price)}/kWh</b>
        </div>
      </div>

      <div className="section-title">{t("Estimativa")}</div>
      <div className="list">
        <NumField label="Resto do PC" hint="Placa-mãe, memória, SSDs, ventoinhas e RGB, que não têm sensor." value={s.baseWatts} step={5} suffix="W" onChange={(v) => set({ baseWatts: v })} />
        <NumField label="Eficiência da fonte" hint="Uma fonte 80 Plus Gold rende cerca de 90%; o resto vira calor antes de chegar às peças." value={Math.round(s.psuEff * 100)} step={1} suffix="%" onChange={(v) => set({ psuEff: Math.min(100, Math.max(50, v)) / 100 })} />
        <NumField label="Monitores" hint="Some aqui se quiser contar as telas (veja a potência na etiqueta ou no manual)." value={s.monitorWatts} step={5} suffix="W" onChange={(v) => set({ monitorWatts: v })} />
      </div>
      <div className="note">
        <LuInfo size={13} style={{ verticalAlign: -2 }} /> {t("A GPU é medida pelo driver da NVIDIA.")}{" "}
        {p?.cpuMeasured
          ? t("A CPU é medida pelo próprio processador (RAPL).")
          : t("A CPU está estimada pelo uso (*). Ative os sensores da CPU em Ajustes para medir de verdade.")}
        {" "}{t("O registro começou quando o kMonitor foi aberto pela primeira vez e só conta o tempo com ele rodando.")} <LuPlug size={12} style={{ verticalAlign: -1 }} /> {t("Para um valor exato da tomada, use um medidor de energia.")}
      </div>
    </div>
  );
}
