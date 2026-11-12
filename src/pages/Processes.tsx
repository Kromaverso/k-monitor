import { Fragment, useEffect, useMemo, useState } from "react";
import { LuChevronRight, LuEllipsis, LuFolderOpen, LuSearch, LuSquareX, LuTag } from "react-icons/lu";
import { api, catOf, fmt, Proc } from "../api";
import { CatIcon, Modal, Segmented } from "../components/ui";
import { plural, t } from "../i18n";
import type { Monitor } from "../App";

type Mode = "category" | "app" | "flat";
type Key = "name" | "cpu" | "gpu" | "mem" | "vram";
type Agg = { key: string; label: string; sub?: string; cat: string; cpu: number; gpu: number; mem: number; vram: number; procs: Proc[]; children?: Agg[] };

function aggregate(key: string, label: string, cat: string, procs: Proc[]): Agg {
  return {
    key, label, cat, procs,
    cpu: procs.reduce((a, p) => a + p.cpu, 0),
    gpu: Math.min(100, procs.reduce((a, p) => a + p.gpu, 0)),
    mem: procs.reduce((a, p) => a + p.mem, 0),
    vram: procs.reduce((a, p) => a + p.vram, 0),
  };
}

function byApp(procs: Proc[]): Agg[] {
  const m = new Map<string, Proc[]>();
  for (const p of procs) {
    const k = p.name.toLowerCase();
    m.set(k, [...(m.get(k) ?? []), p]);
  }
  return [...m.values()].map((ps) => {
    const a = aggregate(ps[0].name.toLowerCase(), ps[0].name, ps[0].cat, ps);
    a.sub = ps.length > 1 ? plural(ps.length, "{n} processo", "{n} processos") : `PID ${ps[0].pid}`;
    return a;
  });
}

function Cell({ v, unit, max }: { v: number; unit: "pct" | "bytes"; max?: number }) {
  const hot = unit === "pct" ? v >= 50 : false;
  const fire = unit === "pct" ? v >= 85 : false;
  const text = unit === "pct" ? (v < 0.05 ? "0%" : `${v < 10 ? v.toFixed(1) : Math.round(v)}%`) : fmt.bytes(v);
  const w = max ? Math.min(100, (v / max) * 100) : Math.min(100, v);
  return (
    <div className={"cell num" + (fire ? " fire" : hot ? " hot" : "")}>
      {text}
      <div className="bar"><i style={{ width: `${w}%`, background: fire ? "var(--hot)" : hot ? "var(--warn)" : "rgba(255,255,255,.35)" }} /></div>
    </div>
  );
}

