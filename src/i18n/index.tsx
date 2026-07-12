import React, { createContext, useContext, useMemo, useState } from "react";
import * as Localization from "expo-localization";
import { Dict, en } from "./en";
import { ro } from "./ro";

export type Lang = "en" | "ro";

const dicts: Record<Lang, Dict> = { en, ro };

function detectLang(): Lang {
  const code = Localization.getLocales?.()[0]?.languageCode ?? "en";
  return code.startsWith("ro") ? "ro" : "en";
}

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: Dict;
}

const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>(detectLang());
  const value = useMemo(() => ({ lang, setLang, t: dicts[lang] }), [lang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useI18n must be used within I18nProvider");
  return c;
}

/** Interpolare simpla: format("a {n} b", {n: 3}) -> "a 3 b". */
export function format(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

/**
 * Dicționar în AFARA React. Necesar pentru texte care nu pleacă din UI — ex. notificarea
 * serviciului BLE, pornit din stratul de transport, unde nu există context și deci nici useI18n.
 * Nu urmărește schimbarea manuală de limbă din Settings (aia trăiește în state-ul React); cade pe
 * limba dispozitivului, care e și valoarea inițială.
 */
export function dictFor(lang: Lang = detectLang()): Dict {
  return dicts[lang];
}
