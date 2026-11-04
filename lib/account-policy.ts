import { EMPTY_CUSTOM_API, toPublicCustomApi } from "./custom-api";
import { getDshConfig, readDshModelCatalog, type DshEnv } from "./dsh";
import { catalogFromValue, matchDshModel } from "./dsh-catalog";
import { mergeDshEnv, toPublicDshConnection } from "./dsh-setup";
import type { StoredSettings } from "./store";
import { describeTextRoute, publicConfigRouteFields, resolveTextRoute, type RouteEnv } from "./text-route";
import type { AccountType, CustomApiConfig, DshModelRef, PreferredTextRoute, PublicConfig, SettingsVisibility, StoredDshConnection, TextRoute } from "./types";

export const DEFAULT_PRESET_DSH_MODEL: DshModelRef = { provider: "xai-oauth", model: "grok-4.7" };
export const DEFAULT_PRESET_DS_MODEL: DshModelRef = { provider: "deepseek-official", model: "deepseek-flash" };

/** 旧账号文件里的 preset 就是现在的预设 Grok。 */
export function canonicalAccountType(value: unknown): AccountType | null {
  if (value === "preset" || value === "preset-grok") return "preset-grok";
  if (value === "preset-ds") return "preset-ds";
  if (value === "owner" || value === "custom") return value;
  return null;
}

export function isPresetAccount(type: AccountType | null | undefined): boolean {
  return type === "preset-grok" || type === "preset-ds";
}

type PolicyEnv = RouteEnv & {
  GAOJIAN_PRESET_DSH_PROVIDER?: string;
  GAOJIAN_PRESET_DSH_MODEL?: string;
  GAOJIAN_PRESET_DS_PROVIDER?: string;
  GAOJIAN_PRESET_DS_MODEL?: string;
};

export type AccountTextRoute = {
  route: TextRoute;
  customApi: CustomApiConfig;
  dshModel: DshModelRef | null;
  /** 自备 Key 经 DSH 临时 provider。开源单机版的设置不再打开这条。 */
  ephemeralProvider: boolean;
  /** 预设 DeepSeek 的模型必须先在站点目录里对上，才能 selectModel。 */
  mustMatchCatalog: boolean;
  /** 这一轮要用的 DSH 环境。稿库连接盖过进程环境。没有保存的连接时可能为空。 */
  dshEnv?: DshEnv;
};

/** 开源单机版不把自备 Key 送进 purge。保留函数是为了旧调用点，结果恒为 false。 */
export function byokPurgeActive(config?: {
  purgeEnabled?: boolean;
  accountType?: AccountType | null;
  preferredTextRoute?: PreferredTextRoute | null;
}): boolean {
  void config;
  return false;
}

function envModel(provider: string | undefined, model: string | undefined, fallback: DshModelRef): DshModelRef {
  const nextProvider = provider?.trim() || fallback.provider;
  const nextModel = model?.trim() || fallback.model;
  if (!nextProvider || !nextModel || nextProvider.length > 120 || nextModel.length > 120) return { ...fallback };
  if (/[\r\n]/.test(nextProvider) || /[\r\n]/.test(nextModel)) return { ...fallback };
  return { provider: nextProvider, model: nextModel };
}

/** 预设 Grok 吃站点 DSH 上的默认 Grok。沿用 GAOJIAN_PRESET_DSH_*，不改就不写。 */
export function presetDshModel(env?: PolicyEnv): DshModelRef {
  const source = env ?? process.env;
  return envModel(source.GAOJIAN_PRESET_DSH_PROVIDER, source.GAOJIAN_PRESET_DSH_MODEL, DEFAULT_PRESET_DSH_MODEL);
}

/** 预设 DeepSeek。默认是目录里的 deepseek-official / deepseek-flash，可用 GAOJIAN_PRESET_DS_* 覆盖。 */
export function presetDsModel(env?: PolicyEnv): DshModelRef {
  const source = env ?? process.env;
  return envModel(source.GAOJIAN_PRESET_DS_PROVIDER, source.GAOJIAN_PRESET_DS_MODEL, DEFAULT_PRESET_DS_MODEL);
}

export function settingsVisibility(type: AccountType): SettingsVisibility {
  if (type === "owner") return "full";
  if (type === "custom") return "custom-only";
  return "hidden";
}

