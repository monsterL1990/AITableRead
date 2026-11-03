import { canonicalAccountType } from "@/lib/account-policy";
import { createAccount, listAccounts } from "@/lib/accounts";
import { errorJson, isResponse, readJson, requireOwner } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export async function GET() {
  const user = await requireOwner();
  if (isResponse(user)) return user;
  try {
    return Response.json({ accounts: await listAccounts() });
  } catch {
    return errorJson("账号库读不出来。", 500);
  }
}

export async function POST(request: Request) {
  const user = await requireOwner();
  if (isResponse(user)) return user;
  const body = await readJson(request);
  if (body instanceof Response) return body;
  if (!isRecord(body)) return errorJson("请求格式不对。", 400);
  const uid = typeof body.uid === "string" ? body.uid : "";
  const password = typeof body.password === "string" ? body.password : "";
  const display = typeof body.display === "string" ? body.display : "";
  const type = canonicalAccountType(body.type);
  if (!type || type === "owner") return errorJson("账号类型只能是预设 Grok、预设 DeepSeek，或非预设模型。", 400);
  try {
    const created = await createAccount({ uid, password, display, type });
    if (!created.ok) return errorJson(created.error, created.status);
    return Response.json({ account: created.account }, { status: 201 });
  } catch {
    return errorJson("账号没能建起来。", 500);
  }
}
