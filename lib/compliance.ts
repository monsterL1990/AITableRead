import { getDshConfig, type DshEnv } from "./dsh";
import { resolveTextRoute } from "./text-route";
import type { PreferredTextRoute, TextRoute } from "./types";

/**
 * 合规不靠正文里的【合规修改开始/结束】标记。那是另一套多 bot 群聊流水线的记号，本站不写、不解析、不高亮。
 *
 * 配齐 DSH 时，出字提交到指定会话。DSH 上的插件由使用者自己安装，围读不要求 purge，也不另跑一次清洗。
 * 未配齐时出字退回环境里的 OpenAI 兼容接口（或演示稿）。设置里的自定义 API 直连。
 * 不把围读嵌进 DSH 界面，也不在代码里写死某一台现成站点。
 */
export type ComplianceProvider = "dsh" | "cliproxy" | "custom";

export type ComplianceStatus = "not-configured" | "configured";

export type ComplianceHandoff = {
  provider: ComplianceProvider;
  status: ComplianceStatus;
  note: string;
};

type HandoffEnv = DshEnv & {
  OPENAI_BASE_URL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
};

/** 已经知道实际路由时用这个说明。dshConfigured 表示 DSH 配齐了，哪怕这次没走它。byokPurge 已不再改说明。 */
export function complianceNoteForRoute(route: TextRoute, dshConfigured: boolean, byokPurge = false): ComplianceHandoff {
  void byokPurge;
  if (route === "dsh") {
    return {
      provider: "dsh",
      status: "configured",
      note: "出字经 DSH。插件由你在自己的 DSH 里安装，围读不要求 purge。",
    };
  }
  if (route === "custom") {
    return {
      provider: "custom",
      status: "not-configured",
      note: "出字经自定义 API。这次直连你的接口，不经 DSH，也不经 purge。",
    };
  }
  if (route === "demo") {
    return {
      provider: "cliproxy",
      status: "not-configured",
      note: dshConfigured
        ? "已改走环境里的 OpenAI 兼容接口，但模型未接上。这份导出没有单独的清洗步骤。"
        : "未配齐 DSH，也未接 OpenAI 兼容接口。这份导出没有单独的清洗步骤。",
    };
  }
  return {
    provider: "cliproxy",
    status: "not-configured",
    note: dshConfigured
      ? "出字经 OpenAI 兼容接口。这次不经 DSH 会话，也不经 purge。"
      : "未配齐 DSH。出字经 OpenAI 兼容接口，没有单独的清洗步骤。",
  };
}

export function complianceHandoff(env?: HandoffEnv, preference?: PreferredTextRoute | null): ComplianceHandoff {
  const route = resolveTextRoute(env, preference);
  return complianceNoteForRoute(route, getDshConfig(env).configured);
}
