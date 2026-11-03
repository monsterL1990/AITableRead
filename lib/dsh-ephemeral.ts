/**
 * 自备 Key 的 DSH 临时 provider。围读只当客户端。
 * 插件 dsh-ephemeral-provider v0.1.0，namespace `ephemeralProvider`。
 * 只给「非预设 + 经 DSH purge」用。预设 Grok / 预设 DeepSeek 不走这里。
 *
 * - ephemeralProvider/attach
 *   request: { sessionId, baseUrl, apiKey, model, api? }
 *   返回: { providerId, sessionId, model, api, baseUrl, expiresAt, ttlMs }，永不带 Key
 * - ephemeralProvider/detach
 *   request: { sessionId } 或 { providerId }，幂等，不带 Key
 * - ephemeralProvider/list
 *   无敏感字段。出字路径不调用。
 *
 * providerId 只用 attach 的返回值，不在客户端拼 ephemeral-<sessionId>。
 * Key 只出现在这一次 attach 请求里。不写主机 settings，不进全局 credentials。
 * 会话 disposed 和默认 TTL（2 小时）由 DSH 侧处理。这里仍在 finally 里显式 detach。
 */

export const DSH_EPHEMERAL_RPC = {
  attach: "ephemeralProvider/attach",
  detach: "ephemeralProvider/detach",
  list: "ephemeralProvider/list",
} as const;

/** OpenAI 兼容 Chat Completions。可选字段，站长若改枚举只改这一处。 */
export const DSH_EPHEMERAL_API = "openai-completions";

export const EPHEMERAL_NOT_READY = "DSH ephemeral provider 未就绪。这次没有改成直连，原稿保持不变。";

export type EphemeralCredential = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type DshRpc = (method: string, args: unknown, signal?: AbortSignal) => Promise<unknown>;

/** 内核没有这条 Remote，或明确说方法不存在。404 / 405 / 501 也算。 */
export function isDshRemoteMissing(message: string): boolean {
  if (/独立内核返回 (404|405|501)/.test(message)) return true;
  return /unknown method|method not found|not implemented|no such (rpc|method)|未知方法|没有这个方法|未实现/i.test(message);
}

export function redactCredential(text: string, apiKey: string): string {
  const key = apiKey.trim();
  if (key.length < 6 || !text.includes(key)) return text;
  return text.split(key).join("••••");
}

export function ephemeralAttachArgs(sessionId: string, credential: EphemeralCredential): { request: Record<string, string> } {
  return {
    request: {
      sessionId,
      baseUrl: credential.baseUrl,
      apiKey: credential.apiKey,
      model: credential.model,
      api: DSH_EPHEMERAL_API,
    },
  };
}

export function ephemeralDetachArgs(target: { sessionId?: string; providerId?: string }): { request: Record<string, string> } {
  if (target.providerId?.trim()) return { request: { providerId: target.providerId.trim() } };
  if (target.sessionId?.trim()) return { request: { sessionId: target.sessionId.trim() } };
  return { request: {} };
}

/**
 * 把内核的失败收成给页面的中文。不把 apiKey 带回。
 * 已经是围读自己的句子（含「原稿保持不变」或未就绪）时原样返回，避免套两层。
 */
export function ephemeralFailureMessage(raw: string, apiKey = ""): string {
  const text = redactCredential(raw, apiKey).replace(/\s+/g, " ").trim();
  if (text.includes("原稿保持不变") || text.includes("DSH ephemeral provider 未就绪")) return text;
  if (isDshRemoteMissing(text)) return EPHEMERAL_NOT_READY;
  if (/gateway\/bad-request|MISSING_CREDENTIAL|INVALID_CREDENTIAL/i.test(text)) {
    return "自备 Key 没有通过 DSH 校验。请核对接口地址、密钥和模型。这次没有提交。原稿保持不变。";
  }
  if (/UNKNOWN_MODEL/i.test(text)) return "DSH 不认识这把自备 Key 对应的模型。原稿保持不变。";
  if (/session\/model-unavailable|model-unavailable|model unavailable/i.test(text)) {
    return "这轮临时模型还没挂上，或已经卸下。这次没有提交。原稿保持不变。";
  }
  if (/上游|upstream/i.test(text)) {
    const status = /([45]\d\d)/.exec(text);
    return status
      ? `自备 Key 的上游返回 ${status[1]}。这次没有改成直连。原稿保持不变。`
      : "自备 Key 的上游拒绝了这次请求。这次没有改成直连。原稿保持不变。";
  }
  const kernel = /独立内核返回 ([45]\d\d)/.exec(text);
  if (kernel) return `DSH 没有完成临时 provider 调用（${kernel[1]}）。这次没有改成直连。原稿保持不变。`;
  return "没能挂上这轮的临时模型。这次没有提交，也不会改成直连。原稿保持不变。";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** 读 attach 的返回。providerId 必须来自响应，缺了就失败，不在本地拼。 */
export function readAttachResult(value: unknown, fallbackModel: string, apiKey: string): { providerId: string; model: string } {
  const record = asRecord(value);
  const nested = record && record.ok !== false ? asRecord(record.value) : null;
  const source = nested?.providerId ? nested : record;
  const providerId = typeof source?.providerId === "string" ? source.providerId.trim() : "";
  const model = typeof source?.model === "string" && source.model.trim() ? source.model.trim() : fallbackModel;
  if (!providerId || providerId.includes(apiKey) || model.includes(apiKey)) {
    throw new Error("DSH 没有交回这轮临时 provider 的 id。这次没有提交，也不会改成直连。原稿保持不变。");
  }
  return { providerId, model };
}

export async function attachEphemeralProvider(
  rpc: DshRpc,
  sessionId: string,
  credential: EphemeralCredential,
  signal?: AbortSignal,
): Promise<{ provider: string; model: string }> {
  let value: unknown;
  try {
    value = await rpc(DSH_EPHEMERAL_RPC.attach, ephemeralAttachArgs(sessionId, credential), signal);
  } catch (error) {
    if (isAbortError(error)) throw error;
    const message = error instanceof Error ? error.message : "";
    throw new Error(ephemeralFailureMessage(message, credential.apiKey));
  }
  const attached = readAttachResult(value, credential.model, credential.apiKey);
  return { provider: attached.providerId, model: attached.model };
}

/** 卸下失败不能盖住原来的正文或错误。请求里不带 apiKey。 */
export async function detachEphemeralProvider(
  rpc: DshRpc,
  target: { sessionId?: string; providerId?: string },
  signal?: AbortSignal,
): Promise<void> {
  try {
    await rpc(DSH_EPHEMERAL_RPC.detach, ephemeralDetachArgs(target), signal);
  } catch {
    // 幂等。会话可能已经取消或过期。留下原来的结果。
  }
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  return error instanceof Error && error.name === "AbortError";
}
