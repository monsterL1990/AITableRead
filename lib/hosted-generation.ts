import { lockPresetDsModel } from "./account-policy";
import { loadActiveTextRoute, type ActiveTextRoute } from "./active-text-route";
import { getDshConfig, promptDshSession } from "./dsh";
import { formatDshModelRef } from "./dsh-catalog";
import type { Locale } from "./i18n/locale";
import { resolveRequestLocale } from "./i18n/request";
import { translate } from "./i18n/translate";
import { routeMark } from "./format";
import { buildGeneration, generationLogDetail, unfinishedProseMessage, type BuiltGeneration } from "./generation";
import { streamChat } from "./llm";
import {
  BUSY_JOB_MESSAGE,
  CANCEL_JOB_MESSAGE,
  hostedTimeoutMessage,
  pendingJobExpired,
  pendingJobLabel,
} from "./pending-job";
import {
  amendReviewOpinion,
  appendLog,
  applyQualityReport,
  applyReview,
  applySnapshot,
  isStepId,
  lengthError,
  pushVersion,
  stepKind,
} from "./pipeline";
import { getProject, getPromptOverrides, listReaders, updateProject } from "./store";
import { planGeneration, routeClientStatus, type GenerationPlan } from "./text-route";
import type { AccountType, FeedbackSource, GenerateSnapshot, GenerateTask, PendingJob, Project, StepId, TextRoute } from "./types";

/**
 * 一轮出字的生命周期在服务器上，不跟某一次浏览器连接绑在一起。
 * request.signal 只用来停 SSE。超时和用户点取消才 abort，并因此取消临时 DSH 会话。
 */

export type HostedEvent =
  | { type: "status"; message: string }
  | { type: "delta"; text: string; task: GenerateTask; readerId: string | null }
  | {
      type: "done";
      text: string;
      task: GenerateTask;
      readerId: string | null;
      revision: number;
      project: Project;
      demoMode: boolean;
      textRoute: TextRoute;
    }
  | { type: "error"; message: string }
  | { type: "comment" }
  | { type: "pending"; project: Project };

export type HostedGenerateDeps = {
  /** 测试里替换真正的 DSH / CLIProxy 调用。生产不传。 */
  runText?: (args: {
    signal: AbortSignal;
    onDelta: (text: string) => void;
    onStatus: (message: string) => void;
    onWait: () => void;
  }) => Promise<string>;
  timeoutMs?: number;
  now?: () => number;
  /** 预设账号锁经 DSH，非预设账号只用自己的密钥。缺省按站长。 */
  accountType?: AccountType;
};

type StopReason = "cancel" | "timeout" | null;

type Slot = {
  key: string;
  ownerId: string;
  projectId: string;
  requestId: string;
  abort: AbortController;
  stopReason: StopReason;
  timer: ReturnType<typeof setTimeout> | null;
  listeners: Set<(event: HostedEvent) => void>;
  buffer: HostedEvent[];
  subscribed: boolean;
  settled: boolean;
  done: Promise<void>;
  resolveDone: () => void;
  timeoutMs: number;
};

const jobs = new Map<string, Slot>();

class WriteSkipped extends Error {
  constructor(readonly kind: "conflict" | "unchanged") {
    super(kind);
    this.name = "WriteSkipped";
  }
}

function jobKey(ownerId: string, projectId: string): string {
  return `${ownerId}:${projectId}`;
}

function timeoutOf(override?: number): number {
  if (typeof override === "number" && Number.isFinite(override) && override > 0) return Math.round(override);
  return getDshConfig().timeoutMs;
}

function isAbortError(error: unknown): boolean {
  return (error instanceof DOMException && error.name === "AbortError") || (error instanceof Error && error.name === "AbortError");
}

function isTask(value: unknown): value is GenerateTask {
  return (
    value === "outline" ||
    value === "draft" ||
    value === "polish" ||
    value === "review" ||
    value === "revise-from-feedback" ||
    value === "quality-check" ||
    value === "amend-review"
  );
}

function isSource(value: unknown): value is FeedbackSource {
  return value === "user" || value === "readers" || value === "quality";
}

function createSlot(ownerId: string, projectId: string, timeoutMs: number): Slot {
  let resolveDone: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  const requestId = crypto.randomUUID();
  return {
    key: jobKey(ownerId, projectId),
    ownerId,
    projectId,
    requestId,
    abort: new AbortController(),
    stopReason: null,
    timer: null,
    listeners: new Set(),
    buffer: [],
    subscribed: false,
    settled: false,
    done,
    resolveDone,
    timeoutMs,
  };
}

