/**
 * 围读只做独立 DSH 内核的客户端。产品名是围读；容器和 GAOJIAN_* 仍用原来的运维名。
 * DSH_BASE_URL、DSH_TOKEN、DSH_SESSION_ID 由部署的人填写，默认不指向任何现成站点。
 * 配齐后，每一轮出字另开一个会话（session/create），抄 DSH_SESSION_ID 上的 agentPreset，
 * 再等这一轮结束，读回这一轮里最长的那份助手正文。短的收尾确认不能盖住前面的长稿，多条消息也不拼成一篇。这样上一轮没写完，也不会把后面的任务排进同一条队列。
 * 内核若没有 session/create，就退回 DSH_SESSION_ID：它还在写时直接拒绝，不再用 mode=queue 排在后面。
 * 会话还在跑时写下的短句是中途消息，不能当成结果。
 * 一条助手消息里，组装好的正文在 message.content；同一次流的 block-end 会再带一份相同正文，不能拼进去。
 * 同一轮里若先写完长稿，再补一句「已替换 / 已写入文件 / 同一份在…」，收下长稿，不收下那句确认。
 * 另开的会话抄 DSH_SESSION_ID 上的 agentPreset（若该会话有）。DSH 上装哪些插件由使用者自己决定，围读不要求 purge。
 * 这里不安装插件，也不另发一条「只清洗」指令。
 * 临时 provider 仍见 dsh-ephemeral.ts，只在调用方显式传入 ephemeralCredential 时使用。设置页不再打开这条。
 * 不调用主机 settings.update，Key 不进全局 credentials。
 */

import { catalogFromValue, emptyDshCatalog } from "./dsh-catalog";
import http from "node:http";
import https from "node:https";
import {
  attachEphemeralProvider,
  detachEphemeralProvider,
  ephemeralFailureMessage,
  isDshRemoteMissing,
  redactCredential,
  type EphemeralCredential,
} from "./dsh-ephemeral";
import { countChars } from "./format";
import type { DshCatalogView, DshSessionChoice } from "./types";

export type DshEnv = {
  DSH_BASE_URL?: string;
  DSH_TOKEN?: string;
  DSH_SESSION_ID?: string;
  DSH_TIMEOUT_MS?: string;
  DSH_BASIC_USER?: string;
  DSH_BASIC_PASSWORD?: string;
};

export type DshConfig = {
  baseUrl: string;
  token: string;
  sessionId: string;
  timeoutMs: number;
  basicUser: string;
  basicPassword: string;
  configured: boolean;
  missing: string[];
};

/** 一次长改稿曾经跑过约 14 分钟。默认留出单轮余量，不把后面另开的短任务算进同一次等待。 */
const DEFAULT_TIMEOUT_MS = 1_200_000;
const MAX_TIMEOUT_MS = 1_800_000;
const BUSY_SESSION_MESSAGE =
  "这个 DSH 会话还在写上一轮，这次没有提交，避免排在后面空等和空烧额度。请等它结束再试。原稿保持不变。";
/**
 * 只有退回共享的 DSH_SESSION_ID 时才占用。
 * 另开的会话各自排队，不抢这把锁。检查和置位都在第一次 await 之前，避免两轮同时看上闲着的会话。
 */
let sharedSessionHeld = false;
/** 没有 running 信号时，正文连续这么多次不变才收下。一次刚出现的短句不算写完。 */
const STABLE_IDLE_POLLS = 2;
/** 一页要盖住本轮的用户消息和后面的步骤，12 条很容易只剩中途那句。 */
const PAGE_MESSAGES = 48;

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type Deps = {
  fetchImpl?: FetchLike;
  env?: DshEnv;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  signal?: AbortSignal;
  onWait?: () => void;
  /** 设了就在提交前对这一轮会话调用 session/selectModel。不设则另开会话时抄模板会话当前模型。自备 Key 时忽略，改挂临时 provider。 */
  model?: { provider: string; model: string } | null;
  /**
   * 自备 Key。只在这一轮 attach 请求里上行，用完 detach。
   * 必须另开会话；退回共享的 DSH_SESSION_ID 时拒绝，避免把 Key 挂到站长模板会话上。
   */
  ephemeralCredential?: EphemeralCredential | null;
  /** 实际用上的目录模型。读不到时为 null。 */
  onModel?: (model: { provider: string; model: string } | null) => void;
};

export type DshTask = {
  system?: string;
  user: string;
};

