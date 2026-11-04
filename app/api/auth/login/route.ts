import { loginWithPassword } from "@/lib/accounts";
import { AUTH_OFF_MESSAGE, errorJson, readJson } from "@/lib/api";
import { authEnabled } from "@/lib/auth-mode";
import { writeSessionCookie } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_TRIES = 8;
const attempts = new Map<string, { count: number; reset: number }>();

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "local";
}

function limited(key: string): boolean {
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.reset < now) {
    attempts.set(key, { count: 1, reset: now + WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > MAX_TRIES;
}

export async function POST(request: Request) {
  if (!authEnabled()) return errorJson(AUTH_OFF_MESSAGE, 403);
  const key = clientKey(request);
  if (limited(key)) return errorJson("试得太勤，请过几分钟再来。", 429);

  const body = await readJson(request);
  if (body instanceof Response) return body;
  const record = body as { uid?: unknown; password?: unknown };
  const password = typeof record.password === "string" ? record.password : "";
  const uid = typeof record.uid === "string" ? record.uid : "";
  let result: Awaited<ReturnType<typeof loginWithPassword>>;
  try {
    result = await loginWithPassword({ uid, password });
  } catch {
    return errorJson("账号库读不出来。", 500);
  }
  if (!result.ok) return errorJson(result.error, result.status);
  attempts.delete(key);
  await writeSessionCookie(result.user.uid, result.user.credentialVersion);
  return Response.json({ ok: true, uid: result.user.uid, type: result.user.type });
}