export default function Processes({ m, say }: { m: Monitor; say: (t: string) => void }) {
  const [mode, setMode] = useState<Mode>("category");
  const [sort, setSort] = useState<Key>("cpu");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; agg: Agg } | null>(null);
  const [confirm, setConfirm] = useState<Agg | null>(null);
  const procs = m.snap?.procs ?? [];
  const memMax = m.snap?.mem.total ?? 1;

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("blur", close); };
  }, [menu]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? procs.filter((p) => p.name.toLowerCase().includes(needle) || String(p.pid) === needle || t(catOf(m.categories, p.cat).name).toLowerCase().includes(needle))
      : procs;
    const cmp = (a: Agg, b: Agg) => (sort === "name" ? a.label.localeCompare(b.label) : (b[sort] as number) - (a[sort] as number));
    if (mode === "flat") {
      return list.map((p) => { const a = aggregate(`p${p.pid}`, p.name, p.cat, [p]); a.sub = `PID ${p.pid}`; return a; }).sort(cmp);
    }
    if (mode === "app") return byApp(list).sort(cmp);
    const cats = new Map<string, Proc[]>();
    for (const p of list) cats.set(p.cat, [...(cats.get(p.cat) ?? []), p]);
    return [...cats.entries()]
      .map(([id, ps]) => {
        const c = catOf(m.categories, id);
        const a = aggregate(`c:${id}`, t(c.name), id, ps);
        a.sub = plural(ps.length, "{n} processo", "{n} processos");
        a.children = byApp(ps).sort(cmp);
        return a;
      })
      .sort(cmp);
  }, [procs, mode, sort, q, m.categories]);

  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const showMenu = (e: React.MouseEvent, agg: Agg) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: Math.min(e.clientX, window.innerWidth - 240), y: Math.min(e.clientY, window.innerHeight - 320), agg });
  };
  const assign = async (agg: Agg, cat: string) => {
    const names = [...new Set(agg.procs.map((p) => p.name.toLowerCase()))];
    let cats = m.categories;
    for (const n of names) cats = await api.assignProcess(n, cat);
    m.setCategories(cats);
    say(t("{app} agora conta como {cat}", { app: agg.label, cat: t(catOf(cats, cat).name) }));
  };
  const end = async (agg: Agg) => {
    const n = await api.endProcesses(agg.procs.map((p) => p.pid));
    say(n ? plural(n, "{n} processo encerrado", "{n} processos encerrados") : t("Não foi possível encerrar (talvez precise de administrador)"));
    setConfirm(null);
  };

  const row = (a: Agg, depth: number): React.ReactNode => {
    const c = catOf(m.categories, a.cat);
    const expandable = (a.children?.length ?? 0) > 0 || (depth > 0 && a.procs.length > 1) || (mode === "app" && a.procs.length > 1);
    const isOpen = open.has(a.key);
    return (
      <Fragment key={a.key}>
        <div
          className={"trow" + (depth === 0 && mode === "category" ? " group" : "") + (depth === 1 ? " child" : depth === 2 ? " child child2" : "")}
          onClick={() => expandable && toggle(a.key)}
          onContextMenu={(e) => showMenu(e, a)}
        >
          <div className="name">
            {expandable ? <LuChevronRight size={14} className={"chev" + (isOpen ? " open" : "")} /> : <span style={{ width: 14, flex: "none" }} />}
            {depth === 0 && <CatIcon cat={c} size={mode === "category" ? 30 : 24} />}
            <span><b>{a.label}</b>{a.sub && <em>{mode !== "category" && depth === 0 ? `${t(c.name)} · ` : ""}{a.sub}</em>}</span>
          </div>
          <Cell v={a.cpu} unit="pct" />
          <Cell v={a.gpu} unit="pct" />
          <Cell v={a.mem} unit="bytes" max={memMax * 0.25} />
          <Cell v={a.vram} unit="bytes" max={4e9} />
          <button className="row-btn" aria-label={t("Ações")} onClick={(e) => showMenu(e, a)}><LuEllipsis size={16} /></button>
        </div>
        {isOpen && a.children?.map((ch) => row(ch, depth + 1))}
        {isOpen && !a.children && a.procs.length > 1 && a.procs.slice().sort((x, y) => y.cpu - x.cpu).map((p) =>
          row({ ...aggregate(`p${p.pid}`, p.name, p.cat, [p]), sub: `PID ${p.pid}` }, depth + 1),
        )}
      </Fragment>
    );
  };

  const head = (k: Key, label: string) => (
    <button className={sort === k ? "on" : ""} onClick={() => setSort(k)}>{label}{sort === k && k !== "name" ? " ↓" : ""}</button>
  );

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>{t("Processos")}</h1>
          <p>{t("{n} processos · clique com o botão direito para mover de categoria ou encerrar", { n: procs.length })}</p>
        </div>
      </div>
      <div className="toolbar">
        <label className="search"><LuSearch size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Buscar processo, PID ou categoria")} spellCheck={false} /></label>
        <Segmented value={mode} onChange={setMode} options={[["category", t("Por categoria")], ["app", t("Por app")], ["flat", t("Lista")]]} />
      </div>
      <div className="table">
        <div className="thead">
          {head("name", t("Nome"))}{head("cpu", "CPU")}{head("gpu", "GPU")}{head("mem", t("Memória"))}{head("vram", "VRAM")}<span />
        </div>
        {rows.map((a) => row(a, 0))}
        {!rows.length && <div className="empty">{procs.length ? t("Nada encontrado.") : t("Carregando processos…")}</div>}
      </div>

      {menu && (
        <div className="menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
          {!menu.agg.key.startsWith("c:") && (
            <>
              <div className="label"><LuTag size={11} /> {t("Mover para categoria")}</div>
              {m.categories.map((c) => (
                <button key={c.id} onClick={() => { assign(menu.agg, c.id); setMenu(null); }}>
                  <CatIcon cat={c} size={20} /> {t(c.name)}
                </button>
              ))}
              <hr />
              {menu.agg.procs[0]?.exe && (
                <button onClick={() => { api.reveal(menu.agg.procs[0].exe); setMenu(null); }}><LuFolderOpen size={15} /> {t("Abrir local do arquivo")}</button>
              )}
            </>
          )}
          <button className="danger" onClick={() => { setConfirm(menu.agg); setMenu(null); }}>
            <LuSquareX size={15} /> {menu.agg.procs.length > 1 ? t("Encerrar {n} processos", { n: menu.agg.procs.length }) : t("Encerrar processo")}
          </button>
        </div>
      )}
      {confirm && (
        <Modal title={t("Encerrar {name}?", { name: confirm.label })} onClose={() => setConfirm(null)}>
          <p>
            {confirm.procs.length > 1 ? t("Os {n} processos serão fechados à força.", { n: confirm.procs.length }) : t("O processo será fechado à força.")} {t("Trabalho não salvo nesses programas será perdido.")}
          </p>
          <footer>
            <button className="btn ghost" onClick={() => setConfirm(null)}>{t("Cancelar")}</button>
            <button className="btn danger" onClick={() => end(confirm)}>{t("Encerrar")}</button>
          </footer>
        </Modal>
      )}
    </div>
  );
}
