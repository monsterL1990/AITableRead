import { isPresetAccount } from "@/lib/account-policy";
import { errorJson, isResponse, readJson, requireUser } from "@/lib/api";
import { inspectDshConnection } from "@/lib/dsh";
import { DSH_CONNECT_TIMEOUT_MS, parseDshBrowserUrl, parseProbePorts, probeLocalDshPorts, probePortsFromEnv, readDshTokenInput } from "@/lib/dsh-setup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (isPresetAccount(user.type) || user.type === "custom") return errorJson("这个账号不连接 DSH。", 403);
  const body = await readJson(request);
  if (body instanceof Response) return body;
  if (!isRecord(body)) return errorJson("请求格式不对。", 400);
  if (body.action === "probe") return probe(body);
  if (body.action === "test") return testConnection(body);
  return errorJson("不知道要做哪一步。", 400);
}

async function probe(body: Record<string, unknown>) {
  const fallback = probePortsFromEnv();
  if ("ports" in body) {
    const parsed = parseProbePorts(body.ports, []);
    if (parsed.length === 0) return errorJson("没有可用的端口。", 400);
    const results = await probeLocalDshPorts(parsed);
    return Response.json({ results });
  }
  const results = await probeLocalDshPorts(fallback);
  return Response.json({ results });
}

async function testConnection(body: Record<string, unknown>) {
  const read = readDshTokenInput(typeof body.token === "string" ? body.token : "");
  const baseSource = typeof body.baseUrl === "string" && body.baseUrl.trim() ? body.baseUrl : read.baseUrl;
  const parsed = parseDshBrowserUrl(baseSource);
  if (!parsed.ok) return errorJson(parsed.error, 400);
  if (parsed.basicUser || parsed.basicPassword) {
    return errorJson("地址里不要写用户名和密码，请填到 Basic Auth。", 400);
  }
  const token = read.token;
  if (!token) return errorJson("要填写 DSH 令牌。", 400);
  const basicUser = typeof body.basicUser === "string" ? body.basicUser.trim() : "";
  const basicPassword = typeof body.basicPassword === "string" ? body.basicPassword : "";
  if (basicUser && !basicPassword) return errorJson("填了 Basic Auth 用户名，还要密码。", 400);
  try {
    const signal = AbortSignal.timeout(DSH_CONNECT_TIMEOUT_MS);
    const inspected = await inspectDshConnection(
      { baseUrl: parsed.baseUrl, token, basicUser, basicPassword: basicUser ? basicPassword : "" },
      { signal },
    );
    return Response.json({ baseUrl: parsed.baseUrl, sessions: inspected.sessions, catalog: inspected.catalog });
  } catch (error) {
    const aborted = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    const message = aborted ? "连接测试超时，没有一直等下去。" : error instanceof Error ? error.message : "连不上这台 DSH。";
    return errorJson(message, 400);
  }
}