export function getDshConfig(env?: DshEnv): DshConfig {
  const source = env ?? process.env;
  const baseUrl = (source.DSH_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const token = (source.DSH_TOKEN ?? "").trim();
  const sessionId = (source.DSH_SESSION_ID ?? "").trim();
  const missing: string[] = [];
  if (!baseUrl) missing.push("DSH_BASE_URL");
  if (!token) missing.push("DSH_TOKEN");
  if (!sessionId) missing.push("DSH_SESSION_ID");
  return {
    baseUrl,
    token,
    sessionId,
    timeoutMs: readTimeout(source.DSH_TIMEOUT_MS),
    basicUser: (source.DSH_BASIC_USER ?? "").trim(),
    basicPassword: source.DSH_BASIC_PASSWORD ?? "",
    configured: missing.length === 0,
    missing,
  };
}

export function dshTaskText(task: DshTask): string {
  const system = task.system?.trim() ?? "";
  const user = task.user.trim();
  if (system && user) return `${system}\n\n${user}`;
  return user || system;
}

/** 向已配置的会话提交一条任务，等这一轮写完再返回这一轮里最长的那份助手正文。未配齐、空回复或超时时抛中文错误，调用方不应改原稿。 */
export async function promptDshSession(task: DshTask, deps: Deps = {}): Promise<string> {
  const config = getDshConfig(deps.env);
  if (!config.configured) {
    throw new Error(`未配齐 DSH（缺 ${config.missing.join("、")}）。出字不经 DSH，原稿保持不变。`);
  }
  const body = dshTaskText(task);
  if (!body) throw new Error("没有可交给 DSH 的任务。原稿保持不变。");
  const text = await runPrompt(config, body, deps);
  if (!text.trim()) throw new Error("DSH 会话没有写回正文。原稿保持不变。");
  return text.trim();
}

type JobSession = {
  sessionId: string;
  /** 这一轮自己开的会话。失败、超时或用户取消时取消它，避免空烧。浏览器断开不会传到这个 signal。配置里的 DSH_SESSION_ID 不会被取消。 */
  ephemeral: boolean;
  release?: () => void;
};

function readyEphemeralCredential(value: EphemeralCredential | null | undefined): EphemeralCredential | null {
  if (!value) return null;
  const baseUrl = value.baseUrl.trim().replace(/\/+$/, "");
  const apiKey = value.apiKey.trim();
  const model = value.model.trim();
  if (!baseUrl || !apiKey || !model) {
    throw new Error("自备 Key 还没填全。这次没有提交，也不会改成直连。原稿保持不变。");
  }
  return { baseUrl, apiKey, model };
}

async function runPrompt(config: DshConfig, taskText: string, deps: Deps): Promise<string> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  const credential = readyEphemeralCredential(deps.ephemeralCredential);
  throwIfAborted(deps.signal);
  const cookie = await connect(fetchImpl, config, deps.signal, true);
  const parent = await findSession(fetchImpl, config, cookie, config.sessionId, deps.signal, true);
  const job = await openJobSession(fetchImpl, config, cookie, parent, deps.signal);
  const secrets = credential ? [credential.apiKey] : undefined;
  const detachTarget = credential && job.ephemeral ? job.sessionId : "";
  try {
    throwIfAborted(deps.signal);
    if (credential && !job.ephemeral) {
      throw new Error("没能另开一轮 DSH 会话。自备 Key 不会挂到共享会话上，这次没有提交，也不会改成直连。原稿保持不变。");
    }
    const call = (method: string, args: unknown, signal?: AbortSignal) =>
      rpc(fetchImpl, config, cookie, method, args, signal, secrets);
    let target: { provider: string; model: string } | null;
    if (credential) {
      target = await attachEphemeralProvider(call, job.sessionId, credential, deps.signal);
    } else {
      const explicit = deps.model?.provider && deps.model.model ? { provider: deps.model.provider, model: deps.model.model } : null;
      target = job.ephemeral ? explicit ?? (await templateSessionModel(fetchImpl, config, cookie, deps.signal)) : explicit;
    }
    if (target) await selectJobModel(fetchImpl, config, cookie, job.sessionId, target, deps.signal, secrets);
    const reported = target ?? (job.ephemeral ? null : await templateSessionModel(fetchImpl, config, cookie, deps.signal));
    deps.onModel?.(reported);
    const requestId = crypto.randomUUID();
    const prompt = `${taskText}\n\n稿间请求 ${requestId}`;
    await rpc(fetchImpl, config, cookie, "session/prompt", {
      request: {
        requestId,
        sessionId: job.sessionId,
        mode: "queue",
        content: [{ type: "text", text: prompt }],
      },
    }, deps.signal, secrets);
    return await waitForSettledReply({
      fetchImpl,
      config,
      cookie,
      sessionId: job.sessionId,
      requestId,
      deadline: now() + config.timeoutMs,
      sleep,
      now,
      signal: deps.signal,
      onWait: deps.onWait,
    });
  } catch (error) {
    if (job.ephemeral) await cancelEphemeral(fetchImpl, config, cookie, job.sessionId);
    if (!credential) throw error;
    rethrowAbort(error);
    const message = error instanceof Error ? error.message : "";
    throw new Error(ephemeralFailureMessage(message, credential.apiKey));
  } finally {
    if (detachTarget) {
      await detachEphemeralProvider(
        (method, args, signal) => rpc(fetchImpl, config, cookie, method, args, signal, secrets),
        { sessionId: detachTarget },
      );
    }
    job.release?.();
  }
}

