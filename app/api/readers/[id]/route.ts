import { errorJson, isResponse, readJson, requireUser } from "@/lib/api";
import { lengthError } from "@/lib/pipeline";
import { deleteReader, updateReader } from "@/lib/store";
import { LIMITS } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Params) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await context.params;
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const record = (body ?? {}) as Record<string, unknown>;
  const patch: { name?: string; blurb?: string; prompt?: string; blocked?: boolean } = {};
  if (record.name !== undefined) {
    if (typeof record.name !== "string" || !record.name.trim()) return errorJson("读者要有名字。", 400);
    if (record.name.trim().length > LIMITS.readerName) return errorJson("读者名字太长。", 400);
    patch.name = record.name.trim();
  }
  if (record.blurb !== undefined) {
    if (typeof record.blurb !== "string") return errorJson("简介必须是文本。", 400);
    if (record.blurb.length > LIMITS.readerBlurb) return errorJson("读者简介太长。", 400);
    patch.blurb = record.blurb;
  }
  if (record.prompt !== undefined) {
    if (typeof record.prompt !== "string" || !record.prompt.trim()) return errorJson("提示词不能为空。", 400);
    const issue = lengthError("prompt", record.prompt);
    if (issue) return errorJson(issue, 400);
    patch.prompt = record.prompt;
  }
  if (record.blocked !== undefined) {
    if (typeof record.blocked !== "boolean") return errorJson("屏蔽标记不对。", 400);
    patch.blocked = record.blocked;
  }
  try {
    const reader = await updateReader(id, patch, user.uid);
    if (!reader) return errorJson("没有这位读者。", 404);
    return Response.json({ reader });
  } catch {
    return errorJson("读者没能保存。", 500);
  }
}

export async function DELETE(_request: Request, context: Params) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await context.params;
  try {
    const removed = await deleteReader(id, user.uid);
    if (!removed) return errorJson("没有这位读者。", 404);
    return Response.json({ ok: true });
  } catch {
    return errorJson("读者没能删除。", 500);
  }
}