function dropSlot(slot: Slot) {
  if (slot.timer) clearTimeout(slot.timer);
  slot.timer = null;
  slot.settled = true;
  if (jobs.get(slot.key) === slot) jobs.delete(slot.key);
  slot.resolveDone();
}

function emit(slot: Slot, event: HostedEvent) {
  if (!slot.subscribed) {
    slot.buffer.push(event);
    return;
  }
  for (const listener of slot.listeners) listener(event);
}

function subscribe(slot: Slot, listener: (event: HostedEvent) => void): () => void {
  slot.subscribed = true;
  const pending = slot.buffer.splice(0);
  for (const event of pending) listener(event);
  slot.listeners.add(listener);
  return () => {
    slot.listeners.delete(listener);
  };
}

export function resetHostedJobsForTests() {
  for (const slot of jobs.values()) {
    slot.stopReason = slot.stopReason ?? "cancel";
    slot.abort.abort();
    dropSlot(slot);
  }
  jobs.clear();
}

function readSnapshot(value: unknown): GenerateSnapshot | { error: string } {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "材料格式不对。" };
  const raw = value as Record<string, unknown>;
  const snapshot: GenerateSnapshot = {};
  for (const key of ["idea", "outline", "draft", "polished"] as const) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== "string") return { error: "材料必须是文本。" };
    const issue = lengthError(key, raw[key]);
    if (issue) return { error: issue };
    snapshot[key] = raw[key];
  }
  return snapshot;
}

