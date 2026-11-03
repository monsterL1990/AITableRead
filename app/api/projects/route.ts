import { errorJson, isResponse, readJson, requireUser } from "@/lib/api";
import { isStartFrom, lengthError, parseWordTarget, toSummary } from "@/lib/pipeline";
import { createProject, listProjects } from "@/lib/store";
import type { StartFrom } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  try {
    const projects = await listProjects(user.uid);
    return Response.json({ projects: projects.map(toSummary) });
  } catch {
    return errorJson("稿库读不出来，请检查 data/store.json。", 500);
  }
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const record = (body ?? {}) as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const startFrom: StartFrom = isStartFrom(record.startFrom) ? record.startFrom : "idea";
  const idea = typeof record.idea === "string" ? record.idea : "";
  const outline = typeof record.outline === "string" ? record.outline : "";
  const manuscript = typeof record.manuscript === "string" ? record.manuscript : "";
  if (!title) return errorJson("标题不能为空。", 400);
  const titleError = lengthError("title", title);
  if (titleError) return errorJson(titleError, 400);
  const ideaError = lengthError("idea", idea);
  if (ideaError) return errorJson(ideaError, 400);
  const outlineError = lengthError("outline", outline);
  if (outlineError) return errorJson(outlineError, 400);
  const manuscriptError = lengthError("draft", manuscript);
  if (manuscriptError) return errorJson(manuscriptError, 400);
  if (startFrom === "outline" && !outline.trim()) return errorJson("从大纲开稿时，大纲不能为空。", 400);
  if (startFrom === "manuscript" && !manuscript.trim()) return errorJson("从完整稿件开稿时，稿件不能为空。", 400);
  const wordMin = parseWordTarget(record.wordMin);
  const wordMax = parseWordTarget(record.wordMax);
  if (wordMin === undefined || wordMax === undefined) return errorJson("目标字数不对。", 400);
  if (wordMin && wordMax && wordMin > wordMax) return errorJson("目标字数的下限不能大于上限。", 400);
  try {
    const project = await createProject(user.uid, {
      title,
      startFrom,
      idea,
      outline,
      manuscript,
      wordMin: wordMin === undefined ? undefined : wordMin,
      wordMax: wordMax === undefined ? undefined : wordMax,
    });
    return Response.json({ project }, { status: 201 });
  } catch {
    return errorJson("稿子没能建起来。", 500);
  }
}
