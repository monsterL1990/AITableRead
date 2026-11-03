import { EMPTY_CUSTOM_API, toPublicCustomApi } from "./custom-api";
import { getDshConfig, readDshModelCatalog } from "./dsh";
import { catalogFromValue, matchDshModel } from "./dsh-catalog";
import type { StoredSettings } from "./store";
import { describeTextRoute, publicConfigRouteFields, resolveTextRoute, type RouteEnv } from "./text-route";
import type { AccountType, CustomApiConfig, DshModelRef, PreferredTextRoute, PublicConfig, SettingsVisibility, TextRoute } from "./types";

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
  /** 自备 Key 经 DSH 临时 provider。预设账号的强制 DSH 不是这条。 */
  ephemeralProvider: boolean;
  /** 预设 DeepSeek 的模型必须先在站点目录里对上，才能 selectModel。 */
  mustMatchCatalog: boolean;
};

export function byokPurgeActive(config: {
  purgeEnabled?: boolean;
  accountType?: AccountType | null;
  preferredTextRoute?: PreferredTextRoute | null;
}): boolean {
  if (config.purgeEnabled !== true || isPresetAccount(config.accountType)) return false;
  return config.accountType === "custom" || config.preferredTextRoute === "custom";
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
 * 预设 Grok / 预设 DeepSeek：只经 DSH，模型固定，稿库里的路由、自定义密钥和 purge 开关都不看。
 * 预设 DeepSeek 的模型还要对上站点目录，这一步在出字前做。
 * 非预设：默认只走自己的自定义 API。purge 开着则仍用这把 Key，但改经 DSH 临时 provider。
 * 站长：稿库里选什么就是什么。选了自定义 API 且 purge 开着时，同样走临时 provider。
 */
export function applyAccountTextPolicy(type: AccountType, stored: StoredSettings, env?: PolicyEnv): AccountTextRoute {
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
    };
  }
  const purge = stored.purgeEnabled === true;
  if (type === "custom") {
    return { route: "custom", customApi: { ...stored.customApi }, dshModel: null, ephemeralProvider: purge, mustMatchCatalog: false };
  }
  const route = resolveTextRoute(env, stored.preferredTextRoute);
  return {
    route,
    customApi: { ...stored.customApi },
    dshModel: stored.dshModel ? { ...stored.dshModel } : null,
    ephemeralProvider: purge && route === "custom",
    mustMatchCatalog: false,
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
  purgeEnabled?: boolean;
};

export function settingsWrite(
  type: AccountType,
  patch: SettingsPatch,
): { ok: true; patch: SettingsPatch } | { ok: false; status: number; error: string } {
  if (isPresetAccount(type)) return { ok: false, status: 403, error: "预设账号不能改出字设置。" };
  if (type === "custom") {
    if (patch.preferredTextRoute && patch.preferredTextRoute !== "custom") {
      return { ok: false, status: 400, error: "这个账号只能使用自定义 API，不能改经 DSH 或环境里的 OpenAI 兼容接口。" };
    }
    if (patch.dshModel !== undefined) return { ok: false, status: 400, error: "这个账号不经 DSH，不能改模型。" };
    if (!patch.customApi && !patch.preferredTextRoute && patch.purgeEnabled === undefined) {
      return { ok: false, status: 400, error: "没有要保存的设置。" };
    }
    return {
      ok: true,
      patch: {
        preferredTextRoute: "custom",
        dshModel: null,
        ...(patch.customApi ? { customApi: patch.customApi } : {}),
        ...(patch.purgeEnabled !== undefined ? { purgeEnabled: patch.purgeEnabled } : {}),
      },
    };
  }
  const next: SettingsPatch = {};
  if (patch.preferredTextRoute) next.preferredTextRoute = patch.preferredTextRoute;
  if (patch.customApi) next.customApi = patch.customApi;
  if (patch.dshModel !== undefined) next.dshModel = patch.dshModel;
  if (patch.purgeEnabled !== undefined) next.purgeEnabled = patch.purgeEnabled;
  return { ok: true, patch: next };
}

function byokNote(baseNote: string, purge: boolean, customConfigured: boolean, dsh: { configured: boolean; missing: string[] }): string {
  if (!purge) return baseNote;
  if (!customConfigured) {
    const extra = "已打开经 DSH purge，也不会改成直连。";
    return baseNote.includes(extra) ? baseNote : `${baseNote} ${extra}`.trim();
  }
  if (!dsh.configured) {
    const why = dsh.missing.length > 0 && dsh.missing.length < 3 ? `未配齐 DSH（缺 ${dsh.missing.join("、")}）` : "未配齐 DSH";
    return `已打开经 DSH purge，但${why}。这次不会改成直连，也不会换成演示稿。`;
  }
  return "";
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
  if (type === "custom") {
    const described = describeTextRoute(env, "custom", stored.customApi);
    const dsh = getDshConfig(env);
    const config = publicConfigRouteFields(env, "custom", extras, stored.customApi, null);
    return {
      ...config,
      textRoute: described.textRoute,
      preferredTextRoute: "custom",
      textRouteNote: byokNote(described.textRouteNote, stored.purgeEnabled === true, described.customApi.configured, dsh),
      dshModel: null,
      purgeEnabled: stored.purgeEnabled === true,
      accountType: "custom",
      settingsVisibility: "custom-only",
    };
  }
  const described = describeTextRoute(env, stored.preferredTextRoute, stored.customApi);
  const dsh = getDshConfig(env);
  const purge = stored.purgeEnabled === true && described.preferredTextRoute === "custom";
  return {
    ...publicConfigRouteFields(env, stored.preferredTextRoute, extras, stored.customApi, stored.dshModel),
    textRouteNote: byokNote(described.textRouteNote, purge, described.customApi.configured, dsh),
    purgeEnabled: stored.purgeEnabled === true,
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
    purgeEnabled: config.purgeEnabled === true,
  };
}
