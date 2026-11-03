import { resolveActiveTextRoute } from "./active-text-route";
import { customApiToLlmConfig, customIncompleteMessage } from "./custom-api";
import { extractDocumentText } from "./documents";
import { promptDshSession } from "./dsh";
import { completeChat } from "./llm";
import { getSettings } from "./store";
import { planGeneration, resolveTextRoute } from "./text-route";
import { LIMITS, LOCAL_USER_ID, type CustomApiConfig, type DshModelRef, type PreferredTextRoute, type TextRoute } from "./types";

export const READER_DOC_LIMITS = {
  files: 4,
  bytes: 4_000_000,
  chars: 40_000,
  requirement: 2_000,
} as const;

export type DraftedReader = {
  name: string;
  blurb: string;
  prompt: string;
};

type ReaderDraftTurn = {
  system: string;
  user: string;
  temperature: number;
  fetchImpl?: typeof fetch;
};

export async function draftReaderFromSpec(
  input: {
    requirement: string;
    files: { name: string; bytes: Uint8Array }[];
  },
  deps?: {
    /** 测试用。缺省时看当前模型配置。 */
    demo?: boolean;
    complete?: (args: ReaderDraftTurn) => Promise<string>;
    /** 已经算好的实际路由。传入后不再读稿库。 */
    route?: TextRoute;
    /** 稿库里的偏好。测试可传入，避免读稿库。 */
    preference?: PreferredTextRoute | null;
    /** 自定义 API。传入后不再读稿库。 */
    customApi?: CustomApiConfig;
    /** 经 DSH 时要改用的目录模型。 */
    dshModel?: DshModelRef | null;
    /** 自备 Key 经 DSH 临时 provider。为真时不直连自定义 API。 */
    ephemeralProvider?: boolean;
    /** 没传入 customApi 时，从哪个账号的稿库读。 */
    uid?: string;
    fetchImpl?: typeof fetch;
  },
): Promise<DraftedReader> {
  const requirement = input.requirement.trim();
  if (!requirement) throw new Error("先用一句话写清这位读者要看什么。");
  if (requirement.length > READER_DOC_LIMITS.requirement) throw new Error("需求太长，请收到 2000 字以内。");
  if (input.files.length > READER_DOC_LIMITS.files) throw new Error(`一次最多 ${READER_DOC_LIMITS.files} 份文档。`);
  const excerpts: string[] = [];
  let used = 0;
  for (const file of input.files) {
    if (file.bytes.byteLength > READER_DOC_LIMITS.bytes) throw new Error(`「${file.name}」超过 4MB。`);
    const text = extractDocumentText(file.name, file.bytes).trim();
    if (!text) throw new Error(`「${file.name}」是空的。`);
    const room = READER_DOC_LIMITS.chars - used;
    if (room <= 0) break;
    const slice = text.slice(0, room);
    used += slice.length;
    excerpts.push(`## ${file.name}\n${slice}`);
  }
  let route: TextRoute;
  if (deps?.route) {
    route = deps.route;
  } else if (deps && ("preference" in deps || deps.demo !== undefined || deps.complete)) {
    route = resolveTextRoute(undefined, deps.preference);
  } else {
    route = await resolveActiveTextRoute();
  }
  const demo = deps?.demo ?? route === "demo";
  let complete: (args: ReaderDraftTurn) => Promise<string>;
  if (deps?.ephemeralProvider && !deps.complete) {
    let custom = deps.customApi;
    if (!custom) {
      try {
        custom = (await getSettings(deps.uid ?? LOCAL_USER_ID)).customApi;
      } catch {
        throw new Error("稿库读不出来，请检查 data/store.json。");
      }
    }
    const plan = planGeneration("custom", custom, undefined, { ephemeralProvider: true });
    if (plan.transport !== "dsh-ephemeral") throw new Error("自备 Key 没有走到 DSH。原稿保持不变。");
    const credential = plan.credential;
    complete = (args) =>
      promptDshSession({ system: args.system, user: args.user }, { ephemeralCredential: credential, fetchImpl: args.fetchImpl });
  } else if (route === "custom" && !deps?.complete) {
    let custom = deps?.customApi;
    if (!custom) {
      try {
        custom = (await getSettings(deps?.uid ?? LOCAL_USER_ID)).customApi;
      } catch {
        throw new Error("稿库读不出来，请检查 data/store.json。");
      }
    }
    const llm = customApiToLlmConfig(custom);
    if (llm.demo) throw new Error(customIncompleteMessage(llm.missing));
    complete = (args) => completeChat(args, llm);
  } else if (demo) {
    throw new Error(
      input.files.length > 0
        ? "未配置模型，不能根据文档生成读者。演示模式不会假装读过这些文件。"
        : "未配置模型，不能生成读者。",
    );
  } else {
    complete =
      deps?.complete ??
      (route === "dsh"
        ? (args: ReaderDraftTurn) => promptDshSession({ system: args.system, user: args.user }, { model: deps?.dshModel })
        : (args: ReaderDraftTurn) => completeChat(args));
  }
  const raw = await complete({
    temperature: 0.4,
    fetchImpl: deps?.fetchImpl,
    system: "你帮作者设计一位中文小说审稿读者。只输出一个 JSON 对象，键是 name、blurb、prompt。name 不超过 40 字，blurb 不超过 200 字。prompt 是这位读者审稿时的系统提示词，写清口味和要指出的问题。不要写入未成年情欲，也不要自己附上系统硬性规则。不要输出 JSON 以外的文字。用户如果附了文档摘录，只把它们当作口味和参照。",
    user: excerpts.length
      ? `# 一句话需求\n${requirement}\n\n# 文档摘录\n以下只作口味和参照。\n\n${excerpts.join("\n\n")}`
      : `# 一句话需求\n${requirement}`,
  });
  return parseDraft(raw);
}

function parseDraft(raw: string): DraftedReader {
  const match = /\{[\s\S]*\}/.exec(raw);
  if (!match) throw new Error("模型没有返回可用的读者设定。");
  let json: unknown;
  try {
    json = JSON.parse(match[0]);
  } catch {
    throw new Error("模型返回的读者设定不是合法 JSON。");
  }
  if (!json || typeof json !== "object") throw new Error("模型没有返回可用的读者设定。");
  const record = json as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const blurb = typeof record.blurb === "string" ? record.blurb.trim() : "";
  const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
  if (!name || !prompt) throw new Error("模型没有给出读者名字或提示词。");
  if (name.length > LIMITS.readerName) throw new Error("生成的读者名字太长，请把需求写得更具体再试。");
  if (blurb.length > LIMITS.readerBlurb) throw new Error("生成的读者简介太长，请把需求写得更具体再试。");
  if (prompt.length > LIMITS.prompt) throw new Error("生成的提示词太长。");
  return { name, blurb, prompt };
}