/**
 * 优先另开一轮，抄模板会话上的 agentPreset（若有）和 cwd。围读不要求该预设是 purge。
 * 内核不认 session/create，或交回来的仍是模板会话时，才退回共享会话，并且它正在写就拒绝提交。
 */
async function openJobSession(
  fetchImpl: FetchLike,
  config: DshConfig,
  cookie: string,
  parent: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<JobSession> {
  try {
    const created = await rpc(fetchImpl, config, cookie, "session/create", { request: templateCreateRequest(parent) }, signal);
    const sessionId = createdSessionId(created);
    if (!sessionId || sessionId === config.sessionId) return claimSharedSession(fetchImpl, config, cookie, signal);
    return { sessionId, ephemeral: true };
  } catch (error) {
    rethrowAbort(error);
    if (isSessionCreateUnsupported(error)) return claimSharedSession(fetchImpl, config, cookie, signal);
    const detail = error instanceof Error ? error.message.trim() : "";
    throw new Error(`没能另开一轮 DSH 会话，这次没有提交。原稿保持不变。${detail ? ` ${detail}` : ""}`);
  }
}

function templateCreateRequest(row: Record<string, unknown>): Record<string, unknown> {
  const request: Record<string, unknown> = {};
  const preset = readAgentPreset(row);
  const cwd = typeof row.cwd === "string" ? row.cwd.trim() : "";
  if (preset) request.agentPreset = preset;
  if (cwd) request.cwd = cwd;
  return request;
}

function readAgentPreset(row: Record<string, unknown>): string {
  if (typeof row.agentPreset === "string" && row.agentPreset.trim()) return row.agentPreset.trim();
  const projections = row.projections;
  if (!projections || typeof projections !== "object") return "";
  const values = (projections as { values?: unknown }).values;
  if (!values || typeof values !== "object") return "";
  const preset = (values as { agentPreset?: unknown }).agentPreset;
  return typeof preset === "string" ? preset.trim() : "";
}

function createdSessionId(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const sessionId = (value as { sessionId?: unknown }).sessionId;
  return typeof sessionId === "string" ? sessionId.trim() : "";
}

function isSessionCreateUnsupported(error: unknown): boolean {
  return error instanceof Error && isDshRemoteMissing(error.message);
}

/** 共享会话正在写，或本进程已经有一轮占着它时，不提交。检查和占位发生在任何 await 之前。 */
async function claimSharedSession(
  fetchImpl: FetchLike,
  config: DshConfig,
  cookie: string,
  signal?: AbortSignal,
): Promise<JobSession> {
  if (sharedSessionHeld) throw new Error(BUSY_SESSION_MESSAGE);
  sharedSessionHeld = true;
  const release = () => {
    sharedSessionHeld = false;
  };
  try {
    throwIfAborted(signal);
    const row = await findSession(fetchImpl, config, cookie, config.sessionId, signal, true);
    if (sessionTurnState(row) === "running") throw new Error(BUSY_SESSION_MESSAGE);
    return { sessionId: config.sessionId, ephemeral: false, release };
  } catch (error) {
    release();
    throw error;
  }
}

async function cancelEphemeral(
  fetchImpl: FetchLike,
  config: DshConfig,
  cookie: string,
  sessionId: string,
): Promise<void> {
  try {
    await rpc(fetchImpl, config, cookie, "session/cancel", { request: { sessionId } });
  } catch {
    // 取消失败不能盖住原来的超时或中断。这一轮可能仍会烧到内核自己结束。
  }
}

type WaitArgs = {
  fetchImpl: FetchLike;
  config: DshConfig;
  cookie: string;
  sessionId: string;
  requestId: string;
  deadline: number;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  signal?: AbortSignal;
  onWait?: () => void;
};

async function waitForSettledReply(args: WaitArgs): Promise<string> {
  const { fetchImpl, config, cookie, sessionId, requestId, deadline, sleep, now, signal, onWait } = args;
  let sawRequest = false;
  let sawRunningText = false;
  let stableReply = "";
  let stablePolls = 0;
  while (now() <= deadline) {
    throwIfAborted(signal);
    onWait?.();
    let row: Record<string, unknown>;
    try {
      row = await findSession(fetchImpl, config, cookie, sessionId, signal, sessionId === config.sessionId);
    } catch (error) {
      rethrowAbort(error);
      if (sessionId === config.sessionId || !isMissingJobSession(error)) throw error;
      if (now() >= deadline) break;
      throwIfAborted(signal);
      await sleep(1000);
      continue;
    }
    const state = sessionTurnState(row);
    const cursor = await latestCursor(fetchImpl, config, cookie, row, sessionId, signal);
    let reply = "";
    if (cursor >= 0) {
      const page = await rpc(fetchImpl, config, cookie, "session/page", {
        request: {
          address: { kind: "session", sessionId },
          throughSeq: cursor,
          maxMessages: PAGE_MESSAGES,
        },
      }, signal);
      const extracted = readAssistantReply(page, requestId);
      if (extracted.sawRequest) sawRequest = true;
      reply = extracted.sawRequest ? extracted.reply : sawRequest ? extracted.latestAssistant : "";
    }
    // running 期间的助手气泡只是这一步里的中途句。正文还在往下写，不能在这里返回。
    if (state === "running") {
      if (reply) sawRunningText = true;
      stableReply = "";
      stablePolls = 0;
    } else if (reply && reply === stableReply) {
      stablePolls += 1;
      // 列表明确闲着时，连续两次正文不变即可。没有状态字段时再多等一次，避免把刚出现的短句收走。
      const needed = state === "idle" ? STABLE_IDLE_POLLS : STABLE_IDLE_POLLS + 1;
      if (stablePolls >= needed) return reply;
    } else if (reply) {
      stableReply = reply;
      stablePolls = 1;
    } else {
      stableReply = "";
      stablePolls = 0;
    }
    if (now() >= deadline) break;
    throwIfAborted(signal);
    await sleep(1000);
  }
  if (sawRunningText) throw new Error(timeoutStillWriting(config.timeoutMs));
  throw new Error(timeoutNoReply(config.timeoutMs));
}

function timeoutStillWriting(timeoutMs: number): string {
  return `独立内核超时了（已等约 ${waitMinutes(timeoutMs)} 分钟），时限内没有写完。中途的句子没有保存。原稿保持不变。`;
}

function timeoutNoReply(timeoutMs: number): string {
  return `独立内核超时了（已等约 ${waitMinutes(timeoutMs)} 分钟），时限内没有写回结果。原稿保持不变。`;
}

function waitMinutes(timeoutMs: number): number {
  return Math.max(1, Math.round(timeoutMs / 60_000));
}

function sessionChoices(value: unknown): DshSessionChoice[] {
  const items = value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)
    ? (value as { items: unknown[] }).items
    : [];
  const choices: DshSessionChoice[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const sessionId = typeof row.sessionId === "string" ? row.sessionId.trim() : "";
    if (!sessionId || sessionId.length > 200) continue;
    choices.push({
      sessionId,
      title: sessionTitle(row, sessionId),
      running: sessionTurnState(row) === "running",
    });
  }
  return choices;
}

