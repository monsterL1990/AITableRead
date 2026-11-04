import { errorJson, readJson } from "@/lib/api";
import { parseLocale } from "@/lib/i18n/locale";
import { resolveRequestLocale } from "@/lib/i18n/request";
import { getUiLocale, setUiLocale } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export async function GET(request: Request) {
  const [resolved, stored] = await Promise.all([resolveRequestLocale(request), getUiLocale()]);
  return Response.json({ locale: stored, resolved });
}

export async function PUT(request: Request) {
  const body = await readJson(request);
  if (body instanceof Response) return body;
  if (!isRecord(body)) return errorJson("请求格式不对。", 400);
  const locale = parseLocale(typeof body.locale === "string" ? body.locale : null);
  if (!locale) return errorJson("界面语言只能是中文或 English。", 400);
  await setUiLocale(locale);
  return Response.json({ locale, resolved: locale });
}
