import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Translations } from "./translations";
import ptBR from "./pt-BR";
import enUS from "./en-US";
import esES from "./es-ES";

export type Locale = "pt-BR" | "en-US" | "es-ES";

export const LOCALE_LABELS: Record<Locale, string> = {
  "pt-BR": "Português (BR)",
  "en-US": "English (US)",
  "es-ES": "Español (ES)",
};

const LOCALE_MAP: Record<Locale, Translations> = {
  "pt-BR": ptBR,
  "en-US": enUS,
  "es-ES": esES,
};

function getStoredLocale(): Locale {
  const stored = localStorage.getItem("erp_locale") as Locale | null;
  if (stored && stored in LOCALE_MAP) return stored;
  return "pt-BR";
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translations;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getStoredLocale);

  // Sincroniza o atributo lang do documento para que <input type="date">
  // e outros elementos nativos do browser também respeitem o idioma escolhido.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    localStorage.setItem("erp_locale", next);
    setLocaleState(next);
  }, []);

  return (
    <I18nContext.Provider value={{ locale, setLocale, t: LOCALE_MAP[locale] }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}

/** Helper para texto localizado inline por página.
 *  Uso: const p = usePageText({ "pt-BR": {...}, "en-US": {...}, "es-ES": {...} })
 */
export function usePageText<T extends Record<string, unknown>>(map: Record<Locale, T>): T {
  const { locale } = useI18n();
  return map[locale];
}