/** 设置按钮和设置页上半截按这个收。预设账号两样都没有。 */
export function settingsSections(visibility: SettingsVisibility): {
  showSettingsNav: boolean;
  showRoutePicker: boolean;
  showDshModel: boolean;
  showCustomApi: boolean;
} {
  return {
    showSettingsNav: visibility !== "hidden",
    showRoutePicker: visibility === "full",
    showDshModel: visibility === "full",
    showCustomApi: visibility !== "hidden",
  };
}

/**
 * 出字实际用的路由。
 * 预设 Grok / 预设 DeepSeek：只经 DSH，模型固定，不看稿库里的路由和自定义密钥。围读不要求 purge。
 * 预设 DeepSeek 的模型还要对上站点目录，这一步在出字前做。
 * 非预设：默认只走自己的自定义 API，直连，不把 Key 送进 DSH。
 * 站长：稿库里选什么就是什么。选了 DSH 就用稿库里的连接（没有则用环境变量）。
 */
export function applyAccountTextPolicy(type: AccountType, stored: StoredSettings, env?: PolicyEnv): AccountTextRoute {
  const routeEnv = mergeDshEnv(stored, env);
  if (isPresetAccount(type)) {
    const dsh = getDshConfig(env);
    if (!dsh.configured) {
      throw new Error("预设账号只经 DSH 出字。站点还没配齐 DSH，这次没有提交。");
    }
    const deepseek = type === "preset-ds";
    return {
      route: "dsh",
      customApi: { ...EMPTY_CUSTOM_API },
      dshModel: deepseek ? presetDsModel(env) : presetDshModel(env),
      ephemeralProvider: false,
      mustMatchCatalog: deepseek,
      dshEnv: env,
    };
  }
  if (type === "custom") {
    return {
      route: "custom",
      customApi: { ...stored.customApi },
      dshModel: null,
      ephemeralProvider: false,
      mustMatchCatalog: false,
      dshEnv: routeEnv,
    };
  }
  const route = resolveTextRoute(routeEnv, stored.preferredTextRoute);
  return {
    route,
    customApi: { ...stored.customApi },
    dshModel: stored.dshModel ? { ...stored.dshModel } : null,
    ephemeralProvider: false,
    mustMatchCatalog: false,
    dshEnv: routeEnv,
  };
}

/**
 * 预设 DeepSeek 出字前对照 session/modelCatalog。
 * 目录没拉下来，或环境变量指到目录里没有的一对，就不提交，也不改用 Grok。
 */
export async function lockPresetDsModel(
  active: AccountTextRoute,
  deps?: { readCatalog?: () => Promise<unknown> },
): Promise<AccountTextRoute> {
  if (!active.mustMatchCatalog) return active;
  const wanted = active.dshModel;
  if (!wanted) throw new Error("预设 DeepSeek 没有可用模型。这次没有提交。原稿保持不变。");
  let value: unknown;
  try {
    value = await (deps?.readCatalog ?? readDshModelCatalog)();
  } catch {
    throw new Error("预设 DeepSeek 要对照站点模型目录，这次没拉下来。没有提交。原稿保持不变。");
  }
  const matched = matchDshModel(wanted, catalogFromValue(value).options);
  if (!matched.ok) {
    throw new Error(
      `预设 DeepSeek 的模型不在当前 DSH 目录里（${wanted.provider} / ${wanted.model}）。这次没有提交。原稿保持不变。`,
    );
  }
  return { ...active, dshModel: matched.model };
}

type SettingsPatch = {
  preferredTextRoute?: PreferredTextRoute;
  customApi?: CustomApiConfig;
  dshModel?: DshModelRef | null;
  dsh?: StoredDshConnection;
  purgeEnabled?: boolean;
};

const PURGE_NOT_REQUIRED = "围读不要求 purge。插件要在你自己的 DSH 上安装。";

