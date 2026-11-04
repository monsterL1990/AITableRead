import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { getUiLocale } from "@/lib/store";
import type { MessageId } from "./catalog";
import { LOCALE_COOKIE, LOCALE_ENV, LOCALE_HEADER, parseLocale, readCookie, resolveLocale, type Locale } from "./locale";
import { translate } from "./translate";

async function storedLocale(): Promise<Locale | null> {
  try {
    return await getUiLocale();
  } catch {
    return null;
  }
}

/** Language for this HTTP request. Explicit screen language wins, then the saved choice. */
export async function resolveRequestLocale(request?: Request): Promise<Locale> {
  const explicit = request?.headers.get(LOCALE_HEADER);
  if (parseLocale(explicit)) {
    return resolveLocale({
      explicit,
      cookie: readCookie(request?.headers.get("cookie"), LOCALE_COOKIE),
      env: process.env[LOCALE_ENV],
      acceptLanguage: request?.headers.get("accept-language"),
    });
  }
  const stored = await storedLocale();
  if (request) {
    return resolveLocale({
      explicit,
      cookie: readCookie(request.headers.get("cookie"), LOCALE_COOKIE),
      stored,
      env: process.env[LOCALE_ENV],
      acceptLanguage: request.headers.get("accept-language"),
    });
  }
  try {
    const h = await headers();
    const jar = await cookies();
    return resolveLocale({
      explicit: h.get(LOCALE_HEADER),
      cookie: jar.get(LOCALE_COOKIE)?.value,
      stored,
      env: process.env[LOCALE_ENV],
      acceptLanguage: h.get("accept-language"),
    });
  } catch {
    return resolveLocale({ stored, env: process.env[LOCALE_ENV], acceptLanguage: null });
  }
}

export async function pageMetadata(id: MessageId): Promise<Metadata> {
  const locale = await resolveRequestLocale();
  return { title: translate(locale, id) };
}
