"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { htmlLang, LOCALE_COOKIE, LOCALE_HEADER, type Locale } from "@/lib/i18n/locale";
import { joinList, localize, translate, type Vars } from "@/lib/i18n/translate";
import type { MessageId } from "@/lib/i18n/catalog";

type LocaleApi = {
  locale: Locale;
  setLocale: (next: Locale) => Promise<void>;
  t: (id: MessageId, vars?: Vars) => string;
  show: (text: string) => string;
  join: (items: string[]) => string;
};

const LocaleContext = createContext<LocaleApi | null>(null);

function bind(locale: Locale): LocaleApi {
  return {
    locale,
    setLocale: async () => undefined,
    t: (id, vars) => translate(locale, id, vars),
    show: (text) => localize(locale, text),
    join: (items) => joinList(locale, items),
  };
}

export function LocaleProvider({ initialLocale, children }: { initialLocale: Locale; children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const localeRef = useRef(locale);

  useEffect(() => {
    localeRef.current = locale;
    document.documentElement.lang = htmlLang(locale);
  }, [locale]);

  useEffect(() => {
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const headers = new Headers(init?.headers);
      if (!headers.has(LOCALE_HEADER)) headers.set(LOCALE_HEADER, localeRef.current);
      return original(input, { ...init, headers });
    };
    return () => {
      window.fetch = original;
    };
  }, []);

  async function setLocale(next: Locale) {
    if (next === localeRef.current) return;
    setLocaleState(next);
    document.documentElement.lang = htmlLang(next);
    document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    try {
      const response = await window.fetch("/api/locale", {
        method: "PUT",
        headers: { "content-type": "application/json", [LOCALE_HEADER]: next },
        body: JSON.stringify({ locale: next }),
      });
      if (!response.ok) throw new Error("save");
    } catch {
      toast.error(translate(next, "locale.saveFailed"));
    }
  }

  return <LocaleContext.Provider value={{ ...bind(locale), setLocale }}>{children}</LocaleContext.Provider>;
}

export function useI18n(): LocaleApi {
  return useContext(LocaleContext) ?? bind("zh");
}