function sessionTitle(row: Record<string, unknown>, sessionId: string): string {
  for (const key of ["title", "name", "label"]) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 80);
  }
  return sessionId;
}

function isMissingJobSession(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("独立内核里找不到这一轮新开的会话");
}

function basicAuthHeader(config: DshConfig): Record<string, string> {
  const user = config.basicUser.trim();
  if (!user) return {};
  return { authorization: `Basic ${Buffer.from(`${user}:${config.basicPassword}`, "utf8").toString("base64")}` };
}

type ConnectObservation = {
  cookie: string;
  status: number;
  location: string;
  body: string;
};

function cookiePairs(lines: string[]): string {
  return lines.map((item) => item.split(";")[0]?.trim() ?? "").filter(Boolean).join("; ");
}

function cookiesFromFetchHeaders(headers: Headers): string[] {
  const listed = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  const lines = listed.filter((item) => item.trim());
  const single = headers.get("set-cookie");
  if (single?.trim() && !lines.some((item) => item === single || item.startsWith(`${single.split(";")[0]};`))) lines.push(single);
  return lines;
}

function redactLaunchToken(text: string, token: string): string {
  const secret = token.trim();
  if (secret.length < 6 || !text.includes(secret)) return text;
  return text.split(secret).join("…");
}

function describeExchange(path: string, config: DshConfig, seen: ConnectObservation): string {
  const location = redactLaunchToken(seen.location, config.token);
  const body = redactLaunchToken(seen.body.replace(/\s+/g, " ").trim().slice(0, 160), config.token);
  const status = seen.status || "无状态";
  const where = location ? `，Location: ${location}` : "";
  const said = body ? `，正文「${body}」` : "";
  return `GET ${path} 回答 ${status}${where}${said}`;
}

function connectFailure(config: DshConfig, path: string, seen: ConnectObservation): Error {
  if (seen.status === 401) {
    return new Error(`这台 DSH 拒绝了令牌（${describeExchange(path, config, seen)}）。请核对这次 dsh web 印出的 token=。它不是模型的 API Key。`);
  }
  if (seen.status === 403) {
    return new Error(`这台 DSH 拒绝了来源（${describeExchange(path, config, seen)}）。请把围读所在主机名写进该内核的 trustedHosts。`);
  }
  if (seen.status === 404) {
    return new Error(
      `这台 DSH 没有 ${path}（回答 404）。这一版很可能不提供 /connect。请核对 dsh 版本；Token 仍是 dsh web 印出的 token=，不是模型的 API Key。`,
    );
  }
  return new Error(
    `向 ${config.baseUrl}${path} 要登录 cookie，${describeExchange(path, config, seen)}，没有 Set-Cookie。请确认 Token 是这次 dsh web 印出的 token=，不是模型的 API Key。`,
  );
}

