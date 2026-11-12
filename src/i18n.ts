// Translations. The Portuguese text is the key: t("Visão geral") returns the English or
// Spanish version, or the Portuguese itself when there is none. That also translates the
// default category names while leaving names the user typed alone.

import { EN, ES } from "./locales";

export type Lang = "pt" | "en" | "es";
export const LANGS: [string, string][] = [["auto", "Automático"], ["pt", "Português"], ["en", "English"], ["es", "Español"]];

let current: Lang = "pt";

/** "auto" follows the Windows display language; anything not Portuguese or Spanish gets English. */
export function resolveLang(setting: string | undefined): Lang {
  if (setting === "pt" || setting === "en" || setting === "es") return setting;
  const nav = (navigator.language || "en").toLowerCase();
  return nav.startsWith("pt") ? "pt" : nav.startsWith("es") ? "es" : "en";
}

export function setLang(l: Lang) {
  current = l;
  document.documentElement.lang = locale();
}

export const getLang = () => current;
export const locale = () => ({ pt: "pt-BR", en: "en-US", es: "es-ES" })[current];

/** Translates and fills {placeholders}. */
export function t(pt: string, vars?: Record<string, string | number>): string {
  const table = current === "en" ? EN : current === "es" ? ES : null;
  let s = (table && table[pt]) || pt;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** One / many forms: plural(n, "{n} processo", "{n} processos"). */
export const plural = (n: number, one: string, many: string) => t(n === 1 ? one : many, { n });
