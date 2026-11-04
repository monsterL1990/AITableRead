import { maskApiKey } from "./custom-api";
import type { DshEnv } from "./dsh";
import type { PublicDshConnection, StoredDshConnection } from "./types";

/** 向导里「探测常见本机端口」的默认端口。可用 DSH_PROBE_PORTS 覆盖，不指向任何现成站点。 */
/** `dsh web` listens on 3080 unless told otherwise. 3081 and 3099 stay for older local setups. */
export const DEFAULT_DSH_PROBE_PORTS = [3080, 3081, 3099] as const;

export const DSH_PROBE_TIMEOUT_MS = 800;
export const DSH_CONNECT_TIMEOUT_MS = 8_000;

export const DSH_PLUGIN_NOTE = "插件要你在自己的 DSH 里安装。围读不要求 purge，也不会替你装插件。";

export const DSH_TOKEN_HELP =
  "不是模型的 API Key。终端里 npx @deepseek-ai/dsh web 会印出 dsh web: http://127.0.0.1:3080/?token=…，填 token= 后面的值，或把整段地址贴进来。每次重新启动都会变；终端关了要再开一次。";

export const EMPTY_DSH_CONNECTION: StoredDshConnection = {
  baseUrl: "",
  token: "",
  sessionId: "",
  basicUser: "",
  basicPassword: "",
};

const MAX_BASE = 500;
const MAX_TOKEN = 2_000;
const MAX_SESSION = 200;
const MAX_BASIC_USER = 200;
const MAX_BASIC_PASSWORD = 500;
const MAX_PROBE_PORTS = 8;

/**
 * A plain token stays a token. A `dsh web` launch URL (`http://127.0.0.1:3080/?token=…`)
 * yields that token and the origin. The prefix `dsh web:` is ignored.
 */
export function readDshTokenInput(input: string): { token: string; baseUrl: string } {
  const trimmed = input.trim();
  if (!trimmed) return { token: "", baseUrl: "" };
  const embedded = trimmed.match(/https?:\/\/[^\s]+/i);
  const candidate = (embedded ? embedded[0] : trimmed).replace(/[),.;]+$/, "");
  const looksLikeUrl = /^https?:\/\//i.test(candidate) || /[?&]token=/.test(candidate);
  if (!looksLikeUrl) return { token: trimmed, baseUrl: "" };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate) ? candidate : `http://${candidate}`;
  try {
    const url = new URL(withScheme);
    const token = url.searchParams.get("token")?.trim() ?? "";
    if (!token || !url.hostname) return { token: trimmed, baseUrl: "" };
    return { token, baseUrl: url.origin };
  } catch {
    return { token: trimmed, baseUrl: "" };
  }
}

export function emptyDshConnection(): StoredDshConnection {
  return { ...EMPTY_DSH_CONNECTION };
}

export function dshConnectionReady(value: StoredDshConnection | null | undefined): boolean {
  if (!value) return false;
  return Boolean(value.baseUrl.trim() && value.token.trim() && value.sessionId.trim());
}

export function toPublicDshConnection(value: StoredDshConnection | null | undefined): PublicDshConnection {
  const dsh = value ?? EMPTY_DSH_CONNECTION;
  return {
    baseUrl: dsh.baseUrl.trim().replace(/\/+$/, ""),
    sessionId: dsh.sessionId.trim(),
    tokenMask: maskApiKey(dsh.token),
    basicUser: dsh.basicUser.trim(),
    hasBasicPassword: Boolean(dsh.basicPassword),
    configured: dshConnectionReady(dsh),
  };
}

/**
 * 把浏览器地址栏里的 DSH 地址收成 Base URL（协议 + 主机 + 端口）。
 * 路径、查询和片段丢掉。地址里的用户名密码不进 Base URL。
 */
export function parseDshBrowserUrl(
  input: string,
): { ok: true; baseUrl: string; basicUser: string; basicPassword: string } | { ok: false; error: string } {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "先粘贴你在浏览器里打开 DSH 的地址。" };
  if (raw.length > MAX_BASE) return { ok: false, error: "地址太长。" };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, error: "这个地址解析不了。请粘贴浏览器地址栏里的整段。" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, error: "只接受 http 或 https。" };
  if (!url.hostname) return { ok: false, error: "地址里没有主机名。" };
  const baseUrl = url.origin;
  if (!baseUrl || baseUrl === "null") return { ok: false, error: "这个地址解析不了。" };
  let basicUser = "";
  let basicPassword = "";
  try {
    basicUser = decodeURIComponent(url.username || "");
    basicPassword = decodeURIComponent(url.password || "");
  } catch {
    return { ok: false, error: "地址里的用户名或密码解析不了。请改填到 Basic Auth。" };
  }
  return { ok: true, baseUrl, basicUser, basicPassword };
}

export function normalizeStoredDsh(value: unknown): StoredDshConnection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyDshConnection();
  const raw = value as Record<string, unknown>;
  const parsed = typeof raw.baseUrl === "string" ? parseDshBrowserUrl(raw.baseUrl) : null;
  const baseUrl = parsed && parsed.ok && !parsed.basicUser && !parsed.basicPassword ? parsed.baseUrl : "";
  const token = cleanSecret(raw.token, MAX_TOKEN);
  const sessionId = cleanLine(raw.sessionId, MAX_SESSION);
  const basicUser = cleanLine(raw.basicUser, MAX_BASIC_USER);
  const basicPassword = cleanSecret(raw.basicPassword, MAX_BASIC_PASSWORD);
  return {
    baseUrl,
    token,
    sessionId,
    basicUser,
    basicPassword: basicUser ? basicPassword : "",
  };
}