function commitOutput(
  project: Project,
  task: GenerateTask,
  step: StepId,
  source: FeedbackSource,
  feedback: string,
  full: string,
  via: TextRoute,
  logNote?: string,
  viaDetail?: string,
) {
  if (task === "quality-check") {
    applyQualityReport(project, step, full, via, viaDetail);
    return;
  }
  const kind = task === "outline" ? "outline" : task === "draft" ? "draft" : task === "polish" ? "polish" : stepKind(step);
  const versionSource = task === "revise-from-feedback" ? (source === "quality" ? "quality" : "feedback") : "generate";
  const note =
    task === "revise-from-feedback"
      ? source === "user"
        ? "按作者意见改"
        : source === "readers"
          ? "按读者意见改"
          : "按质检意见改"
      : task === "polish"
        ? "润色"
        : "生成";
  const version = pushVersion(project, kind, full, versionSource, note);
  appendLog(project, {
    step,
    type: task,
    summary: `${note}：${version.label}。（${routeMark(via)}${viaDetail ? ` · ${viaDetail}` : ""}）`,
    detail: generationLogDetail(task, feedback, full, logNote),
    versionId: version.id,
  });
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function failureMessage(error: unknown, slot: Slot): string {
  const aborted = slot.abort.signal.aborted || isAbortError(error);
  if (aborted) {
    if (slot.stopReason === "timeout") return hostedTimeoutMessage(slot.timeoutMs);
    return CANCEL_JOB_MESSAGE;
  }
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return "生成失败。原稿保持不变。";
}

function failureType(message: string, slot: Slot): "cancel" | "timeout" | "error" {
  if (slot.stopReason === "cancel") return "cancel";
  if (slot.stopReason === "timeout" || message.includes("超时")) return "timeout";
  return "error";
}

async function produceText(args: {
  signal: AbortSignal;
  built: BuiltGeneration;
  plan: GenerationPlan;
  active: ActiveTextRoute;
  locale: Locale;
  onDelta: (text: string) => void;
  onStatus: (message: string) => void;
  onWait: () => void;
  onModel: (detail: string) => void;
}): Promise<string> {
  const { signal, built, plan, active, locale, onDelta, onStatus, onWait, onModel } = args;
  if (plan.transport === "demo") {
    let full = "";
    const size = 18;
    for (let index = 0; index < built.demo.length; index += size) {
      const piece = built.demo.slice(index, index + size);
      full += piece;
      onDelta(piece);
      await sleep(12, signal);
    }
    return full;
  }
  if (plan.transport === "dsh-ephemeral") {
    onStatus(translate(locale, "job.dshByok", { model: plan.credential.model }));
    return promptDshSession(
      { system: built.system, user: built.user },
      {
        env: active.dshEnv,
        ephemeralCredential: plan.credential,
        signal,
        sleep: (ms) => sleep(ms, signal),
        onModel: (chosen) => {
          const name = chosen?.model?.trim() || plan.credential.model;
          onModel(`自备 Key · ${name}`);
        },
        onWait,
      },
    );
  }
  if (plan.transport === "dsh") {
    const viaDetail = formatDshModelRef(active.dshModel);
    onStatus(viaDetail ? translate(locale, "job.dshDetail", { detail: viaDetail }) : translate(locale, "job.dsh"));
    return promptDshSession(
      { system: built.system, user: built.user },
      {
        env: active.dshEnv,
        model: active.dshModel,
        signal,
        sleep: (ms) => sleep(ms, signal),
        onModel: (model) => {
          const label = formatDshModelRef(model);
          if (label) onModel(label);
        },
        onWait,
      },
    );
  }
  return streamChat(
    {
      system: built.system,
      user: built.user,
      temperature: built.temperature,
      signal,
      onDelta,
    },
    plan.llm,
  );
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function handleGenerateRequest(
  request: Request,
  projectId: string,
  ownerId: string,
  deps: HostedGenerateDeps = {},
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("请求不是 JSON。", 400);
  }
  const locale = await resolveRequestLocale(request);
  const record = (body ?? {}) as Record<string, unknown>;
  if (!isTask(record.task)) return jsonError("不知道要生成哪一步。", 400);
  const task = record.task;
  const step = isStepId(record.step) ? record.step : task === "draft" ? 2 : task === "polish" || task === "quality-check" ? 3 : 1;
  const readerId = typeof record.readerId === "string" && record.readerId.trim() ? record.readerId.trim() : undefined;
  const reviewId = typeof record.reviewId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(record.reviewId.trim()) ? record.reviewId.trim() : undefined;
  const feedback = typeof record.feedback === "string" ? record.feedback : "";
  const feedbackSource: FeedbackSource = isSource(record.feedbackSource) ? record.feedbackSource : "user";
  if (feedback && feedbackSource !== "readers") {
    const issue = lengthError("feedback", feedback);
    if (issue) return jsonError(issue, 400);
  }
  const snapshot = readSnapshot(record.snapshot);
  if ("error" in snapshot) return jsonError(snapshot.error, 400);

  const key = jobKey(ownerId, projectId);
  if (jobs.has(key)) return jsonError(BUSY_JOB_MESSAGE, 409);

  let project: Project | null;
  let readers;
  try {
    project = await getProject(ownerId, projectId);
    readers = await listReaders(ownerId);
  } catch {
    return jsonError("稿库读不出来，请检查 data/store.json。", 500);
  }
  if (!project) return jsonError("没有这份稿子。", 404);
  if (jobs.has(key)) return jsonError(BUSY_JOB_MESSAGE, 409);
  const reader = readerId ? readers.find((item) => item.id === readerId) : undefined;
  if ((task === "review" || task === "amend-review") && !reader) return jsonError("没有这位读者。", 400);

  const overlay = structuredClone(project);
  applySnapshot(overlay, snapshot);
  let prompts: Awaited<ReturnType<typeof getPromptOverrides>> = {};
  try {
    prompts = await getPromptOverrides(ownerId);
  } catch {
    return jsonError("提示词读不出来。", 500);
  }
  const built = buildGeneration({
    task,
    step,
    reader,
    feedback,
    feedbackSource,
    project: overlay,
    prompts,
    readers,
  });
  if ("error" in built) return jsonError(built.error, 400);

  let active: ActiveTextRoute;
  let plan: GenerationPlan;
  try {
    active = await lockPresetDsModel(await loadActiveTextRoute({ uid: ownerId, type: deps.accountType }));
    plan = planGeneration(active.route, active.customApi, undefined, { ephemeralProvider: active.ephemeralProvider });
  } catch (error) {
    const message = error instanceof Error ? error.message : "稿库读不出来，请检查 data/store.json。";
    const status = routeClientStatus(message);
    return jsonError(message, status);
  }
  if (jobs.has(key)) return jsonError(BUSY_JOB_MESSAGE, 409);

  const now = deps.now ?? Date.now;
  const timeoutMs = timeoutOf(deps.timeoutMs);
  const slot = createSlot(ownerId, projectId, timeoutMs);
  jobs.set(key, slot);
  const pending: PendingJob = {
    task,
    step,
    startedAt: new Date(now()).toISOString(),
    requestId: slot.requestId,
    label: pendingJobLabel({ task, feedbackSource, readerId, reviewId }),
    ...(task === "revise-from-feedback" ? { feedbackSource } : {}),
    ...(readerId ? { readerId } : {}),
  };

  let claimed: Project | null;
  try {
    claimed = await updateProject(ownerId, projectId, (current) => {
      const existing = current.pendingJob;
      if (existing && existing.requestId !== slot.requestId && !pendingJobExpired(existing, now(), timeoutMs)) {
        throw new WriteSkipped("conflict");
      }
      if (existing && existing.requestId !== slot.requestId && pendingJobExpired(existing, now(), timeoutMs)) {
        appendLog(current, {
          step: existing.step,
          type: "timeout",
          summary: hostedTimeoutMessage(timeoutMs),
          detail: "上一轮超过时限，已停下。",
          versionId: null,
        });
        current.pendingJob = null;
      }
      applySnapshot(current, snapshot);
      current.pendingJob = pending;
    });
  } catch (error) {
    dropSlot(slot);
    if (error instanceof WriteSkipped && error.kind === "conflict") return jsonError(BUSY_JOB_MESSAGE, 409);
    return jsonError("生成前没能保存当前文字。", 500);
  }
  if (!claimed) {
    dropSlot(slot);
    return jsonError("没有这份稿子。", 404);
  }

  const route = plan.transport === "dsh-ephemeral" ? "dsh" : active.route;
  let modelDetail =
    plan.transport === "dsh-ephemeral"
      ? `自备 Key · ${active.customApi.model.trim()}`
      : route === "dsh"
        ? formatDshModelRef(active.dshModel)
        : "";
  const readerForEvents = readerId ?? null;

  const run = async () => {
    slot.timer = setTimeout(() => {
      if (slot.settled || slot.abort.signal.aborted) return;
      slot.stopReason = "timeout";
      slot.abort.abort();
    }, timeoutMs);
    try {
      emit(slot, { type: "pending", project: claimed });
      if (slot.abort.signal.aborted) throw new DOMException("Aborted", "AbortError");
      const full = await (deps.runText
        ? deps.runText({
            signal: slot.abort.signal,
            onDelta: (piece) => emit(slot, { type: "delta", text: piece, task, readerId: readerForEvents }),
            onStatus: (message) => emit(slot, { type: "status", message }),
            onWait: () => emit(slot, { type: "comment" }),
          })
        : produceText({
            signal: slot.abort.signal,
            built,
            plan,
            active,
            locale,
            onDelta: (piece) => emit(slot, { type: "delta", text: piece, task, readerId: readerForEvents }),
            onStatus: (message) => emit(slot, { type: "status", message }),
            onWait: () => emit(slot, { type: "comment" }),
            onModel: (detail) => {
              modelDetail = detail;
            },
          }));
      if (slot.abort.signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (!full.trim()) throw new Error("没有生成出正文。原稿保持不变。");
      const unfinished = unfinishedProseMessage(task, step, full, overlay.wordMin);
      if (unfinished) throw new Error(unfinished);
      const saved = await updateProject(ownerId, projectId, (current) => {
        if (task === "review" && reader) {
          applyReview(current, { reader, step, text: full, via: route, viaDetail: modelDetail || undefined });
        } else if (task === "amend-review" && reader) {
          const amended = amendReviewOpinion(current, {
            readerId: reader.id,
            step,
            text: full,
            discussion: feedback,
            via: route,
            viaDetail: modelDetail || undefined,
          });
          if (!amended.ok) throw new Error(amended.error);
        } else {
          commitOutput(current, task, step, feedbackSource, built.loggedFeedback ?? feedback, full, route, built.logNote, modelDetail || undefined);
        }
        if (current.pendingJob?.requestId === slot.requestId) current.pendingJob = null;
      });
      if (!saved) throw new Error("稿子已经不在了。");
      if (route === "dsh") emit(slot, { type: "delta", text: full, task, readerId: readerForEvents });
      emit(slot, {
        type: "done",
        text: full,
        task,
        readerId: readerForEvents,
        revision: saved.revision,
        project: saved,
        demoMode: route === "demo",
        textRoute: route,
      });
    } catch (error) {
      const message = failureMessage(error, slot);
      try {
        await updateProject(ownerId, projectId, (current) => {
          if (current.pendingJob && current.pendingJob.requestId !== slot.requestId) return;
          appendLog(current, {
            step,
            type: failureType(message, slot),
            summary: message,
            detail: "",
            versionId: null,
          });
          if (current.pendingJob?.requestId === slot.requestId) current.pendingJob = null;
        });
      } catch {
        // 页面仍要看到这句错误。稿子若已不在，清不掉进行中状态。
      }
      emit(slot, { type: "error", message });
    } finally {
      if (slot.timer) clearTimeout(slot.timer);
      slot.timer = null;
      slot.settled = true;
      if (jobs.get(slot.key) === slot) jobs.delete(slot.key);
      slot.resolveDone();
    }
  };

  const encoder = new TextEncoder();
  let unsubscribe: () => void = () => undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        request.signal.removeEventListener("abort", close);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // 已关闭。
        }
      };
      const send = (event: HostedEvent) => {
        if (event.type === "comment") {
          try {
            controller.enqueue(encoder.encode(`: dsh\n\n`));
          } catch {
            // 客户端已断开。
          }
          return;
        }
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // 客户端已断开。
        }
      };
      unsubscribe = subscribe(slot, (event) => {
        send(event);
        if (event.type === "done" || event.type === "error") close();
      });
      // 请求断开只结束这次推送。后台任务继续写稿。
      if (request.signal.aborted) {
        close();
        return;
      }
      request.signal.addEventListener("abort", close, { once: true });
    },
    cancel() {
      unsubscribe();
    },
  });

  void run();

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

