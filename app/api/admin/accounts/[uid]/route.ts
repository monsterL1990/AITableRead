import { removeAccount, updateAccount } from "@/lib/accounts";
import { errorJson, isResponse, readJson, requireOwner } from "@/lib/api";
import { purgeUserData } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ uid: string }> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export async function PATCH(request: Request, context: Params) {
  const user = await requireOwner();
  if (isResponse(user)) return user;
  const { uid } = await context.params;
  const body = await readJson(request);
  if (body instanceof Response) return body;
  if (!isRecord(body)) return errorJson("请求格式不对。", 400);
  const patch: { disabled?: boolean; password?: string } = {};
  if (body.disabled !== undefined) {
    if (typeof body.disabled !== "boolean") return errorJson("停用标记不对。", 400);
    patch.disabled = body.disabled;
  }
  if (body.password !== undefined) {
    if (typeof body.password !== "string") return errorJson("口令要写成文本。", 400);
    patch.password = body.password;
  }
  try {
    const updated = await updateAccount(decodeURIComponent(uid), patch);
    if (!updated.ok) return errorJson(updated.error, updated.status);
    return Response.json({ account: updated.account });
  } catch {
    return errorJson("账号没能改。", 500);
  }
}

export async function DELETE(_request: Request, context: Params) {
  const user = await requireOwner();
  if (isResponse(user)) return user;
  const { uid } = await context.params;
  const name = decodeURIComponent(uid);
  try {
    await purgeUserData(name);
    const removed = await removeAccount(name);
    if (!removed.ok) return errorJson(removed.error, removed.status);
    return Response.json({ ok: true });
  } catch {
    return errorJson("账号没能删除。", 500);
  }
}
