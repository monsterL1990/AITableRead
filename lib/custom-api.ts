import type { LlmConfig } from "./llm";
import type { CustomApiConfig, PublicCustomApi } from "./types";

/**
 * DeepSeek 官方 OpenAI 兼容根地址（https://api-docs.deepseek.com/）。
 * 围读会在后面接 `/chat/completions`。写成 `https://api.deepseek.com/v1` 也可以。
 * 当前文档里的模型名是 `deepseek-flash` 与 `deepseek-v4-pro`。
 * `deepseek-chat`、`deepseek-reasoner` 仍可作为可改的建议项。
 */
export const DEEPSEEK_OPENAI_BASE_URL = "https://api.deepseek.com";
export const DEEPSEEK_PRESET_MODEL = "deepseek-flash";
export const DEEPSEEK_MODEL_SUGGESTIONS = ["deepseek-flash", "deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner"] as const;

export const EMPTY_CUSTOM_API: CustomApiConfig = { baseUrl: "", apiKey: "", model: "" };

const MAX_BASE_URL = 500;
const MAX_API_KEY = 2000;
const MAX_MODEL = 200;

export function maskApiKey(apiKey: string): string {
  const key = apiKey.trim();
  if (!key) return "";
  if (key.length <= 8) return "••••";
  return `••••${key.slice(-4)}`;
}

export function isHttpBaseUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_BASE_URL) return false;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (!url.hostname) return false;
  return true;
}

export function inspectCustomApi(config: CustomApiConfig): { configured: boolean; missing: string[] } {
  const missing: string[] = [];
  const baseUrl = config.baseUrl.trim();
  if (!baseUrl) missing.push("接口地址");
  else if (!isHttpBaseUrl(baseUrl)) missing.push("合法的接口地址");
  if (!config.apiKey.trim()) missing.push("API Key");
  if (!config.model.trim()) missing.push("模型");
  return { configured: missing.length === 0, missing };
}

export function customSelectionError(config: CustomApiConfig): string | null {
  const inspected = inspectCustomApi(config);
  if (inspected.configured) return null;
  const listed = inspected.missing.length ? `（缺 ${inspected.missing.join("、")}）` : "";
  return `自定义 API 还没填全${listed}，还不能选这条。`;
}

export function customIncompleteMessage(missing: string[]): string {
  const listed = missing.length ? `（缺 ${missing.join("、")}）` : "";
  return `自定义 API 还没填全${listed}。请到设置里补上接口地址、API Key 和模型。这次不会改用 CLIProxy，也不会换成演示稿。`;
}

export function toPublicCustomApi(config: CustomApiConfig): PublicCustomApi {
  const inspected = inspectCustomApi(config);
  return {
    baseUrl: config.baseUrl.trim().replace(/\/+$/, ""),
    model: config.model.trim(),
    apiKeyMask: maskApiKey(config.apiKey),
    configured: inspected.configured,
    missing: inspected.missing,
  };
}

export function customApiToLlmConfig(config: CustomApiConfig): LlmConfig {
  const inspected = inspectCustomApi(config);
  return {
    baseUrl: config.baseUrl.trim().replace(/\/+$/, ""),
    apiKey: config.apiKey.trim(),
    model: config.model.trim(),
    demo: !inspected.configured,
    missing: inspected.missing,
    kind: "custom",
  };
}

export function requireCustomLlmConfig(config: CustomApiConfig): LlmConfig {
  const llm = customApiToLlmConfig(config);
  if (llm.demo) throw new Error(customIncompleteMessage(llm.missing));
  return llm;
}

export function normalizeCustomApi(value: unknown): CustomApiConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...EMPTY_CUSTOM_API };
  const raw = value as Record<string, unknown>;
  return {
    baseUrl: typeof raw.baseUrl === "string" ? raw.baseUrl.trim().slice(0, MAX_BASE_URL) : "",
    apiKey: typeof raw.apiKey === "string" ? raw.apiKey.trim().slice(0, MAX_API_KEY) : "",
    model: typeof raw.model === "string" ? raw.model.trim().slice(0, MAX_MODEL) : "",
  };
}

export function parseCustomApiPatch(
  value: unknown,
  current: CustomApiConfig,
): { ok: true; config: CustomApiConfig } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "自定义 API 的格式不对。" };
  }
  const raw = value as Record<string, unknown>;
  if (raw.baseUrl !== undefined && typeof raw.baseUrl !== "string") return { ok: false, error: "接口地址要写成文本。" };
  if (raw.model !== undefined && typeof raw.model !== "string") return { ok: false, error: "模型名要写成文本。" };
  if (raw.apiKey !== undefined && typeof raw.apiKey !== "string") return { ok: false, error: "API Key 要写成文本。" };
  const baseUrl = (typeof raw.baseUrl === "string" ? raw.baseUrl : current.baseUrl).trim().replace(/\/+$/, "");
  const model = (typeof raw.model === "string" ? raw.model : current.model).trim();
  if (baseUrl.length > MAX_BASE_URL) return { ok: false, error: "接口地址太长。" };
  if (model.length > MAX_MODEL) return { ok: false, error: "模型名太长。" };
  if (baseUrl && !isHttpBaseUrl(baseUrl)) {
    return { ok: false, error: "接口地址要写成 http 或 https 开头的根地址，例如 https://api.deepseek.com。" };
  }
  let apiKey = current.apiKey.trim();
  const typed = typeof raw.apiKey === "string" ? raw.apiKey.trim() : "";
  if (typed) {
    if (typed.length > MAX_API_KEY) return { ok: false, error: "API Key 太长。" };
    apiKey = typed;
  } else if (raw.clearApiKey === true) {
    apiKey = "";
  }
  if (apiKey && baseUrl.includes(apiKey)) return { ok: false, error: "不要把 API Key 写进接口地址。" };
  return { ok: true, config: { baseUrl, model, apiKey } };
}
