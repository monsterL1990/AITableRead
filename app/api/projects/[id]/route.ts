import { errorJson, isResponse, readJson, requireUser } from "@/lib/api";
import { sweepExpiredPendingJob } from "@/lib/hosted-generation";
import {
  applyConfirm,
  applyReviewAmendment,
  applyReviewTriage,
  applyRollback,
  applySnapshot,
  isStepId,
  lengthError,
  parseWordTarget,
  reviewTriageOf,
} from "@/lib/pipeline";
import { deleteProject, getProject, updateProject } from "@/lib/store";
import type { GenerateSnapshot, ReviewTriage } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

function snapshotFromBody(body: Record<string, unknown>): GenerateSnapshot | Response {
  const snapshot: GenerateSnapshot = {};
  for (const key of ["idea", "outline", "draft", "polished"] as const) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== "string") return errorJson("正文栏必须是文本。", 400);
    const issue = lengthError(key, body[key]);
    if (issue) return errorJson(issue, 400);
    snapshot[key] = body[key];
  }
  if (body.wordMin !== undefined) {
    const wordMin = parseWordTarget(body.wordMin);
    if (wordMin === undefined) return errorJson("目标字数不对。", 400);
    snapshot.wordMin = wordMin;
  }
  if (body.wordMax !== undefined) {
    const wordMax = parseWordTarget(body.wordMax);
    if (wordMax === undefined) return errorJson("目标字数不对。", 400);
    snapshot.wordMax = wordMax;
  }
  return snapshot;
}

function readReviewTriage(value: unknown): { id: string; triage: ReviewTriage } | null | Response {
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return errorJson("读者意见不对。", 400);
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || !raw.id.trim()) return errorJson("读者意见不对。", 400);
  const triage = reviewTriageOf(raw.triage);
  if (raw.triage !== triage) return errorJson("采纳状态不对。", 400);
  return { id: raw.id, triage };
}

function readReviewAmendment(value: unknown): { id: string; text: string; discussion: string } | null | Response {
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return errorJson("读者意见不对。", 400);
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || !raw.id.trim()) return errorJson("读者意见不对。", 400);
  if (typeof raw.text !== "string" || typeof raw.discussion !== "string") return errorJson("读者意见必须是文本。", 400);
  return { id: raw.id, text: raw.text, discussion: raw.discussion };
}

export async function GET(_request: Request, context: Params) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await context.params;
  try {
    const project = await getProject(user.uid, id);
    if (!project) return errorJson("没有这份稿子。", 404);
    const swept = await sweepExpiredPendingJob(user.uid, id);
    return Response.json({ project: swept ?? project });
  } catch {
    return errorJson("稿库读不出来，请检查 data/store.json。", 500);
  }
}

export async function PATCH(request: Request, context: Params) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await context.params;
  const body = await readJson(request);
  if (body instanceof Response) return body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return errorJson("请求格式不对。", 400);
  const record = body as Record<string, unknown>;
  const snapshot = snapshotFromBody(record);
  if (snapshot instanceof Response) return snapshot;
  let title: string | undefined;
  if (record.title !== undefined) {
    if (typeof record.title !== "string") return errorJson("标题必须是文本。", 400);
    title = record.title.trim();
    if (!title) return errorJson("标题不能为空。", 400);
    const issue = lengthError("title", title);
    if (issue) return errorJson(issue, 400);
  }
  const confirmStep = record.confirmStep;
  const rollbackVersionId = record.rollbackVersionId;
  if (confirmStep !== undefined && !isStepId(confirmStep)) return errorJson("步骤不对。", 400);
  if (rollbackVersionId !== undefined && typeof rollbackVersionId !== "string") return errorJson("版本不对。", 400);
  const reviewTriage = readReviewTriage(record.reviewTriage);
  if (reviewTriage instanceof Response) return reviewTriage;
  const reviewAmendment = readReviewAmendment(record.reviewAmendment);
  if (reviewAmendment instanceof Response) return reviewAmendment;

  let gateError: string | null = null;
  try {
    const project = await updateProject(user.uid, id, (current) => {
      if (title) current.title = title;
      applySnapshot(current, snapshot);
      if (reviewAmendment) {
        const result = applyReviewAmendment(current, {
          reviewId: reviewAmendment.id,
          text: reviewAmendment.text,
          discussion: reviewAmendment.discussion,
        });
        if (!result.ok) gateError = result.error;
      }
      if (reviewTriage && !gateError) {
        const result = applyReviewTriage(current, reviewTriage.id, reviewTriage.triage);
        if (!result.ok) gateError = result.error;
      }
      if (typeof rollbackVersionId === "string" && !gateError) {
        const result = applyRollback(current, rollbackVersionId);
        if (!result.ok) gateError = result.error;
      }
      if (isStepId(confirmStep) && !gateError) {
        const result = applyConfirm(current, confirmStep);
        if (!result.ok) gateError = result.error;
      }
    });
    if (!project) return errorJson("没有这份稿子。", 404);
    if (gateError) return errorJson(gateError, 400, { project });
    return Response.json({ project });
  } catch {
    return errorJson("稿子没能保存。", 500);
  }
}

export async function DELETE(_request: Request, context: Params) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await context.params;
  try {
    const removed = await deleteProject(user.uid, id);
    if (!removed) return errorJson("没有这份稿子。", 404);
    return Response.json({ ok: true });
  } catch {
    return errorJson("稿子没能删除。", 500);
  }
}
