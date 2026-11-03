import { getDshConfig, type DshEnv } from "./dsh";
import { resolveTextRoute } from "./text-route";
import type { PreferredTextRoute, TextRoute } from "./types";

/**
 * 合规不靠正文里的【合规修改开始/结束】标记。那是另一套多 bot 群聊流水线的记号，本站不写、不解析、不高亮。
 *
 * 配齐 DSH 时，出字提交到指定会话。该会话应挂 purge / dsh-purge-community，清洗随回复生效，不再另跑一次。
 * 未配齐时出字退回环境里的 OpenAI 兼容接口（或演示稿）。设置里的自定义 API 默认直连，不经这次会话，也不经 purge。
 * 打开「经 DSH purge」后，同一把 Key 只在这一轮挂上临时 provider，清洗仍随模板会话的 agentPreset 生效。
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

/** 已经知道实际路由时用这个说明。dshConfigured 表示环境里 DSH 配齐了，哪怕这次没走它。byokPurge 表示自备 Key 走临时 provider。 */
export function complianceNoteForRoute(route: TextRoute, dshConfigured: boolean, byokPurge = false): ComplianceHandoff {
  if (byokPurge) {
    return {
      provider: "dsh",
      status: dshConfigured ? "configured" : "not-configured",
      note: dshConfigured
        ? "出字经 DSH，用稿库里的自备 Key。合规清洗随该会话生效。密钥不写进 DSH 主机设置。"
        : "已打开经 DSH purge，但未配齐 DSH。这次不会改成直连。这份导出没有单独的合规清洗。",
    };
  }
  if (route === "dsh") {
    return {
      provider: "dsh",
      status: "configured",
      note: "出字经 DSH。合规清洗随该会话生效。",
    };
  }
  if (route === "custom") {
    return {
      provider: "custom",
      status: "not-configured",
      note: "出字经自定义 API。这次不经 DSH 会话，也不经 purge。",
    };
  }
  if (route === "demo") {
    return {
      provider: "cliproxy",
      status: "not-configured",
      note: dshConfigured
        ? "已改走环境里的 OpenAI 兼容接口，但模型未接上。这份导出没有单独的合规清洗。"
        : "未配齐 DSH，也未接 OpenAI 兼容接口。这份导出没有单独的合规清洗。",
    };
  }
  return {
    provider: "cliproxy",
    status: "not-configured",
    note: dshConfigured
      ? "出字经 OpenAI 兼容接口。这次不经 DSH 会话，没有单独的合规清洗。"
      : "未配齐 DSH。出字经 OpenAI 兼容接口，没有单独的合规清洗。",
  };
}

export function complianceHandoff(env?: HandoffEnv, preference?: PreferredTextRoute | null): ComplianceHandoff {
  const route = resolveTextRoute(env, preference);
  return complianceNoteForRoute(route, getDshConfig(env).configured);
}
