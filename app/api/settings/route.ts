import { accountSettingsFields, isPresetAccount, settingsVisibility, settingsWrite } from "@/lib/account-policy";
import { errorJson, isResponse, readJson, requireUser } from "@/lib/api";
import { customSelectionError, parseCustomApiPatch } from "@/lib/custom-api";
import { catalogFromValue, emptyDshCatalog, matchDshModel } from "@/lib/dsh-catalog";
import { getDshConfig, inspectDshConnection, readDshModelCatalog, type DshEnv } from "@/lib/dsh";
import { emptyDshConnection, mergeDshEnv, parseDshConnectionPatch } from "@/lib/dsh-setup";
import { getSettings, updateTextSettings } from "@/lib/store";
import { parsePreferredTextRoute } from "@/lib/text-route";
import type { CustomApiConfig, DshCatalogView, DshModelRef, PreferredTextRoute, SettingsVisibility, StoredDshConnection } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function loadDshCatalog(env?: DshEnv): Promise<DshCatalogView> {
  if (!getDshConfig(env).configured) return emptyDshCatalog("未配齐 DSH，不能拉模型目录。");
  try {
    return catalogFromValue(await readDshModelCatalog({ env }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "模型目录没拉下来。";
    return emptyDshCatalog(message);
  }
}

function settingsBody(
  described: ReturnType<typeof accountSettingsFields>,
  dshCatalog: DshCatalogView,
  type: "owner" | "custom",
  visibility: SettingsVisibility,
) {
  return { ...described, dshCatalog, accountType: type, settingsVisibility: visibility };
}

export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const visibility = settingsVisibility(user.type);
  if (visibility === "hidden" || isPresetAccount(user.type)) return errorJson("预设账号没有出字设置。", 403);
  try {
    const stored = await getSettings(user.uid);
    const described = accountSettingsFields(user.type === "custom" ? "custom" : "owner", stored);
    if (user.type === "custom") {
      return Response.json(settingsBody(described, emptyDshCatalog("这个账号不经 DSH。"), "custom", visibility));
    }
    const dshCatalog = await loadDshCatalog(mergeDshEnv(stored));
    return Response.json(settingsBody(described, dshCatalog, "owner", visibility));
  } catch {
    return errorJson("稿库读不出来，请检查 data/store.json。", 500);
  }
}

export async function PATCH(request: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  if (isPresetAccount(user.type)) return errorJson("预设账号不能改出字设置。", 403);
  const body = await readJson(request);
  if (body instanceof Response) return body;
  if (!isRecord(body)) return errorJson("请求格式不对。", 400);
  const hasRoute = "preferredTextRoute" in body;
  const hasCustom = "customApi" in body;
  const hasDshModel = "dshModel" in body;
  const hasDsh = "dsh" in body;
  const hasPurge = "purgeEnabled" in body;
  if (!hasRoute && !hasCustom && !hasDshModel && !hasDsh && !hasPurge) return errorJson("没有要保存的设置。", 400);
  if (hasPurge && typeof body.purgeEnabled !== "boolean") return errorJson("请求格式不对。", 400);
  if (user.type === "custom" && hasDshModel) return errorJson("这个账号不经 DSH，不能改模型。", 400);
  if (user.type === "custom" && hasDsh) return errorJson("这个账号不连接 DSH。", 400);
  if (user.type === "custom" && hasRoute && body.preferredTextRoute !== "custom") {
    return errorJson("这个账号只能使用自定义 API，不能改经 DSH 或环境里的 OpenAI 兼容接口。", 400);
  }

  let current;
  try {
    current = await getSettings(user.uid);
  } catch {
    return errorJson("稿库读不出来，请检查 data/store.json。", 500);
  }

  let dshConnection: StoredDshConnection | undefined;
  let inspectedCatalog: DshCatalogView | null = null;
  if (hasDsh && user.type === "owner") {
    const parsed = parseDshConnectionPatch(body.dsh, current.dsh ?? emptyDshConnection());
    if (!parsed.ok) return errorJson(parsed.error, 400);
    let inspected;
    try {
      const signal = AbortSignal.timeout(8_000);
      inspected = await inspectDshConnection(
        {
          baseUrl: parsed.connection.baseUrl,
          token: parsed.connection.token,
          basicUser: parsed.connection.basicUser,
          basicPassword: parsed.connection.basicPassword,
        },
        { signal },
      );
    } catch (error) {
      const aborted = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      const message = aborted ? "连接测试超时，没有一直等下去。" : error instanceof Error ? error.message : "连不上这台 DSH。";
      return errorJson(message, 400);
    }
    if (!inspected.sessions.some((item) => item.sessionId === parsed.connection.sessionId)) {
      return errorJson("这台 DSH 上没有这个会话。请重新测试连接。", 400);
    }
    dshConnection = parsed.connection;
    inspectedCatalog = inspected.catalog;
  }

  const pending = dshConnection ? { ...current, dsh: dshConnection } : current;
  const dshReady = getDshConfig(mergeDshEnv(pending)).configured;

  let route: PreferredTextRoute | undefined;
  if (hasRoute) {
    const parsed = parsePreferredTextRoute(body.preferredTextRoute, dshReady);
    if (!parsed.ok) return errorJson(parsed.error, 400);
    route = parsed.route;
  }

  let customApi: CustomApiConfig | undefined;
  if (hasCustom) {
    const parsed = parseCustomApiPatch(body.customApi, current.customApi);
    if (!parsed.ok) return errorJson(parsed.error, 400);
    customApi = parsed.config;
  }

  let dshModel: DshModelRef | null | undefined;
  if (hasDshModel && user.type === "owner") {
    if (body.dshModel === null) {
      dshModel = null;
    } else {
      const catalog = inspectedCatalog ?? (await loadDshCatalog(mergeDshEnv(pending)));
      if (!catalog.loaded) return errorJson(catalog.error || "模型目录没拉下来，这次不能改 DSH 模型。", 400);
      const parsed = matchDshModel(body.dshModel, catalog.options);
      if (!parsed.ok) return errorJson(parsed.error, 400);
      dshModel = parsed.model;
    }
  }

  const decision = settingsWrite(user.type, {
    ...(route ? { preferredTextRoute: route } : {}),
    ...(customApi ? { customApi } : {}),
    ...(hasDshModel ? { dshModel: dshModel ?? null } : {}),
    ...(dshConnection ? { dsh: dshConnection } : {}),
    ...(hasPurge ? { purgeEnabled: body.purgeEnabled === true } : {}),
  });
  if (!decision.ok) return errorJson(decision.error, decision.status);

  const nextCustom = decision.patch.customApi ?? current.customApi;
  const nextRoute = decision.patch.preferredTextRoute ?? current.preferredTextRoute;
  if (user.type === "owner" && nextRoute === "custom") {
    const blocked = customSelectionError(nextCustom);
    if (blocked) return errorJson(blocked, 400);
  }
  if (user.type === "custom" && route === "custom") {
    const blocked = customSelectionError(nextCustom);
    if (blocked) return errorJson(blocked, 400);
  }

  try {
    const saved = await updateTextSettings(decision.patch, user.uid);
    const visibility = settingsVisibility(user.type);
    const described = accountSettingsFields(user.type === "custom" ? "custom" : "owner", saved);
    if (user.type === "custom") {
      return Response.json(settingsBody(described, emptyDshCatalog("这个账号不经 DSH。"), "custom", visibility));
    }
    const dshCatalog = inspectedCatalog ?? (await loadDshCatalog(mergeDshEnv(saved)));
    return Response.json(settingsBody(described, dshCatalog, "owner", visibility));
  } catch {
    return errorJson("出字路由没能保存。", 500);
  }
}