export function parseDshConnectionPatch(
  value: unknown,
  current: StoredDshConnection,
): { ok: true; connection: StoredDshConnection } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "DSH 连接格式不对。" };
  const raw = value as Record<string, unknown>;
  const parsed = parseDshBrowserUrl(typeof raw.baseUrl === "string" ? raw.baseUrl : "");
  if (!parsed.ok) return parsed;
  if (parsed.basicUser || parsed.basicPassword) {
    return { ok: false, error: "地址里不要写用户名和密码，请填到 Basic Auth。" };
  }
  const tokenRead = readDshTokenInput(typeof raw.token === "string" ? raw.token : "");
  const tokenInput = tokenRead.token;
  if (tokenInput && (tokenInput.length > MAX_TOKEN || /[\r\n]/.test(tokenInput))) {
    return { ok: false, error: "令牌格式不对。" };
  }
  const token = tokenInput || current.token.trim();
  if (!token) return { ok: false, error: "要填写 DSH 令牌。" };
  const sessionId = typeof raw.sessionId === "string" ? raw.sessionId.trim() : "";
  if (!sessionId || sessionId.length > MAX_SESSION || /[\r\n]/.test(sessionId)) {
    return { ok: false, error: "要选择一个 DSH 会话。" };
  }
  const basicUser = typeof raw.basicUser === "string" ? raw.basicUser.trim() : "";
  if (basicUser.length > MAX_BASIC_USER || /[\r\n]/.test(basicUser)) {
    return { ok: false, error: "Basic Auth 用户名格式不对。" };
  }
  let basicPassword = typeof raw.basicPassword === "string" ? raw.basicPassword : "";
  if (basicPassword.length > MAX_BASIC_PASSWORD || /[\r\n]/.test(basicPassword)) {
    return { ok: false, error: "Basic Auth 密码格式不对。" };
  }
  if (!basicUser) {
    basicPassword = "";
  } else if (!basicPassword) {
    if (basicUser === current.basicUser.trim() && current.basicPassword) basicPassword = current.basicPassword;
    else return { ok: false, error: "填了 Basic Auth 用户名，还要密码。" };
  }
  return {
    ok: true,
    connection: { baseUrl: parsed.baseUrl, token, sessionId, basicUser, basicPassword },
  };
}

/** 稿库里配齐的 DSH 盖过进程环境。没配齐则原样退回传入的环境（可能为空，调用方再读进程环境）。 */
export function mergeDshEnv<T extends DshEnv>(stored: { dsh?: StoredDshConnection | null }, env?: T): T | undefined {
  const saved = stored.dsh;
  if (!dshConnectionReady(saved)) return env;
  const base = (env ? { ...env } : { ...process.env }) as T;
  return {
    ...base,
    DSH_BASE_URL: saved!.baseUrl.trim().replace(/\/+$/, ""),
    DSH_TOKEN: saved!.token.trim(),
    DSH_SESSION_ID: saved!.sessionId.trim(),
    DSH_BASIC_USER: saved!.basicUser.trim(),
    DSH_BASIC_PASSWORD: saved!.basicPassword,
  };
}

export function parseProbePorts(value: unknown, fallback: number[]): number[] {
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\s,]+/) : [];
  const ports: number[] = [];
  for (const item of items) {
    const text = typeof item === "number" ? String(item) : typeof item === "string" ? item.trim() : "";
    if (!text) continue;
    if (!/^\d+$/.test(text)) continue;
    const port = Number(text);
    if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
    if (!ports.includes(port)) ports.push(port);
    if (ports.length >= MAX_PROBE_PORTS) break;
  }
  return ports.length > 0 ? ports : [...fallback];
}

export function probePortsFromEnv(source?: { DSH_PROBE_PORTS?: string }): number[] {
  const raw = (source ?? process.env).DSH_PROBE_PORTS;
  if (typeof raw === "string" && raw.trim()) return parseProbePorts(raw, [...DEFAULT_DSH_PROBE_PORTS]);
  return [...DEFAULT_DSH_PROBE_PORTS];
}

export type DshProbeResult = {
  port: number;
  url: string;
  ok: boolean;
  status?: number;
  error?: string;
};

/**
 * 只探 127.0.0.1。某一端口不答应、超时或拒绝，记成失败并继续，不抛到调用方。
 */
export async function probeLocalDshPorts(
  ports: number[],
  deps?: { fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<DshProbeResult[]> {
  const timeoutMs = deps?.timeoutMs ?? DSH_PROBE_TIMEOUT_MS;
  const fetchImpl = deps?.fetchImpl ?? fetch;
  return Promise.all(
    ports.map(async (port) => {
      const url = `http://127.0.0.1:${port}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`${url}/`, { method: "GET", redirect: "manual", signal: controller.signal });
        return { port, url, ok: true, status: response.status };
      } catch {
        return { port, url, ok: false, error: "没有应答" };
      } finally {
        clearTimeout(timer);
      }
    }),
  );
}

function cleanLine(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text || text.length > max || /[\r\n]/.test(text)) return "";
  return text;
}

function cleanSecret(value: unknown, max: number): string {
  return cleanLine(value, max);
}
