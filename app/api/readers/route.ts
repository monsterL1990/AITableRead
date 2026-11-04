import { errorJson, isResponse, readJson, requireUser } from "@/lib/api";
import { resolveRequestLocale } from "@/lib/i18n/request";
import { lengthError } from "@/lib/pipeline";
import { createReader, listReaders } from "@/lib/store";
import { LIMITS } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const locale = await resolveRequestLocale(request);
  try {
    return Response.json({ readers: await listReaders(user.uid, locale) });
  } catch {
    return errorJson("读者名单读不出来。", 500);
  }
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const record = (body ?? {}) as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const blurb = typeof record.blurb === "string" ? record.blurb.trim() : "";
  const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
  if (!name) return errorJson("读者要有名字。", 400);
  if (name.length > LIMITS.readerName) return errorJson("读者名字太长。", 400);
  if (blurb.length > LIMITS.readerBlurb) return errorJson("读者简介太长。", 400);
  if (!prompt) return errorJson("读者要有提示词。", 400);
  const issue = lengthError("prompt", prompt);
  if (issue) return errorJson(issue, 400);
  try {
    const locale = await resolveRequestLocale(request);
    const reader = await createReader({ name, blurb, prompt }, user.uid, locale);
    return Response.json({ reader }, { status: 201 });
  } catch {
    return errorJson("读者没能加上。", 500);
  }
}
