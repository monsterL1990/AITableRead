import type { FeedbackSource, GenerateTask, LogEntry, PendingJob, StepId } from "./types";

export const BUSY_JOB_MESSAGE = "已有任务在跑。";
export const CANCEL_JOB_MESSAGE = "已取消。原稿保持不变。";
export const DISCONNECT_NOTE = "连接断了，出字仍在服务器上继续。";

const PHRASE: Record<string, string> = {
  generate: "正在写…",
  user: "正在按意见改…",
  "readers-revise": "正在按读者意见改…",
  "quality-revise": "正在按质检改…",
  quality: "正在对照大纲…",
  readers: "正在请读者看…",
  discuss: "正在按讨论改这条意见…",
};

export function pendingJobLabel(input: {
  task: GenerateTask;
  feedbackSource?: FeedbackSource;
  readerId?: string;
  reviewId?: string;
}): string {
  if (input.task === "revise-from-feedback") {
    if (input.feedbackSource === "readers") return "readers-revise";
    if (input.feedbackSource === "quality") return "quality-revise";
    return "user";
  }
  if (input.task === "quality-check") return "quality";
  if (input.task === "review") return input.readerId || "readers";
  if (input.task === "amend-review") return input.reviewId ? `discuss:${input.reviewId}` : "discuss";
  return "generate";
}

export function pendingJobPhrase(
  job: Pick<PendingJob, "label" | "readerId">,
  readers: { id: string; name: string }[] = [],
): string {
  if (job.label.startsWith("discuss:")) return "正在按讨论改这条意见…";
  const known = PHRASE[job.label];
  if (known) return known;
  const reader = readers.find((item) => item.id === job.label || item.id === job.readerId);
  if (reader?.name.trim()) return `正在请${reader.name.trim()}看…`;
  return "正在出字…";
}

/** 「正在按质检改…（已进行 3 分）」。不足一分钟写「不到 1 分」。 */
export function pendingJobProgress(
  job: PendingJob,
  now = Date.now(),
  readers: { id: string; name: string }[] = [],
): string {
  const started = Date.parse(job.startedAt);
  const elapsedMs = Number.isFinite(started) ? Math.max(0, now - started) : 0;
  const minutes = Math.floor(elapsedMs / 60_000);
  const elapsed = minutes < 1 ? "不到 1 分" : `${minutes} 分`;
  const joiner = minutes < 1 ? "" : " ";
  return `${pendingJobPhrase(job, readers)}（已进行${joiner}${elapsed}）`;
}

export function hostedTimeoutMessage(timeoutMs: number): string {
  const minutes = Math.max(1, Math.round(timeoutMs / 60_000));
  return `出字超时了（已等约 ${minutes} 分钟），时限内没有写完。原稿保持不变。`;
}

export function pendingJobExpired(job: PendingJob, now: number, timeoutMs: number): boolean {
  const started = Date.parse(job.startedAt);
  if (!Number.isFinite(started)) return true;
  return now - started >= timeoutMs;
}

/** 进行中状态消失后，看 startedAt 之后的最后一条是不是取消、超时或失败。 */
export function pendingJobFailure(log: LogEntry[], startedAt: string): string | null {
  const start = Date.parse(startedAt);
  for (let index = log.length - 1; index >= 0; index -= 1) {
    const entry = log[index];
    if (!entry) continue;
    const at = Date.parse(entry.at);
    if (Number.isFinite(start) && Number.isFinite(at) && at < start - 1500) return null;
    if (entry.type === "cancel" || entry.type === "timeout" || entry.type === "error") return entry.summary;
    return null;
  }
  return null;
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

function isStep(value: unknown): value is StepId {
  return value === 1 || value === 2 || value === 3;
}

function isSource(value: unknown): value is FeedbackSource {
  return value === "user" || value === "readers" || value === "quality";
}

export function parsePendingJob(value: unknown): PendingJob | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!isTask(raw.task) || !isStep(raw.step) || typeof raw.startedAt !== "string" || !raw.startedAt.trim()) return null;
  const feedbackSource = isSource(raw.feedbackSource) ? raw.feedbackSource : undefined;
  const readerId = typeof raw.readerId === "string" && raw.readerId.trim() ? raw.readerId.trim().slice(0, 80) : undefined;
  const requestId = typeof raw.requestId === "string" && raw.requestId.trim() ? raw.requestId.trim().slice(0, 80) : undefined;
  const label =
    typeof raw.label === "string" && raw.label.trim()
      ? raw.label.trim().slice(0, 80)
      : pendingJobLabel({ task: raw.task, feedbackSource, readerId });
  return {
    task: raw.task,
    step: raw.step,
    startedAt: raw.startedAt,
    label,
    ...(requestId ? { requestId } : {}),
    ...(feedbackSource ? { feedbackSource } : {}),
    ...(readerId ? { readerId } : {}),
  };
}
