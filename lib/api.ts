import { resolveSessionAccount, type AuthUser } from "./accounts";
import { authEnabled } from "./auth-mode";
import { getSession } from "./auth";
import { resolveRequestLocale } from "./i18n/request";
import { localize } from "./i18n/translate";
import { LOCAL_USER_ID } from "./types";

export type { AuthUser };

export const AUTH_OFF_MESSAGE = "账号系统没开。要启用登录和账号，设置 WEIDU_AUTH=on。";

export async function errorJson(message: string, status: number, extra?: Record<string, unknown>) {
  let text = message;
  try {
    text = localize(await resolveRequestLocale(), message);
  } catch {
    text = message;
  }
  return Response.json({ error: text, ...extra }, { status });
}

const LOCAL_OWNER: AuthUser = {
  uid: LOCAL_USER_ID,
  type: "owner",
  display: "站长",
  credentialVersion: 0,
};

export async function requireUser(): Promise<AuthUser | Response> {
  if (!authEnabled()) return { ...LOCAL_OWNER };
  const session = await getSession();
  if (!session) return errorJson("未登录", 401);
  const account = await resolveSessionAccount(session.uid, session.credentialVersion);
  if (!account || account.disabled) return errorJson(account?.disabled ? "这个账号已停用。" : "未登录", 401);
  return account;
}

export async function requireOwner(): Promise<AuthUser | Response> {
  if (!authEnabled()) return errorJson(AUTH_OFF_MESSAGE, 403);
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (user.type !== "owner") return errorJson("只有站长可以管理账号。", 403);
  return user;
}

export function isResponse<T>(value: T | Response): value is Response {
  return value instanceof Response;
}

export async function readJson(request: Request): Promise<unknown | Response> {
  try {
    return await request.json();
  } catch {
    return errorJson("请求不是 JSON。", 400);
  }
}
