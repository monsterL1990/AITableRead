import { catalog, type MessageId } from "./catalog";
import type { Locale } from "./locale";

export type Vars = Record<string, string | number>;

const ids = new Set<string>(Object.keys(catalog));

function fill(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => (key in vars ? String(vars[key]) : `{${key}}`));
}

export function isMessageId(value: string): value is MessageId {
  return ids.has(value);
}

export function translate(locale: Locale, id: MessageId, vars?: Vars): string {
  const template = catalog[id][locale === "en" ? 1 : 0];
  return fill(template, vars);
}

/** Chinese source string → English, when that Chinese appears on exactly one id. */
const reverse = new Map<string, string>();
const seen = new Map<string, string>();
for (const id of Object.keys(catalog) as MessageId[]) {
  const zh = catalog[id][0];
  const en = catalog[id][1];
  if (zh.includes("{")) continue;
  const prior = seen.get(zh);
  if (prior === undefined) {
    seen.set(zh, en);
    reverse.set(zh, en);
  } else if (prior !== en) {
    reverse.delete(zh);
  }
}

function enList(list: string): string {
  return list
    .split("、")
    .map((item) => localize("en", item.trim()))
    .join(", ");
}

function nameList(list: string): string {
  return list === "无" ? translate("en", "log.listNone") : list;
}

function routeInside(text: string): string | null {
  const match = /^(经 DSH|经 OpenAI 兼容接口|经自定义 API|演示稿)(?: · (.*))?$/.exec(text);
  if (!match) return null;
  const route = localize("en", match[1] ?? "");
  if (match[2] !== undefined) return translate("en", "log.viaDetail", { route, detail: match[2] }).replace(/^[（(]|[）)]$/g, "");
  return route;
}

function parentheticalRoute(text: string): string | null {
  const match = /^（(.+)）$/.exec(text);
  if (!match) return null;
  const inner = routeInside(match[1] ?? "");
  if (!inner) return null;
  return `(${inner})`;
}

function labelOrBody(text: string): string {
  if (text === "（无）" || text === "（空）") return localize("en", text);
  return text;
}

/**
 * Turn an app-generated Chinese string into the request language.
 * Unknown text (manuscripts, reader names, model output) is returned unchanged.
 * Call this on interface copy only.
 */
export function localize(locale: Locale, text: string, vars?: Vars): string {
  if (!text) return "";
  if (isMessageId(text)) return translate(locale, text, vars);
  if (locale !== "en") return text;
  const exact = reverse.get(text);
  if (exact) return exact;
  return applyPatterns(text) ?? text;
}

