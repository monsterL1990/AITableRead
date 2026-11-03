import { EMPTY_CUSTOM_API, customIncompleteMessage, requireCustomLlmConfig, toPublicCustomApi } from "./custom-api";
import { getDshConfig, type DshEnv } from "./dsh";
import type { EphemeralCredential } from "./dsh-ephemeral";
import { routeMark } from "./format";
import { getLlmConfig, type LlmConfig } from "./llm";
import type { CustomApiConfig, DshModelRef, PreferredTextRoute, PublicConfig, TextRoute, TextRouteSettings } from "./types";

export { routeMark };

export type RouteEnv = DshEnv & {
  OPENAI_BASE_URL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
};

/**
 * 出字走哪条路。
 * preference 缺省或为 null：配齐 DSH 则 dsh，否则环境里的 OpenAI 兼容接口，再不行是演示稿。
 * preference 为 cliproxy：即使 DSH 已配齐也不走 DSH。界面把这条叫做 OpenAI 兼容接口（.env）。
 * preference 为 dsh 但环境未配齐：退回 OpenAI 兼容接口或演示稿。
 * preference 为 custom：始终是设置里保存的自定义 API，不退回环境变量或演示稿。没填全时由调用方报错。
 */
export function resolveTextRoute(env?: RouteEnv, preference?: PreferredTextRoute | null): TextRoute {
  if (preference === "custom") return "custom";
  const dshReady = getDshConfig(env).configured;
  const preferDsh = preference == null ? dshReady : preference === "dsh";
  if (preferDsh && dshReady) return "dsh";
  if (getLlmConfig(env).demo) return "demo";
  return "cliproxy";
}

export function defaultPreferredTextRoute(env?: RouteEnv): PreferredTextRoute {
  return getDshConfig(env).configured ? "dsh" : "cliproxy";
}

export type GenerationPlan =
  | { transport: "demo" }
  | { transport: "dsh" }
  | { transport: "dsh-ephemeral"; credential: EphemeralCredential }
  | { transport: "cliproxy"; llm: LlmConfig }
  | { transport: "custom"; llm: LlmConfig };

/**
 * 生成、读者生成共用的出字选择。custom 只用稿库里的接口，不用环境里的 OpenAI 兼容接口密钥。
 * ephemeralProvider 为真时不直连：DSH 没配齐就报错，Remote 未就绪由 DSH 客户端再报，不改成直连。
 */
export function planGeneration(
  route: TextRoute,
  customApi?: CustomApiConfig | null,
  env?: RouteEnv,
  options?: { ephemeralProvider?: boolean },
): GenerationPlan {
  if (options?.ephemeralProvider) {
    const llm = requireCustomLlmConfig(customApi ?? EMPTY_CUSTOM_API);
    const dsh = getDshConfig(env);
    if (!dsh.configured) {
      const why =
        dsh.missing.length > 0 && dsh.missing.length < 3 ? `未配齐 DSH（缺 ${dsh.missing.join("、")}）` : "未配齐 DSH";
      throw new Error(`${why}。已打开经 DSH purge，这次不会改成直连，也不会换成演示稿。原稿保持不变。`);
    }
    return { transport: "dsh-ephemeral", credential: { baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model } };
  }
  if (route === "custom") return { transport: "custom", llm: requireCustomLlmConfig(customApi ?? EMPTY_CUSTOM_API) };
  if (route === "dsh") return { transport: "dsh" };
  if (route === "demo") return { transport: "demo" };
  return { transport: "cliproxy", llm: getLlmConfig(env) };
}

/** 出字前就能确定的失败用 400，稿库本身坏了才是 500。 */
export function routeClientStatus(message: string): number {
  if (
    message.startsWith("自定义 API") ||
    message.startsWith("预设") ||
    message.startsWith("未配齐 DSH") ||
    message.startsWith("已打开经 DSH purge") ||
    message.startsWith("自备 Key") ||
    message.startsWith("DSH ephemeral")
  ) {
    return 400;
  }
  return 500;
}

function unmetPreferenceNote(preferred: PreferredTextRoute, route: TextRoute, dshMissing: string[]): string {
  if (preferred === "dsh" && route !== "dsh") {
    const why =
      dshMissing.length > 0 && dshMissing.length < 3 ? `未配齐 DSH（缺 ${dshMissing.join("、")}）` : "未配齐 DSH";
    return route === "demo" ? `${why}，OpenAI 兼容接口也未接上，出字仍是演示稿。` : `${why}，出字改为经 OpenAI 兼容接口。`;
  }
  if (preferred === "cliproxy" && route !== "cliproxy") {
    return "环境里的 OpenAI 兼容接口还没接上模型，出字仍是演示稿。";
  }
  return "";
}

/** `/api/config` 和设置页共用的出字路由说明。 */
export function describeTextRoute(
  env?: RouteEnv,
  stored?: PreferredTextRoute | null,
  customApi?: CustomApiConfig | null,
): TextRouteSettings {
  const dsh = getDshConfig(env);
  const preferredTextRoute = stored ?? defaultPreferredTextRoute(env);
  const textRoute = resolveTextRoute(env, stored);
  const custom = toPublicCustomApi(customApi ?? EMPTY_CUSTOM_API);
  const textRouteNote =
    preferredTextRoute === "custom"
      ? custom.configured
        ? ""
        : customIncompleteMessage(custom.missing)
      : unmetPreferenceNote(preferredTextRoute, textRoute, dsh.missing);
  return {
    textRoute,
    dshConfigured: dsh.configured,
    dshMissing: dsh.missing,
    preferredTextRoute,
    textRouteNote,
    customApi: custom,
  };
}

export function parsePreferredTextRoute(
  value: unknown,
  dshConfigured: boolean,
): { ok: true; route: PreferredTextRoute } | { ok: false; error: string } {
  if (value !== "dsh" && value !== "cliproxy" && value !== "custom") {
    return { ok: false, error: "出字路由只能是经 DSH、环境里的 OpenAI 兼容接口，或自定义 API。" };
  }
  if (value === "dsh" && !dshConfigured) {
    return { ok: false, error: "未配齐 DSH，不能改走这条。" };
  }
  return { ok: true, route: value };
}

/** 组装 `/api/config` 的 JSON。不含密钥。自定义 API 的密钥只给掩码。 */
export function publicConfigRouteFields(
  env: RouteEnv | undefined,
  stored: PreferredTextRoute | null,
  extras: { devPasswordHint: boolean; authConfigured: boolean },
  customApi?: CustomApiConfig | null,
  dshModel?: DshModelRef | null,
): PublicConfig {
  const llm = getLlmConfig(env);
  const route = describeTextRoute(env, stored, customApi);
  const customView = route.textRoute === "custom";
  return {
    demoMode: route.textRoute === "demo",
    missing: llm.missing,
    model: customView ? route.customApi.model || null : route.textRoute === "cliproxy" ? llm.model : null,
    baseUrl: customView ? route.customApi.baseUrl || null : route.textRoute === "cliproxy" ? llm.baseUrl : null,
    devPasswordHint: extras.devPasswordHint,
    authConfigured: extras.authConfigured,
    textRoute: route.textRoute,
    dshConfigured: route.dshConfigured,
    dshMissing: route.dshMissing,
    preferredTextRoute: route.preferredTextRoute,
    textRouteNote: route.textRouteNote,
    customApi: route.customApi,
    dshModel: dshModel ?? null,
  };
}
