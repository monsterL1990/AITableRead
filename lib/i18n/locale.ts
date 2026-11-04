export const LOCALES = ["zh", "en"] as const;

export type Locale = (typeof LOCALES)[number];

/** Cookie and request header that carry the language the screen is showing. */
export const LOCALE_COOKIE = "weidu_locale";
export const LOCALE_HEADER = "x-weidu-locale";

/** Deployment pin. Used only when the user has not chosen a language. */
export const LOCALE_ENV = "WEIDU_LOCALE";

export function parseLocale(value: string | null | undefined): Locale | null {
  if (!value) return null;
  const tag = value.trim().toLowerCase().replace(/_/g, "-");
  if (!tag) return null;
  if (tag === "en" || tag.startsWith("en-")) return "en";
  if (tag === "zh" || tag.startsWith("zh-")) return "zh";
  return null;
}

/**
 * Browsers that prefer English get English. Every other preference, including
 * a missing header, gets Chinese.
 */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  if (!header?.trim()) return "zh";
  const ranked = header
    .split(",")
    .map((part) => {
      const [tagRaw, ...params] = part.trim().split(";");
      let q = 1;
      for (const param of params) {
        const [key, raw] = param.trim().split("=");
        if (key?.trim() === "q") {
          const parsed = Number(raw);
          if (Number.isFinite(parsed)) q = parsed;
        }
      }
      return { tag: tagRaw?.trim().toLowerCase() ?? "", q };
    })
    .filter((item) => item.tag && item.tag !== "*" && item.q > 0)
    .sort((a, b) => b.q - a.q);
  const top = ranked[0];
  if (!top) return "zh";
  return top.tag === "en" || top.tag.startsWith("en-") ? "en" : "zh";
}

export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/**
 * Resolution order:
 * 1. Explicit `x-weidu-locale` on this request (the language on screen).
 * 2. `weidu_locale` cookie (set as soon as the switch is clicked).
 * 3. Saved choice in data/store.json.
 * 4. `WEIDU_LOCALE` (deployment default; overrides the browser).
 * 5. Accept-Language. English preference → English, otherwise Chinese.
 */
export function resolveLocale(input: {
  explicit?: string | null;
  cookie?: string | null;
  stored?: string | null;
  env?: string | null;
  acceptLanguage?: string | null;
}): Locale {
  return (
    parseLocale(input.explicit) ??
    parseLocale(input.cookie) ??
    parseLocale(input.stored) ??
    parseLocale(input.env) ??
    localeFromAcceptLanguage(input.acceptLanguage)
  );
}

export function htmlLang(locale: Locale): "zh-CN" | "en" {
  return locale === "en" ? "en" : "zh-CN";
}
