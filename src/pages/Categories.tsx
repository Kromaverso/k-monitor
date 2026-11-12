import { useEffect, useRef, useState } from "react";
import { LuPlus, LuRotateCcw, LuTrash2, LuX } from "react-icons/lu";
import { api, Category, fmt } from "../api";
import { CatIcon, ICON_NAMES, Modal } from "../components/ui";
import { t } from "../i18n";
import type { Monitor } from "../App";

const COLORS = ["#64d2ff", "#0a84ff", "#5e5ce6", "#a78bfa", "#bf5af2", "#ff375f", "#ff453a", "#ff9f0a", "#ffd60a", "#30d158", "#66d4cf", "#8e8e93"];

export default function Categories({ m }: { m: Monitor }) {
  const [cats, setCats] = useState<Category[]>(m.categories);
  const [reset, setReset] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const groups = new Map((m.snap?.groups ?? []).map((g) => [g.id, g]));

  useEffect(() => { setCats(m.categories); }, [m.categories]);

  // Saves shortly after the last edit, so typing a name does not write on every key.
  const update = (next: Category[]) => {
    setCats(next);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { api.saveCategories(next); m.setCategories(next); }, 400);
  };
  const patch = (id: string, p: Partial<Category>) => update(cats.map((c) => (c.id === id ? { ...c, ...p } : c)));
  const add = () => {
    const id = `custom-${Date.now().toString(36)}`;
    update([{ id, name: t("Nova categoria"), color: COLORS[cats.length % COLORS.length], icon: "shapes", patterns: [] }, ...cats]);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>{t("Categorias")}</h1>
          <p>{t("A primeira categoria que reconhecer o processo vence. Apps abertos por outro (como a WebView de um launcher) herdam a categoria de quem os abriu.")}</p>
        </div>
        <button className="btn ghost" onClick={() => setReset(true)}><LuRotateCcw size={14} /> {t("Restaurar padrão")}</button>
        <button className="btn primary" onClick={add}><LuPlus size={15} /> {t("Nova categoria")}</button>
      </div>

      <div className="note">
        <b>{t("Como escrever um padrão:")}</b> <code>unreal*</code> {t("casa com o nome do executável (com * e ?).")}{" "}
        {t("Com uma barra,")} <code>\engine\binaries\</code> {t("casa com qualquer parte do caminho do arquivo. Também dá para mover um processo pelo botão direito em Processos.")}
      </div>

      {cats.map((c) => {
        const g = groups.get(c.id);
        return (
          <section className="card cat-card" key={c.id}>
            <header>
              <button onClick={() => setPicking(picking === c.id ? null : c.id)} title={t("Trocar ícone e cor")}><CatIcon cat={c} size={36} /></button>
              <input className="input" value={t(c.name)} onChange={(e) => patch(c.id, { name: e.target.value })} spellCheck={false} />
              {g && <span className="muted num" style={{ fontSize: 12 }}>{g.count} proc. · {g.cpu.toFixed(1)}% CPU · {fmt.bytes(g.mem)}</span>}
              <button className="btn icon ghost" aria-label={t("Apagar categoria")} onClick={() => update(cats.filter((x) => x.id !== c.id))}><LuTrash2 size={15} /></button>
            </header>
            {picking === c.id && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "4px 0 4px 48px" }}>
                <div className="swatches">
                  {COLORS.map((col) => <button key={col} className={c.color === col ? "on" : ""} style={{ background: col }} aria-label={col} onClick={() => patch(c.id, { color: col })} />)}
                </div>
                <div className="icon-pick">
                  {ICON_NAMES.map((ic) => <button key={ic} className={c.icon === ic ? "on" : ""} onClick={() => patch(c.id, { icon: ic })}><CatIcon cat={{ icon: ic, color: c.color }} size={28} /></button>)}
                </div>
              </div>
            )}
            <div className="pills" style={{ paddingLeft: 48 }}>
              {c.patterns.map((p, i) => (
                <span className="pill" key={p + i}>
                  {p}
                  <button aria-label={t("Remover {p}", { p })} onClick={() => patch(c.id, { patterns: c.patterns.filter((_, j) => j !== i) })}><LuX size={11} /></button>
                </span>
              ))}
              <input
                className="pill-input" placeholder={t("+ padrão e Enter")} spellCheck={false}
                onKeyDown={(e) => {
                  const v = e.currentTarget.value.trim();
                  if (e.key === "Enter" && v) { patch(c.id, { patterns: [...c.patterns, v] }); e.currentTarget.value = ""; }
                }}
              />
            </div>
          </section>
        );
      })}

      {reset && (
        <Modal title={t("Restaurar categorias padrão?")} onClose={() => setReset(false)}>
          <p>{t("Suas categorias e os processos que você moveu manualmente voltam para a configuração original.")}</p>
          <footer>
            <button className="btn ghost" onClick={() => setReset(false)}>{t("Cancelar")}</button>
            <button className="btn danger" onClick={async () => { const d = await api.resetCategories(); m.setCategories(d); setReset(false); }}>{t("Restaurar")}</button>
          </footer>
        </Modal>
      )}
    </div>
  );
}
