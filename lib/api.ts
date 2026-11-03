import { resolveSessionAccount, type AuthUser } from "./accounts";
import { getSession } from "./auth";

export type { AuthUser };

export function errorJson(message: string, status: number, extra?: Record<string, unknown>) {
  return Response.json({ error: message, ...extra }, { status });
}

export async function requireUser(): Promise<AuthUser | Response> {
  const session = await getSession();
  if (!session) return errorJson("未登录", 401);
  const account = await resolveSessionAccount(session.uid, session.credentialVersion);
  if (!account || account.disabled) return errorJson(account?.disabled ? "这个账号已停用。" : "未登录", 401);
  return account;
}

export async function requireOwner(): Promise<AuthUser | Response> {
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
