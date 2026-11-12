import { useState } from "react";
import { LuFolderOpen, LuLanguages, LuShieldCheck, LuThermometer } from "react-icons/lu";
import { api } from "../api";
import { Segmented, Toggle } from "../components/ui";
import { LANGS, t } from "../i18n";
import type { Monitor } from "../App";

export default function Settings({ m }: { m: Monitor }) {
  const [msg, setMsg] = useState<string | null>(null);
  const s = m.settings;
  if (!s) return null;
  const set = (p: Partial<typeof s>) => m.setSettings({ ...s, ...p });
  const status = m.snap?.cpu.tempStatus;
  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <div className="page-head"><div className="grow"><h1>{t("Ajustes")}</h1></div></div>

      <div className="section-title">{t("Geral")}</div>
      <div className="list">
        <div className="list-row">
          <div className="t"><b><LuLanguages size={14} style={{ verticalAlign: -2 }} /> {t("Idioma")}</b><small>{t("Automático segue o idioma do Windows.")}</small></div>
          <Segmented value={s.language || "auto"} onChange={(v) => set({ language: v })} options={LANGS.map(([id, name]) => [id, id === "auto" ? t(name) : name] as [string, string])} />
        </div>
        <div className="list-row">
          <div className="t"><b>{t("Iniciar com o Windows")}</b><small>{m.sys.adminMode ? t("Pela tarefa agendada \"kMonitor\", já como administrador.") : t("Abre direto na bandeja, sem mostrar a janela.")}</small></div>
          <Toggle on={m.autostart} onChange={m.setAutostart} label={t("Iniciar com o Windows")} />
        </div>
        <div className="list-row">
          <div className="t"><b>{t("Frequência de atualização")}</b><small>{t("Com todas as janelas fechadas o kMonitor lê só o essencial, a cada 2 s.")}</small></div>
          <Segmented value={String(s.intervalMs)} onChange={(v) => set({ intervalMs: Number(v) })} options={[["500", t("0,5 s")], ["1000", "1 s"], ["2000", "2 s"]]} />
        </div>
      </div>

      <div className="section-title">{t("Sensores da CPU")}</div>
      <div className="list">
        <div className="list-row">
          <div className="t">
            <b><LuThermometer size={14} style={{ verticalAlign: -2 }} /> {t("Temperatura e consumo do processador")}</b>
            {status === "ok" && <small>{t("Ativo. O kMonitor está rodando como administrador e lendo os sensores pelo driver PawnIO.")}</small>}
            {status === "unsupported" && <small>{t("Disponível só para processadores AMD Ryzen (Zen 1 a Zen 5).")}</small>}
            {status === "noDriver" && <small>{t("O Windows não entrega esses dados a programas comuns. É preciso instalar o PawnIO, um driver gratuito e assinado (o mesmo que o LibreHardwareMonitor usa).")}</small>}
            {status === "needsAdmin" && <small>{t("O PawnIO está instalado. Falta o kMonitor rodar como administrador: o Windows pede permissão uma vez e depois ele inicia sozinho com o sistema.")}</small>}
            {msg && <small style={{ color: "var(--warn)" }}>{msg}</small>}
          </div>
          {status === "noDriver" && <button className="btn" onClick={() => api.openUrl("https://pawnio.eu")}>{t("Baixar PawnIO")}</button>}
          {(status === "noDriver" || status === "needsAdmin") && (
            <button className="btn primary" onClick={() => api.enableCpuSensors().then(() => setMsg(t("Confirme a janela do Windows; o kMonitor vai reabrir como administrador."))).catch((e) => setMsg(String(e) === "nodriver" ? t("Instale o PawnIO primeiro e depois clique em Ativar.") : String(e)))}>
              <LuShieldCheck size={15} /> {t("Ativar")}
            </button>
          )}
          {status === "ok" && m.sys.adminMode && (
            <button className="btn ghost" onClick={() => api.disableAdminMode().then((ok) => setMsg(ok ? t("Modo administrador desligado. Vale a partir da próxima vez que o kMonitor abrir.") : t("Não consegui remover a tarefa agendada.")))}>{t("Desativar")}</button>
          )}
        </div>
      </div>

      <div className="section-title">{t("Bandeja e mini monitor")}</div>
      <div className="list">
        <div className="list-row">
          <div className="t"><b>{t("Ícone da bandeja")}</b><small>{t("Clique no ícone para abrir o mini monitor; clique duplo abre o app inteiro.")}</small></div>
          <Segmented value={s.trayStyle} onChange={(v) => set({ trayStyle: v })} options={[["bars", t("Barras CPU+GPU")], ["cpu", "% CPU"], ["gpu", "% GPU"]]} />
        </div>
        <div className="list-row">
          <div className="t"><b>{t("Fixar mini monitor na tela")}</b><small>{t("Vira um widget flutuante que você arrasta para onde quiser e não some ao clicar fora.")}</small></div>
          <Toggle on={s.miniPinned} onChange={(v) => set({ miniPinned: v })} label={t("Fixar mini monitor na tela")} />
        </div>
      </div>

      <div className="section-title">{t("Registro e integrações")}</div>
      <div className="list">
        <div className="list-row">
          <div className="t"><b>{t("Gravar CSV")}</b><small>{t("Um arquivo por sessão em Documentos\\kMonitor com CPU, GPU, RAM, clocks e temperaturas.")}</small></div>
          <button className="btn ghost" onClick={() => api.openLogs()}><LuFolderOpen size={14} /> {t("Abrir pasta")}</button>
          <Toggle on={s.logCsv} onChange={(v) => set({ logCsv: v })} label={t("Gravar CSV")} />
        </div>
        <div className="list-row">
          <div className="t">
            <b>Stream Deck</b>
            <small>{t("Libera os dados para o plugin kMonitor do Stream Deck em http://127.0.0.1:{port}/v1/stats. Só este PC acessa.", { port: m.apiPort })}</small>
          </div>
          <Toggle on={s.apiEnabled} onChange={(v) => set({ apiEnabled: v })} label="Stream Deck" />
        </div>
      </div>

      <div className="list" style={{ marginTop: 8 }}>
        <div className="list-row">
          <div className="t"><b>{t("Sair do kMonitor")}</b><small>{t("Fechar a janela só esconde o app na bandeja. Isto encerra de vez.")}</small></div>
          <button className="btn danger" onClick={() => api.quit()}>{t("Sair")}</button>
        </div>
      </div>
    </div>
  );
}