function versionMismatch(config: DshConfig, connectSeen: ConnectObservation, rootSeen: ConnectObservation): Error {
  if (rootSeen.status === 401) {
    return new Error(
      `这台 DSH 没有 /connect（回答 404）。${describeExchange("/", config, rootSeen)}。请核对这次 dsh web 印出的 token=。它不是模型的 API Key。`,
    );
  }
  if (rootSeen.status === 403) {
    return new Error(`这台 DSH 没有 /connect（回答 404）。${describeExchange("/", config, rootSeen)}。请把围读所在主机名写进该内核的 trustedHosts。`);
  }
  return new Error(
    `这台 DSH 没有 /connect（回答 ${connectSeen.status || 404}）。${describeExchange("/", config, rootSeen)}，没有 Set-Cookie。这一版可能没有给第三方客户端的登录接口。Token 不会写在这条说明里。`,
  );
}

function connectUrl(config: DshConfig): URL {
  const url = new URL("/connect", `${config.baseUrl}/`);
  url.searchParams.set("token", config.token);
  url.searchParams.set("interactions", "none");
  return url;
}

function rootTokenUrl(config: DshConfig): URL {
  const url = new URL("/", `${config.baseUrl}/`);
  url.searchParams.set("token", config.token);
  return url;
}

async function readConnectViaFetch(fetchImpl: FetchLike, config: DshConfig, url: URL, signal?: AbortSignal): Promise<ConnectObservation> {
  const response = await fetchImpl(url, {
    redirect: "manual",
    cache: "no-store",
    signal,
    headers: basicAuthHeader(config),
  });
  const body = await response.text().catch(() => "");
  return {
    cookie: cookiePairs(cookiesFromFetchHeaders(response.headers)),
    status: response.status,
    location: response.headers.get("location") ?? "",
    body,
  };
}

/** GET /connect without following the 302. Node fetch sometimes hides Set-Cookie on that redirect. */
function readConnectViaHttp(config: DshConfig, url: URL, signal?: AbortSignal): Promise<ConnectObservation> {
  const lib = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: {
          ...basicAuthHeader(config),
          host: url.host,
          connection: "close",
          accept: "*/*",
        },
        timeout: 8_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        const cookies: string[] = [];
        for (let index = 0; index < res.rawHeaders.length; index += 2) {
          if (res.rawHeaders[index]?.toLowerCase() === "set-cookie") cookies.push(res.rawHeaders[index + 1] ?? "");
        }
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const location = res.headers.location;
          resolve({
            cookie: cookiePairs(cookies),
            status: res.statusCode ?? 0,
            location: Array.isArray(location) ? location[0] ?? "" : location ?? "",
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    const fail = (error: unknown) => {
      reject(error);
    };
    req.on("error", fail);
    if (signal) {
      const abort = () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        req.destroy(error);
      };
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    }
    req.end();
  });
}

function unreachable(config: DshConfig, error: unknown): Error {
  const reason = error instanceof Error ? redactLaunchToken(error.message, config.token) : "";
  return new Error(`连不上这台 DSH（${config.baseUrl}）。请确认地址在围读所在的网络里能访问。${reason ? ` ${reason}` : ""}`);
}

async function connect(fetchImpl: FetchLike, config: DshConfig, signal?: AbortSignal, rawFallback = false): Promise<string> {
  const apiUrl = connectUrl(config);
  let fetched: ConnectObservation | undefined;
  try {
    fetched = await readConnectViaFetch(fetchImpl, config, apiUrl, signal);
    if (fetched.cookie) return fetched.cookie;
  } catch (error) {
    rethrowAbort(error);
    if (!rawFallback) throw unreachable(config, error);
  }
  if (!rawFallback) {
    if (fetched) throw connectFailure(config, "/connect", fetched);
    throw unreachable(config, new Error("没有收到 HTTP 回答"));
  }
  let raw: ConnectObservation | undefined;
  try {
    raw = await readConnectViaHttp(config, apiUrl, signal);
    if (raw.cookie) return raw.cookie;
  } catch (error) {
    rethrowAbort(error);
    if (fetched && fetched.status !== 404) throw connectFailure(config, "/connect", fetched);
    if (!fetched) throw unreachable(config, error);
  }
  const connectStatus = raw?.status ?? fetched?.status ?? 0;
  if (connectStatus === 404) {
    let root: ConnectObservation;
    try {
      root = await readConnectViaHttp(config, rootTokenUrl(config), signal);
    } catch (error) {
      rethrowAbort(error);
      const reason = error instanceof Error ? redactLaunchToken(error.message, config.token) : "";
      throw new Error(`这台 DSH 没有 /connect（回答 404）。改试启动地址 / 时连不上。${reason ? ` ${reason}` : ""}`);
    }
    if (root.cookie) return root.cookie;
    throw versionMismatch(config, raw ?? fetched ?? { cookie: "", status: 404, location: "", body: "" }, root);
  }
  if (raw) throw connectFailure(config, "/connect", raw);
  if (fetched) throw connectFailure(config, "/connect", fetched);
  throw unreachable(config, new Error("没有收到 HTTP 回答"));
}

