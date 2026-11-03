import type { ReviewNote, ReviewTriage } from "./types";

/** 保存失败时接口常回这几句。审阅按钮上要换成「还没开始看」，不要只留这句。 */
const GENERIC_SAVE = new Set(["没能保存。", "稿子没能保存。", "保存失败"]);

export type ReaderActionFailure = {
  message: string;
  /** null 表示这次是「一起看」，每一张未屏蔽的卡片都算这次失败。 */
  readerId: string | null;
};

export function isTransportFailure(error: unknown): boolean {
  const message =
    typeof error === "string" ? error : error instanceof Error ? error.message : "";
  const text = message.toLowerCase();
  return (
    text.includes("failed to fetch") ||
    text.includes("networkerror") ||
    text.includes("network error") ||
    text.includes("load failed") ||
    text.includes("err_connection") ||
    text.includes("connection closed") ||
    text.includes("connection reset") ||
    text.includes("econnreset") ||
    text.includes("fetch failed") ||
    text.includes("terminated")
  );
}

export function reviewBlockedBySaveMessage(readerName: string | null, serverMessage?: string): string {
  const who = readerName ? `${readerName}还没开始看` : "读者还没开始看";
  const detail = serverMessage?.trim() ?? "";
  if (detail && !GENERIC_SAVE.has(detail) && !isTransportFailure(detail)) {
    return `稿子没保存，${who}。${detail}`;
  }
  return `稿子没保存，${who}。`;
}

export function reviewRequestFailedMessage(readerName: string | null, error: unknown): string {
  const who = readerName ? `${readerName}没看成` : "读者没看成";
  if (isTransportFailure(error)) return `${who}。连接断了，意见没有写上。`;
  const message = error instanceof Error ? error.message.trim() : typeof error === "string" ? error.trim() : "";
  if (!message || message === "生成失败。") return `${who}。请再试一次。`;
  if (message.startsWith(who)) return message;
  return `${who}。${message}`;
}

/** 失败的来回不能把已经写下的意见清掉。同一条以服务器为准，本地多出来的留在前面。 */
export function keepReviews(previous: ReviewNote[], next: ReviewNote[]): ReviewNote[] {
  if (previous.length === 0) return next;
  const nextIds = new Set(next.map((note) => note.id));
  const kept = previous.filter((note) => !nextIds.has(note.id));
  if (kept.length === 0) return next;
  return [...kept, ...next];
}

export function readerCardFailed(failure: ReaderActionFailure | null, readerId: string): boolean {
  return Boolean(failure && (failure.readerId === null || failure.readerId === readerId));
}

/** 有旧意见就留着；失败时不要改口说「还没有意见」。 */
export function readerCardBody(
  noteText: string | undefined,
  failureMessage: string | null,
): { opinion: string | null; error: string | null } {
  const opinion = noteText?.trim() ? noteText : null;
  if (!failureMessage) return { opinion, error: null };
  return { opinion, error: failureMessage };
}

export function reviewAllButtonLabel(generating: string, failed: boolean): string {
  if (generating === "readers") return "读者在看…";
  if (failed) return "再请一次";
  return "请未屏蔽的读者一起看";
}

export function reviewTriageLabel(triage: ReviewTriage | undefined): "已采纳" | "已忽略" | "未定" {
  if (triage === "adopted") return "已采纳";
  if (triage === "ignored") return "已忽略";
  return "未定";
}

export function reviewOneButtonLabel(active: boolean, hasNote: boolean, failed: boolean): string {
  if (active) return "在看…";
  if (failed) return "再请一次";
  if (hasNote) return "再看一次";
  return "请这位看";
}