function applyPatterns(text: string): string | null {
  let match = /^(.+)太长，请收到 (\d+) 字以内。$/.exec(text);
  if (match) return translate("en", "err.tooLong", { name: localize("en", match[1] ?? ""), max: match[2] ?? "" });

  match = /^口令至少 (\d+) 个字符。$/.exec(text);
  if (match) return translate("en", "err.passwordShort", { min: match[1] ?? "" });

  match = /^未配齐 DSH（缺 (.+)），出字不经 DSH。$/.exec(text);
  if (match) return translate("en", "dsh.missingSome", { missing: enList(match[1] ?? "") });

  match = /^已连接模型 (.+)$/.exec(text);
  if (match) return translate("en", "model.connectedName", { name: match[1] ?? "" });

  match = /^(\d+) 分钟前$/.exec(text);
  if (match) return translate("en", "time.minutes", { n: match[1] ?? "" });

  match = /^(\d+) 小时前$/.exec(text);
  if (match) return translate("en", "time.hours", { n: match[1] ?? "" });

  match = /^(\d+)–(\d+) 字$/.exec(text);
  if (match) return translate("en", "count.range", { min: match[1] ?? "", max: match[2] ?? "" });

  match = /^至少 (\d+) 字$/.exec(text);
  if (match) return translate("en", "count.atLeast", { n: match[1] ?? "" });

  match = /^不超过 (\d+) 字$/.exec(text);
  if (match) return translate("en", "count.atMost", { n: match[1] ?? "" });

  match = /^(\d+) 字$/.exec(text);
  if (match) return translate("en", "field.chars", { count: match[1] ?? "" });

  match = /^已保存 (.+)，令牌 (.+)。$/.exec(text);
  if (match) return translate("en", "settings.savedLine", { base: match[1] ?? "", mask: match[2] ?? "" });

  match = /^已保存 (.+)。$/.exec(text);
  if (match && !reverse.has(text)) return translate("en", "settings.savedLineBare", { base: match[1] ?? "" });

  match = /^内核默认（(.+)）$/.exec(text);
  if (match) return translate("en", "settings.kernelDefaultNamed", { name: match[1] ?? "" });

  match = /^(.+)（这次目录里没有）$/.exec(text);
  if (match) return translate("en", "settings.modelMissing", { model: match[1] ?? "" });

  match = /^(大纲|初稿|润色稿|这一步)还是空的。$/.exec(text);
  if (match) return translate("en", "err.stillEmpty", { what: localize("en", match[1] ?? "") });

  match = /^质检清单对着的是更早的正文（(\d+) 字），现在是 (\d+) 字。请再跑一次结构质检。$/.exec(text);
  if (match) return translate("en", "err.qualityCount", { then: match[1] ?? "", now: match[2] ?? "" });

  match = /^质检清单对着的是更早的正文（(\d+) 字）。正文已经改过，请再跑一次结构质检。$/.exec(text);
  if (match) return translate("en", "err.qualityChanged", { then: match[1] ?? "" });

  match = /^出字超时了（已等约 (\d+) 分钟），时限内没有写完。原稿保持不变。$/.exec(text);
  if (match) return translate("en", "job.timeout", { minutes: match[1] ?? "" });

  match = /^预设 DeepSeek 的模型不在当前 DSH 目录里（(.+)）。这次没有提交。原稿保持不变。$/.exec(text);
  if (match) return translate("en", "err.presetDsMissing", { model: match[1] ?? "" });

  match = /^(.+)没有写完：只写回 (\d+) 字(，目标至少 (\d+) 字)?，内容像是写作计划而不是正文，没有保存。原稿保持不变。$/.exec(text);
  if (match) {
    return translate("en", "err.unfinishedPlan", {
      label: localize("en", match[1] ?? ""),
      count: match[2] ?? "",
      target: match[4] ? translate("en", "err.unfinishedTarget", { n: match[4] }) : "",
    });
  }

  match = /^(.+)没有写完：只写回 (\d+) 字(，目标至少 (\d+) 字)?，短得不像一节正文，没有保存。原稿保持不变。$/.exec(text);
  if (match) {
    return translate("en", "err.unfinishedTiny", {
      label: localize("en", match[1] ?? ""),
      count: match[2] ?? "",
      target: match[4] ? translate("en", "err.unfinishedTarget", { n: match[4] }) : "",
    });
  }

  match = /^自定义 API 还没填全（缺 (.+)），还不能选这条。$/.exec(text);
  if (match) return translate("en", "err.customIncomplete", { missing: translate("en", "err.customMissingList", { list: enList(match[1] ?? "") }) });

  match = /^自定义 API 还没填全，还不能选这条。$/.exec(text);
  if (match) return translate("en", "err.customIncomplete", { missing: "" });

  match = /^自定义 API 还没填全（缺 (.+)）。请到设置里补上接口地址、API Key 和模型。这次不会改用环境里的 OpenAI 兼容接口，也不会换成演示稿。$/.exec(text);
  if (match) return translate("en", "err.customIncompleteLong", { missing: translate("en", "err.customMissingList", { list: enList(match[1] ?? "") }) });

  match = /^自定义 API 还没填全。请到设置里补上接口地址、API Key 和模型。这次不会改用环境里的 OpenAI 兼容接口，也不会换成演示稿。$/.exec(text);
  if (match) return translate("en", "err.customIncompleteLong", { missing: "" });

  match = /^(未配齐 DSH（缺 .+）|未配齐 DSH)，OpenAI 兼容接口也未接上，出字仍是演示稿。$/.exec(text);
  if (match) return translate("en", "err.unmetDshDemo", { why: localize("en", match[1] ?? "") });

  match = /^(未配齐 DSH（缺 .+）|未配齐 DSH)，出字改为经 OpenAI 兼容接口。$/.exec(text);
  if (match) return translate("en", "err.unmetDshCliproxy", { why: localize("en", match[1] ?? "") });

  match = /^未配齐 DSH（缺 (.+)）。这次按 DSH 临时 provider 提交，不会改成直连，也不会换成演示稿。原稿保持不变。$/.exec(text);
  if (match) return translate("en", "err.ephemeralDirect", { why: translate("en", "err.whyDshSome", { missing: enList(match[1] ?? "") }) });

  match = /^未配齐 DSH。这次按 DSH 临时 provider 提交，不会改成直连，也不会换成演示稿。原稿保持不变。$/.exec(text);
  if (match) return translate("en", "err.ephemeralDirect", { why: translate("en", "err.whyDshAll") });

  match = /^正在请(.+)看…$/.exec(text);
  if (match) return translate("en", "job.askOne", { name: match[1] ?? "" });

  match = /^(.+)（已进行 (\d+) 分）$/.exec(text);
  if (match) return translate("en", "job.progress", { phrase: localize("en", match[1] ?? ""), gap: "", elapsed: translate("en", "job.minutes", { n: match[2] ?? "" }) });

  match = /^(.+)（已进行不到 1 分）$/.exec(text);
  if (match) return translate("en", "job.progress", { phrase: localize("en", match[1] ?? ""), gap: "", elapsed: translate("en", "job.underMinute") });

  match = /^稿子没保存，(.+)还没开始看。$/.exec(text);
  if (match) return translate("en", "reader.saveBlockedNamed", { name: match[1] ?? "" });

  match = /^稿子没保存，(.+)还没开始看。(.*)$/.exec(text);
  if (match) return translate("en", "reader.saveBlockedExtra", { name: match[1] ?? "", detail: localize("en", match[2] ?? "") });

  match = /^(.+)没看成。连接断了，意见没有写上。$/.exec(text);
  if (match) return translate("en", "reader.failedTransport", { name: match[1] === "读者" ? translate("en", "log.readerFallback") : (match[1] ?? "") });

  match = /^(.+)没看成。请再试一次。$/.exec(text);
  if (match) {
    const name = match[1] === "读者" ? translate("en", "log.readerFallback") : (match[1] ?? "");
    return match[1] === "读者" ? translate("en", "reader.failed") : translate("en", "reader.failedNamed", { name });
  }

  match = /^(.+)没看成。(.*)$/.exec(text);
  if (match) return translate("en", "reader.failedDetail", { name: match[1] ?? "", detail: localize("en", match[2] ?? "") });

  match = /^(大纲|初稿|润色)修改(\d+)$/.exec(text);
  if (match) return translate("en", "log.versionRev", { base: localize("en", match[1] ?? ""), n: match[2] ?? "" });

  match = /^确认(大纲|初稿|润色)。当前停在第 (\d+) 步。$/.exec(text);
  if (match) return translate("en", "log.confirm", { step: localize("en", match[1] ?? ""), current: match[2] ?? "" });

  match = /^回滚到(.+)。$/.exec(text);
  if (match) return translate("en", "log.rollback", { label: localize("en", match[1] ?? "") });

  match = /^(.+)看完第 (\d+) 步。(.*)$/.exec(text);
  if (match) return translate("en", "log.reviewed", { name: match[1] ?? "", step: match[2] ?? "", suffix: localize("en", match[3] ?? "") });

  match = /^改了(.+)的意见，采纳状态回到未定。$/.exec(text);
  if (match) return translate("en", "log.reviewEdited", { name: match[1] ?? "" });

  match = /^记下对(.+)这条意见的讨论。$/.exec(text);
  if (match) return translate("en", "log.reviewTalk", { name: match[1] ?? "" });

  match = /^按讨论改了(.+)的意见。请再决定是否采纳。(.*)$/.exec(text);
  if (match) return translate("en", "log.amended", { name: match[1] ?? "", suffix: localize("en", match[2] ?? "") });

  match = /^结构质检第 (\d+) 步。(.*)$/.exec(text);
  if (match) return translate("en", "log.quality", { step: match[1] ?? "", suffix: localize("en", match[2] ?? "") });

  match = /^采纳：(.+)。已忽略、未送进改稿：(.+)。未定、未送进改稿：(.+)。$/.exec(text);
  if (match) return translate("en", "log.selection", { adopted: nameList(match[1] ?? ""), ignored: nameList(match[2] ?? ""), unset: nameList(match[3] ?? "") });

  match = /^版本 (.+)（(.+)）$/.exec(text);
  if (match) return translate("en", "log.version", { label: localize("en", match[1] ?? ""), id: match[2] ?? "" });

  match = /^（(经 DSH|经 OpenAI 兼容接口|经自定义 API|演示稿)(?: · (.+))?）$/.exec(text);
  if (match) return parentheticalRoute(text);

  match = /^(经 DSH|经 OpenAI 兼容接口|经自定义 API|演示稿) · (.+)$/.exec(text);
  if (match) return `${localize("en", match[1] ?? "")} · ${match[2] ?? ""}`;

  match = /^(.+)：(.+)。（(.+)）$/.exec(text);
  if (match) {
    const route = routeInside(match[3] ?? "") ?? match[3] ?? "";
    return translate("en", "log.generated", { note: localize("en", match[1] ?? ""), label: localize("en", match[2] ?? ""), route });
  }

  match = /^意见：\n([\s\S]*)\n\n讨论：\n([\s\S]*)$/.exec(text);
  if (match) return translate("en", "log.opinionBlock", { text: match[1] ?? "", talk: labelOrBody(match[2] ?? "") });

  match = /^讨论：\n([\s\S]*)\n\n改后意见：\n([\s\S]*)$/.exec(text);
  if (match) return translate("en", "log.amendBlock", { talk: labelOrBody(match[1] ?? ""), text: match[2] ?? "" });

  match = /^意见原文：\n([\s\S]*)\n\n结果节选：\n([\s\S]*)$/.exec(text);
  if (match) return translate("en", "log.feedbackBlock", { feedback: match[1] ?? "", excerpt: match[2] ?? "" });

  match = /^当前实际出字：(.+)。$/.exec(text);
  if (match) return translate("en", "route.current", { route: localize("en", match[1] ?? "") });

  match = /^更新于 (.+)$/.exec(text);
  if (match) return translate("en", "work.updated", { when: localize("en", match[1] ?? "") });

  match = /^还没填全（缺 (.+)）。先在下面保存三项再选。空着也不会让页面崩溃。$/.exec(text);
  if (match) return translate("en", "settings.customMissing", { missing: enList(match[1] ?? "") });

  match = /^经 DSH 时改用 (.+)。$/.exec(text);
  if (match) return translate("en", "settings.modelSet", { model: match[1] ?? "" });

  match = /^已保存 (.+)，留空则不修改$/.exec(text);
  if (match) return translate("en", "settings.keyKept", { mask: match[1] ?? "" });

  match = /^\{url\} 有应答(（\d+）)?，用这个地址$/.exec(text);
  if (match) return null;

  return null;
}

export function joinList(locale: Locale, items: string[]): string {
  const translated = items.map((item) => localize(locale, item));
  return translated.join(locale === "en" ? ", " : "、");
}
