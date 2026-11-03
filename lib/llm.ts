import { customIncompleteMessage } from "./custom-api";

export type LlmConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  demo: boolean;
  missing: string[];
  /** custom 表示设置里的接口，连不上或没填全时不要说成 CLIProxy。 */
  kind?: "env" | "custom";
};

const DEFAULT_MODEL = "gpt-4o-mini";

export function getLlmConfig(env?: {
  OPENAI_BASE_URL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
}): LlmConfig {
  const source = env ?? process.env;
  const baseUrl = (source.OPENAI_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const apiKey = (source.OPENAI_API_KEY ?? "").trim();
  const model = (source.OPENAI_MODEL ?? "").trim() || DEFAULT_MODEL;
  const missing: string[] = [];
  if (!baseUrl) missing.push("OPENAI_BASE_URL");
  if (!apiKey) missing.push("OPENAI_API_KEY");
  return { baseUrl, apiKey, model, demo: missing.length > 0, missing };
}

export function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/chat/completions`;
}

export function upstreamMessage(status: number, raw: string): string {
  let detail = raw.replace(/\s+/g, " ").trim().slice(0, 280);
  try {
    const json = JSON.parse(raw) as { error?: { message?: string }; message?: string };
    detail = json.error?.message || json.message || detail;
  } catch {
    // 非 JSON 错误页，保留截断后的原文。
  }
  if (status === 401 || status === 403) return `模型服务拒绝了密钥（${status}）。${detail}`;
  if (status === 404) return `模型地址或模型名没有对上（404）。${detail}`;
  return `模型服务返回 ${status}。${detail}`;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type ChatArgs = {
  system: string;
  user: string;
  temperature: number;
  onDelta: (text: string) => void;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
};

function refuseUnconfigured(config: LlmConfig): void {
  if (!config.demo) return;
  if (config.kind === "custom") throw new Error(customIncompleteMessage(config.missing));
  throw new Error("未配置模型，不能发起真实请求。");
}

function redactSecret(text: string, secret: string): string {
  const key = secret.trim();
  if (key.length < 6 || !text.includes(key)) return text;
  return text.split(key).join("••••");
}

export async function completeChat(args: Omit<ChatArgs, "onDelta">, config = getLlmConfig()): Promise<string> {
  refuseUnconfigured(config);
  return requestChat(config, { ...args, onDelta: () => undefined }, false);
}

export async function streamChat(args: ChatArgs, config = getLlmConfig()): Promise<string> {
  refuseUnconfigured(config);
  let emitted = false;
  const wrapped: ChatArgs = {
    ...args,
    onDelta: (text) => {
      emitted = true;
      args.onDelta(text);
    },
  };
  try {
    return await requestChat(config, wrapped, true);
  } catch (error) {
    if (emitted || args.signal?.aborted) throw error;
    const message = error instanceof Error ? error.message : "";
    if (!/stream/i.test(message)) throw error;
    return requestChat(config, args, false);
  }
}

async function requestChat(config: LlmConfig, args: ChatArgs, stream: boolean): Promise<string> {
  const fetchImpl = args.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(chatCompletionsUrl(config.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: args.temperature,
        stream,
        messages: [
          { role: "system", content: args.system },
          { role: "user", content: args.user },
        ],
      }),
      signal: args.signal,
    });
  } catch (error) {
    if (args.signal?.aborted) throw error;
    const reason = redactSecret(error instanceof Error ? error.message : "", config.apiKey);
    const hint =
      config.kind === "custom"
        ? "连不上自定义 API。请确认接口地址能从这台机器访问。"
        : "连不上模型服务。请确认这台机器能访问 OPENAI_BASE_URL 上的 OpenAI 兼容接口。";
    throw new Error(`${hint}${reason ? ` ${reason}` : ""}`);
  }

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(redactSecret(upstreamMessage(response.status, raw), config.apiKey));
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!stream || contentType.includes("application/json")) {
    const json = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content ?? "";
    if (!content.trim()) throw new Error("模型没有返回正文。");
    args.onDelta(content);
    return content;
  }

  if (!response.body) throw new Error("模型服务没有返回可读的数据流。");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let json: { choices?: { delta?: { content?: string }; message?: { content?: string } }[]; error?: { message?: string } };
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      if (json.error?.message) throw new Error(json.error.message);
      const piece = json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.message?.content ?? "";
      if (!piece) continue;
      full += piece;
      args.onDelta(piece);
    }
  }
  if (!full.trim()) throw new Error("模型没有返回正文。");
  return full;
}
