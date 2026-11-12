import { useEffect, useState } from "react";
import { LuCheck, LuCopy, LuCpu, LuDownload, LuHardDrive, LuImage, LuMemoryStick, LuMonitor, LuNetwork, LuRefreshCw, LuServer, LuShare2 } from "react-icons/lu";
import { BsGpuCard } from "react-icons/bs";
import { api, arr, fmt, mainGpu, Specs } from "../api";
import { Meter, Modal } from "../components/ui";
import { logoDataUrl, specPng, specSvg, specText } from "../share";
import { t } from "../i18n";
import type { Monitor } from "../App";

function Rows({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <div className="spec-table num">
      {rows.filter(([, v]) => v !== undefined && v !== null && v !== "" && v !== "—").flatMap(([k, v]) => [<span key={k + "k"}>{t(k)}</span>, <b key={k + "v"}>{v}</b>])}
    </div>
  );
}

function Head({ icon: Icon, color, title, sub }: { icon: typeof LuCpu; color: string; title: string; sub?: string }) {
  return (
    <div className="spec-hero" style={{ marginBottom: 12 }}>
      <span className="cat-icon" style={{ width: 44, height: 44, borderRadius: 13, ["--c" as string]: color }}><Icon size={22} /></span>
      <div style={{ minWidth: 0 }}>
        <div className="big">{t(title)}</div>
        {sub && <div className="muted">{sub}</div>}
      </div>
    </div>
  );
}

const kb = (v?: number) => (v ? (v >= 1024 ? `${(v / 1024).toFixed(0)} MB` : `${v} KB`) : undefined);