export async function cancelHostedGeneration(
  ownerId: string,
  projectId: string,
): Promise<{ ok: true; project: Project } | { ok: false; error: string; status: number }> {
  const existing = await getProject(ownerId, projectId);
  if (!existing) return { ok: false, error: "没有这份稿子。", status: 404 };
  const slot = jobs.get(jobKey(ownerId, projectId));
  if (!slot && !existing.pendingJob) return { ok: false, error: "没有正在跑的任务。", status: 400 };
  if (slot && !slot.settled) {
    slot.stopReason = slot.stopReason ?? "cancel";
    slot.abort.abort();
    await slot.done;
    const project = await getProject(ownerId, projectId);
    return { ok: true, project: project ?? existing };
  }
  const cleared = await updateProject(ownerId, projectId, (current) => {
    if (!current.pendingJob) return;
    appendLog(current, {
      step: current.pendingJob.step,
      type: "cancel",
      summary: CANCEL_JOB_MESSAGE,
      detail: "这一轮在服务器上已经没有对应的进程，只清掉了页面上的进行中状态。",
      versionId: null,
    });
    current.pendingJob = null;
  });
  if (!cleared) return { ok: false, error: "没有这份稿子。", status: 404 };
  return { ok: true, project: cleared };
}

/** 进程已经不在跑、但稿上还留着过期 pendingJob 时清掉，并写一条超时记录。活着的任务不动。 */
export async function sweepExpiredPendingJob(
  ownerId: string,
  projectId: string,
  opts?: { now?: number; timeoutMs?: number },
): Promise<Project | null> {
  const key = jobKey(ownerId, projectId);
  if (jobs.has(key)) return null;
  const now = opts?.now ?? Date.now();
  const timeoutMs = timeoutOf(opts?.timeoutMs);
  const current = await getProject(ownerId, projectId);
  if (!current?.pendingJob || !pendingJobExpired(current.pendingJob, now, timeoutMs)) return null;
  const requestId = current.pendingJob.requestId;
  try {
    return await updateProject(ownerId, projectId, (project) => {
      if (jobs.has(key)) throw new WriteSkipped("unchanged");
      const job = project.pendingJob;
      if (!job || job.requestId !== requestId || !pendingJobExpired(job, now, timeoutMs)) throw new WriteSkipped("unchanged");
      appendLog(project, {
        step: job.step,
        type: "timeout",
        summary: hostedTimeoutMessage(timeoutMs),
        detail: "超过时限，已停下。",
        versionId: null,
      });
      project.pendingJob = null;
    });
  } catch (error) {
    if (error instanceof WriteSkipped) return null;
    throw error;
  }
}