async function templateSessionModel(
  fetchImpl: FetchLike,
  config: DshConfig,
  cookie: string,
  signal?: AbortSignal,
): Promise<{ provider: string; model: string } | null> {
  try {
    const value = await rpc(fetchImpl, config, cookie, "session/models", { request: { sessionId: config.sessionId } }, signal);
    const current = value && typeof value === "object" ? (value as { current?: { provider?: unknown; model?: unknown } }).current : undefined;
    const provider = typeof current?.provider === "string" ? current.provider.trim() : "";
    const model = typeof current?.model === "string" ? current.model.trim() : "";
    if (!provider || !model) return null;
    return { provider, model };
  } catch (error) {
    rethrowAbort(error);
    return null;
  }
}

async function selectJobModel(
  fetchImpl: FetchLike,
  config: DshConfig,
  cookie: string,
  sessionId: string,
  model: { provider: string; model: string },
  signal?: AbortSignal,
  secrets?: readonly string[],
): Promise<void> {
  try {
    await rpc(fetchImpl, config, cookie, "session/selectModel", {
      request: {
        sessionId,
        provider: model.provider,
        model: model.model,
      },
    }, signal, secrets);
  } catch (error) {
    rethrowAbort(error);
    const detail = clip(error instanceof Error ? error.message : "");
    if (secrets) {
      throw new Error(ephemeralFailureMessage(detail, secrets[0] ?? ""));
    }
    throw new Error(
      `没能改用所选的 DSH 模型（${model.provider} / ${model.model}）。这次没有提交，也不会改用别的模型。原稿保持不变。${detail ? ` ${detail}` : ""}`,
    );
  }
}

export type DshInspectResult = {
  sessions: DshSessionChoice[];
  catalog: DshCatalogView;
};

/**
 * 用地址和令牌列会话，并尽量拉模型目录。还没有会话 id 也能调用，给连接向导用。
 * 会话和目录都空则抛错。目录失败但有会话时，目录带错误说明，不挡选会话。
 */
export async function inspectDshConnection(
  input: { baseUrl: string; token: string; basicUser?: string; basicPassword?: string },
  deps: { fetchImpl?: FetchLike; signal?: AbortSignal } = {},
): Promise<DshInspectResult> {
  const baseUrl = input.baseUrl.trim().replace(/\/+$/, "");
  const token = input.token.trim();
  if (!baseUrl || !token) throw new Error("要填写 DSH 地址和令牌。");
  const config: DshConfig = {
    baseUrl,
    token,
    sessionId: "",
    timeoutMs: 8_000,
    basicUser: input.basicUser?.trim() ?? "",
    basicPassword: input.basicPassword ?? "",
    configured: true,
    missing: [],
  };
  const fetchImpl = deps.fetchImpl ?? fetch;
  const cookie = await connect(fetchImpl, config, deps.signal, true);
  const listed = await rpc(fetchImpl, config, cookie, "session/list", { _request: {} }, deps.signal);
  const sessions = sessionChoices(listed);
  let catalog: DshCatalogView;
  try {
    catalog = catalogFromValue(await rpc(fetchImpl, config, cookie, "session/modelCatalog", {}, deps.signal));
  } catch (error) {
    rethrowAbort(error);
    const message = error instanceof Error ? error.message : "模型目录没拉下来。";
    catalog = emptyDshCatalog(message);
  }
  if (sessions.length === 0 && !catalog.loaded) {
    throw new Error(catalog.error || "连上了，但没有列出会话，也没有模型目录。");
  }
  return { sessions, catalog };
}

/** 实拉 session/modelCatalog。调用方负责把值收成选项；这里不写死任何模型。 */
export async function readDshModelCatalog(deps: Pick<Deps, "fetchImpl" | "env" | "signal"> = {}): Promise<unknown> {
  const config = getDshConfig(deps.env);
  if (!config.configured) {
    throw new Error(`未配齐 DSH（缺 ${config.missing.join("、")}）。`);
  }
  const fetchImpl = deps.fetchImpl ?? fetch;
  const cookie = await connect(fetchImpl, config, deps.signal, true);
  return rpc(fetchImpl, config, cookie, "session/modelCatalog", {}, deps.signal);
}