export default function System({ m }: { m: Monitor }) {
  const [spec, setSpec] = useState<Specs | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const load = (force: boolean) => {
    setBusy(true);
    api.specs(force).then((s) => { setSpec(s); setErr(null); }).catch((e) => setErr(String(e))).finally(() => setBusy(false));
  };
  useEffect(() => load(false), []);

  const live = m.snap;
  const g = mainGpu(live);
  const ram = arr(spec?.ram);
  const ramTotal = ram.reduce((a, r) => a + (r.bytes || 0), 0);

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>{spec?.computer?.name ?? t("Meu PC")}</h1>
          <p>{[spec?.computer?.maker, spec?.computer?.model].filter((x) => x && !/to be filled|system product/i.test(x)).join(" · ") || t("Especificações do hardware")}</p>
        </div>
        <button className="btn ghost" onClick={() => load(true)} disabled={busy}><LuRefreshCw size={14} className={busy ? "spin" : ""} /> {t("Ler de novo")}</button>
        <button className="btn primary" onClick={() => setSharing(true)} disabled={!spec}><LuShare2 size={14} /> {t("Compartilhar")}</button>
      </div>
      {sharing && spec && <ShareDialog spec={spec} onClose={() => setSharing(false)} />}
      {err && <div className="note">{err}</div>}
      {!spec && !err && <div className="card"><div className="skeleton" style={{ width: "60%" }} /><div className="skeleton" style={{ width: "40%", marginTop: 10 }} /></div>}

      {spec && (
        <>
          <div className="grid2">
            <section className="card">
              <Head icon={LuCpu} color="#64d2ff" title={spec.cpu?.name ?? live?.cpu.name ?? "Processador"} sub={spec.cpu?.socket ? t("Soquete {s}", { s: spec.cpu.socket }) : undefined} />
              <Rows rows={[
                ["Núcleos / threads", spec.cpu && t("{c} núcleos · {t} threads", { c: spec.cpu.cores, t: spec.cpu.threads })],
                ["Clock base", spec.cpu?.maxMhz ? fmt.ghz(spec.cpu.maxMhz) : undefined],
                ["Clock agora", fmt.ghz(live?.cpu.mhz)],
                ["Cache L2", kb(spec.cpu?.l2Kb)],
                ["Cache L3", kb(spec.cpu?.l3Kb)],
                ["Virtualização", spec.cpu?.virtualization == null ? undefined : spec.cpu.virtualization ? t("Ativada") : t("Desativada")],
                ["Fabricante", spec.cpu?.maker],
              ]} />
            </section>
            <section className="card">
              <Head icon={LuServer} color="#a78bfa" title={[spec.board?.maker, spec.board?.product].filter(Boolean).join(" ") || "Placa-mãe"} sub={spec.board?.version ? t("Revisão {v}", { v: spec.board.version }) : undefined} />
              <Rows rows={[
                ["BIOS", spec.board?.bios],
                ["Data da BIOS", spec.board?.biosDate],
                ["Sistema", spec.os?.name],
                ["Versão", spec.os && `${spec.os.version} · build ${spec.os.build}`],
                ["Arquitetura", spec.os?.arch],
                ["Instalado em", spec.os?.installed],
                ["Ligado desde", spec.os?.boot],
              ]} />
            </section>
          </div>

          {arr(spec.gpus).map((gp, i) => {
            const isLive = g && (g.name === gp.name || gp.name.includes(g.name) || g.name.includes(gp.name));
            return (
              <section className="card" key={gp.name + i}>
                <Head icon={BsGpuCard as unknown as typeof LuCpu} color="var(--gpu)" title={gp.name} sub={gp.maker} />
                <div className="grid2">
                  <Rows rows={[
                    ["VRAM", gp.vram ? fmt.bytes(gp.vram, 0) : isLive ? fmt.bytes(g!.vramTotal, 0) : undefined],
                    ["Driver", gp.driver],
                    ["Data do driver", gp.driverDate],
                    ["Modo de vídeo", gp.mode?.startsWith("x") ? undefined : gp.mode],
                  ]} />
                  {isLive && g && (
                    <Rows rows={[
                      ["Clock agora", fmt.mhz(g.clock)],
                      ["Clock memória", fmt.mhz(g.memClock)],
                      ["Temperatura", fmt.temp(g.temp)],
                      ["Limite de energia", fmt.watts(g.powerLimit)],
                    ]} />
                  )}
                </div>
              </section>
            );
          })}

          <section className="card">
            <Head icon={LuMemoryStick} color="var(--mem)" title={t("{n} de memória", { n: fmt.bytes(ramTotal || live?.mem.total || 0, 0) })}
              sub={`${t("{a} de {b} slots ocupados", { a: ram.length, b: spec.ramSlots ?? ram.length })}${ram[0]?.configuredMhz ? ` · ${ram[0].configuredMhz} MT/s` : ""}`} />
            <div className="sticks num">
              {ram.map((r, i) => (
                <div className="stick" key={i}>
                  <b>{fmt.bytes(r.bytes, 0)}</b>
                  <small>{r.slot}{r.bank ? ` · ${r.bank}` : ""}</small>
                  <small>{r.maker} {r.part}</small>
                  <small>{r.configuredMhz || r.mhz} MT/s{r.volts ? ` · ${(r.volts / 1000).toFixed(2)} V` : ""}</small>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <Head icon={LuHardDrive} color="#ff9f0a" title="Armazenamento" sub={arr(spec.disks).map((d) => d.name).join(" · ")} />
            <div className="sticks num" style={{ marginBottom: 14 }}>
              {arr(spec.disks).map((d, i) => (
                <div className="stick" key={i}>
                  <b style={{ fontSize: 14 }}>{d.name}</b>
                  <small>{fmt.bytes(d.bytes, 0)} · {d.media !== "Unspecified" ? d.media : ""} {d.bus}</small>
                  <small>{t("Saúde:")} {d.health === "Healthy" ? t("boa") : d.health}</small>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {arr(spec.volumes).map((v) => {
                const used = v.bytes ? ((v.bytes - v.free) * 100) / v.bytes : 0;
                return (
                  <div key={v.letter} style={{ display: "grid", gridTemplateColumns: "170px 1fr 180px", alignItems: "center", gap: 12, fontSize: 12.5 }}>
                    <span><b>{v.letter}</b> <span className="muted">{v.label || v.fs}</span></span>
                    <Meter value={used} color={used > 90 ? "var(--hot)" : used > 75 ? "var(--warn)" : "var(--accent)"} />
                    <span className="muted num" style={{ textAlign: "right" }}>{t("{free} livres de {total}", { free: fmt.bytes(v.free), total: fmt.bytes(v.bytes, 0) })}</span>
                  </div>
                );
              })}
            </div>
          </section>

          <div className="grid2">
            <section className="card">
              <Head icon={LuMonitor} color="#66d4cf" title="Monitores" />
              <Rows rows={arr(spec.displays).map((d, i) => [d.name || `${t("Monitor")} ${i + 1}`, `${d.maker}${d.year ? ` · ${d.year}` : ""}`] as [string, string])} />
            </section>
            <section className="card">
              <Head icon={LuNetwork} color="#0a84ff" title="Rede" />
              <Rows rows={arr(spec.network).map((n) => [n.name, `${n.desc} · ${n.speed}`] as [string, string])} />
            </section>
          </div>
        </>
      )}
    </div>
  );
}

/** Preview of the shareable card, with copy and save actions. */
function ShareDialog({ spec, onClose }: { spec: Specs; onClose: () => void }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => { logoDataUrl().then((logo) => setSvg(specSvg(spec, logo))); }, [spec]);
  const flash = (k: string) => { setDone(k); setTimeout(() => setDone((d) => (d === k ? null : d)), 2500); };

  const copyText = async () => {
    await navigator.clipboard.writeText(specText(spec));
    flash("texto");
  };
  const copyImage = async () => {
    if (!svg) return;
    const png = await specPng(svg);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    flash("imagem");
  };
  const save = async () => {
    if (!svg) return;
    const png = await specPng(svg);
    await api.savePng(new Uint8Array(await png.arrayBuffer()), "meu-pc-specs");
    flash("salvo");
  };

  return (
    <Modal title={t("Compartilhar specs")} onClose={onClose}>
      <p>{t("Uma versão sem nome do PC, rede ou números de série, pronta para mandar ou postar.")}</p>
      <div className="share-preview">
        {svg ? <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} alt={t("Cartão com as specs do PC")} /> : <div className="skeleton" style={{ height: "100%" }} />}
      </div>
      <pre className="share-text">{specText(spec)}</pre>
      <footer>
        <button className="btn" onClick={copyText}>{done === "texto" ? <LuCheck size={14} /> : <LuCopy size={14} />} {done === "texto" ? t("Copiado") : t("Copiar texto")}</button>
        <button className="btn" onClick={copyImage} disabled={!svg}>{done === "imagem" ? <LuCheck size={14} /> : <LuImage size={14} />} {done === "imagem" ? t("Copiada") : t("Copiar imagem")}</button>
        <button className="btn primary" onClick={save} disabled={!svg}>{done === "salvo" ? <LuCheck size={14} /> : <LuDownload size={14} />} {done === "salvo" ? t("Salvo em Documentos") : t("Salvar PNG")}</button>
      </footer>
    </Modal>
  );
}