export function settingsWrite(
  type: AccountType,
  patch: SettingsPatch,
): { ok: true; patch: SettingsPatch } | { ok: false; status: number; error: string } {
  if (isPresetAccount(type)) return { ok: false, status: 403, error: "预设账号不能改出字设置。" };
  const rest: SettingsPatch = { ...patch };
  delete rest.purgeEnabled;
  const hasWork = Boolean(rest.preferredTextRoute || rest.customApi || rest.dshModel !== undefined || rest.dsh);
  if (patch.purgeEnabled !== undefined && !hasWork) return { ok: false, status: 400, error: PURGE_NOT_REQUIRED };
  if (type === "custom") {
    if (rest.dsh) return { ok: false, status: 400, error: "这个账号不连接 DSH。" };
    if (rest.preferredTextRoute && rest.preferredTextRoute !== "custom") {
      return { ok: false, status: 400, error: "这个账号只能使用自定义 API，不能改经 DSH 或环境里的 OpenAI 兼容接口。" };
    }
    if (rest.dshModel !== undefined) return { ok: false, status: 400, error: "这个账号不经 DSH，不能改模型。" };
    if (!rest.customApi && !rest.preferredTextRoute) return { ok: false, status: 400, error: "没有要保存的设置。" };
    return {
      ok: true,
      patch: {
        preferredTextRoute: "custom",
        dshModel: null,
        ...(rest.customApi ? { customApi: rest.customApi } : {}),
      },
    };
  }
  const next: SettingsPatch = {};
  if (rest.preferredTextRoute) next.preferredTextRoute = rest.preferredTextRoute;
  if (rest.customApi) next.customApi = rest.customApi;
  if (rest.dshModel !== undefined) next.dshModel = rest.dshModel;
  if (rest.dsh) next.dsh = rest.dsh;
  if (!next.preferredTextRoute && !next.customApi && next.dshModel === undefined && !next.dsh) {
    return { ok: false, status: 400, error: "没有要保存的设置。" };
  }
  return { ok: true, patch: next };
}

/** `/api/config` 按账号类型说明出字。预设不带自定义密钥，也不给设置入口。 */
export function publicConfigForAccount(
  type: AccountType,
  stored: StoredSettings,
  env: PolicyEnv | undefined,
  extras: { devPasswordHint: boolean; authConfigured: boolean },
): PublicConfig {
  if (isPresetAccount(type)) {
    const dsh = getDshConfig(env);
    const model = type === "preset-ds" ? presetDsModel(env) : presetDshModel(env);
    const base = publicConfigRouteFields(env, "dsh", extras, EMPTY_CUSTOM_API, model);
    return {
      ...base,
      demoMode: false,
      model: null,
      baseUrl: null,
      textRoute: "dsh",
      preferredTextRoute: "dsh",
      dshConfigured: dsh.configured,
      dshMissing: dsh.missing,
      textRouteNote: dsh.configured ? "" : "站点还没配齐 DSH，预设账号这次不能出字。",
      customApi: toPublicCustomApi(EMPTY_CUSTOM_API),
      dshModel: model,
      purgeEnabled: false,
      accountType: type,
      settingsVisibility: "hidden",
    };
  }
  const routeEnv = mergeDshEnv(stored, env);
  if (type === "custom") {
    const described = describeTextRoute(routeEnv, "custom", stored.customApi);
    const config = publicConfigRouteFields(routeEnv, "custom", extras, stored.customApi, null);
    return {
      ...config,
      textRoute: described.textRoute,
      preferredTextRoute: "custom",
      textRouteNote: described.textRouteNote,
      dshModel: null,
      purgeEnabled: false,
      accountType: "custom",
      settingsVisibility: "custom-only",
    };
  }
  const described = describeTextRoute(routeEnv, stored.preferredTextRoute, stored.customApi);
  return {
    ...publicConfigRouteFields(routeEnv, stored.preferredTextRoute, extras, stored.customApi, stored.dshModel),
    textRouteNote: described.textRouteNote,
    purgeEnabled: false,
    accountType: "owner",
    settingsVisibility: "full",
  };
}

/** 设置页和 `/api/settings` 用的出字说明。不含登录提示。 */
export function accountSettingsFields(type: "owner" | "custom", stored: StoredSettings, env?: PolicyEnv) {
  const config = publicConfigForAccount(type, stored, env, { devPasswordHint: false, authConfigured: true });
  return {
    textRoute: config.textRoute,
    dshConfigured: config.dshConfigured,
    dshMissing: config.dshMissing,
    preferredTextRoute: config.preferredTextRoute,
    textRouteNote: config.textRouteNote,
    customApi: config.customApi,
    dshModel: config.dshModel,
    dshConnection: toPublicDshConnection(stored.dsh),
    purgeEnabled: false,
  };
}