async function rpc(
  fetchImpl: FetchLike,
  config: DshConfig,
  cookie: string,
  method: string,
  args: unknown,
  signal?: AbortSignal,
  secrets?: readonly string[],
): Promise<unknown> {
  const scrub = (text: string) => scrubSecrets(text, secrets);
  let response: Response;
  try {
    response = await fetchImpl(`${config.baseUrl}/api/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, ...basicAuthHeader(config) },
      body: JSON.stringify({
        type: "client-request",
        rpcId: crypto.randomUUID(),
        method,
        payload: { args },
      }),
      signal,
    });
  } catch (error) {
    rethrowAbort(error);
    const reason = error instanceof Error ? error.message : "";
    throw new Error(scrub(`调用独立内核失败。${reason}`));
  }
  const raw = await response.text();
  if (response.status === 401) throw new Error("这台 DSH 拒绝了连接，请核对 Token。");
  if (response.status === 403) throw new Error("这台 DSH 拒绝了来源。请把围读所在主机名写进该内核的 trustedHosts。");
  if (!response.ok) throw new Error(scrub(`独立内核返回 ${response.status}。${clip(scrub(raw))}`));
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("独立内核的回复不是 JSON。");
  }
  const result = unwrap(json);
  if (result && typeof result === "object" && "ok" in result) {
    const record = result as { ok?: boolean; value?: unknown; error?: { message?: string; code?: string } };
    if (record.ok === false) {
      const message = record.error?.message || "独立内核拒绝了这次调用。";
      const code = typeof record.error?.code === "string" ? record.error.code.trim() : "";
      const combined = scrub(code && !message.includes(code) ? `${code} ${message}` : message);
      const past = /past cursor (\d+)/.exec(combined);
      if (past) {
        const error = new Error(combined);
        (error as Error & { cursor?: number }).cursor = Number(past[1]);
        throw error;
      }
      throw new Error(combined);
    }
    return record.value;
  }
  return result;
}

function scrubSecrets(text: string, secrets?: readonly string[]): string {
  if (!secrets?.length) return text;
  let next = text;
  for (const secret of secrets) next = redactCredential(next, secret);
  return next;
}

async function findSession(
  fetchImpl: FetchLike,
  config: DshConfig,
  cookie: string,
  sessionId: string,
  signal: AbortSignal | undefined,
  template: boolean,
): Promise<Record<string, unknown>> {
  const value = await rpc(fetchImpl, config, cookie, "session/list", { _request: {} }, signal);
  const items = value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)
    ? (value as { items: unknown[] }).items
    : [];
  const found = items.find((item) => item && typeof item === "object" && (item as { sessionId?: string }).sessionId === sessionId);
  if (!found || typeof found !== "object") {
    throw new Error(
      template
        ? "独立内核里没有 DSH_SESSION_ID 对应的会话。原稿保持不变。"
        : "独立内核里找不到这一轮新开的会话。原稿保持不变。",
    );
  }
  return found as Record<string, unknown>;
}

async function latestCursor(
  fetchImpl: FetchLike,
  config: DshConfig,
  cookie: string,
  row: Record<string, unknown>,
  sessionId: string,
  signal?: AbortSignal,
): Promise<number> {
  const projections = row.projections;
  if (projections && typeof projections === "object") {
    const block = projections as { kind?: string; asOfSeq?: number };
    if (block.kind === "sequenced" && typeof block.asOfSeq === "number" && block.asOfSeq >= 0) return block.asOfSeq;
  }
  try {
    await rpc(fetchImpl, config, cookie, "session/page", {
      request: {
        address: { kind: "session", sessionId },
        throughSeq: 1_000_000_000,
        maxMessages: 1,
      },
    }, signal);
  } catch (error) {
    rethrowAbort(error);
    const cursor = (error as { cursor?: number }).cursor;
    if (typeof cursor === "number") return cursor;
    throw error;
  }
  return -1;
}

/**
 * 会话列表上的这一轮是否还在写。
 * `running === true` 优先：站点上看到的空闲要等列表自己变成 idle / agentAvailable。
 * 只有 `agentAvailable === false` 还不能当成在写，冷会话在开写之前也是这样。
 */
function sessionTurnState(row: Record<string, unknown>): "running" | "idle" | "unknown" {
  if (row.running === true) return "running";
  if (row.running === false) return "idle";
  const agent = row.agent;
  const nested = agent && typeof agent === "object" ? (agent as { status?: unknown }).status : undefined;
  const status = typeof row.status === "string" ? row.status : typeof row.agentStatus === "string" ? row.agentStatus : typeof nested === "string" ? nested : "";
  if (status === "running") return "running";
  if (status === "idle" || status === "done") return "idle";
  if (row.idle === false) return "running";
  if (row.idle === true) return "idle";
  if (row.agentAvailable === true) return "idle";
  return "unknown";
}

function isAssistantMessage(type: string): boolean {
  return type === "assistant/message" || type.endsWith("/assistant/message");
}

/**
 * 本轮请求之后，在完整助手正文里取最长的一份；没有组装结果时，才在其它助手文本里取最长的一份。
 * 一样长时留后面那条。短的收尾确认不能盖住前面的长稿。多条消息不拼在一起。
 * 请求 id 已经滚出这一页时，这一页都在该请求之后，同样取最长的一份。
 */
function readAssistantReply(page: unknown, requestId: string): { reply: string; sawRequest: boolean; latestAssistant: string } {
  const records = page && typeof page === "object" && Array.isArray((page as { records?: unknown }).records)
    ? (page as { records: unknown[] }).records
    : [];
  let sawRequest = false;
  let messageAfter = "";
  let fallbackAfter = "";
  let messageAny = "";
  let fallbackAny = "";
  for (const record of records) {
    const event = record && typeof record === "object" && "event" in record ? (record as { event?: unknown }).event : record;
    if (!event || typeof event !== "object") continue;
    const typed = event as { type?: unknown; data?: unknown };
    const text = replyText(typed.data);
    if (!text) continue;
    if (text.includes(requestId)) {
      sawRequest = true;
      messageAfter = "";
      fallbackAfter = "";
      continue;
    }
    const type = typeof typed.type === "string" ? typed.type : "";
    if (!type.includes("assistant")) continue;
    if (isAssistantMessage(type)) {
      messageAny = longerReply(messageAny, text);
      if (sawRequest) messageAfter = longerReply(messageAfter, text);
    } else {
      fallbackAny = longerReply(fallbackAny, text);
      if (sawRequest) fallbackAfter = longerReply(fallbackAfter, text);
    }
  }
  return {
    sawRequest,
    reply: messageAfter || fallbackAfter,
    latestAssistant: messageAny || fallbackAny,
  };
}

/** 留下更长的那一份。一样长时留后面那条，短确认不会替掉长稿。两份都不拼起来。 */
function longerReply(current: string, candidate: string): string {
  if (!current) return candidate;
  if (countChars(candidate) >= countChars(current)) return candidate;
  return current;
}

/**
 * 只要这一条消息自己的正文。
 * 组装结果在 message.content（或没有 message 时的 content）。
 * stream 里的 text-chunks / block-end 是同一份正文的另一份记录，有组装结果时不能再接上。
 */
function replyText(data: unknown): string {
  const surface = surfaceText(data);
  if (surface) return surface;
  return streamText(data);
}

function surfaceText(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const record = data as Record<string, unknown>;
  const message = record.message;
  if (message && typeof message === "object") {
    const fromMessage = joinParts(textBlocks((message as { content?: unknown }).content));
    if (fromMessage) return fromMessage;
  }
  return joinParts(textBlocks(record.content));
}

/** 没有组装正文时，才用流还原一份。文本增量、分块和 block-end 三选一，不叠在一起。 */
function streamText(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const stream = (data as { stream?: unknown }).stream;
  if (!Array.isArray(stream)) return "";
  const chunks: string[] = [];
  const deltas: string[] = [];
  const blockEnds: string[] = [];
  for (const item of stream) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (record.type === "text-chunks" && Array.isArray(record.texts)) {
      for (const piece of record.texts) if (typeof piece === "string") chunks.push(piece);
      continue;
    }
    const chunk = record.type === "chunk" && record.chunk && typeof record.chunk === "object"
      ? (record.chunk as Record<string, unknown>)
      : record;
    if (chunk.type === "text-delta" && typeof chunk.text === "string") {
      deltas.push(chunk.text);
      continue;
    }
    if (chunk.type !== "block-end" || !chunk.block || typeof chunk.block !== "object") continue;
    const block = chunk.block as { type?: unknown; text?: unknown };
    if (block.type === "text" && typeof block.text === "string") blockEnds.push(block.text);
  }
  const fromChunks = chunks.join("").trim();
  if (fromChunks) return fromChunks;
  const fromDeltas = deltas.join("").trim();
  if (fromDeltas) return fromDeltas;
  return joinParts(blockEnds);
}

function textBlocks(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const parts: string[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const block = item as { type?: unknown; text?: unknown };
    if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
  }
  return parts;
}

function joinParts(parts: string[]): string {
  const kept: string[] = [];
  for (const part of parts) {
    if (!part.trim()) continue;
    const previous = kept[kept.length - 1];
    if (previous !== undefined && previous.trim() === part.trim()) continue;
    kept.push(part);
  }
  return kept.join("\n").trim();
}

function unwrap(json: unknown): unknown {
  if (!json || typeof json !== "object") return json;
  const record = json as Record<string, unknown>;
  if (record.type === "server-response") return record.result;
  if ("result" in record) return record.result;
  return json;
}

function readTimeout(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(5_000, Math.round(parsed)));
}

function clip(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 180);
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

function rethrowAbort(error: unknown): void {
  if (error instanceof DOMException && error.name === "AbortError") throw error;
  if (error instanceof Error && error.name === "AbortError") throw error;
}
