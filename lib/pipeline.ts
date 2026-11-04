import { archivePath, countChars, routeMark } from "./format";
import type { Locale } from "./i18n/locale";
import { DEFAULT_READER_PROMPTS, DEFAULT_READER_PROMPTS_EN } from "./prompts";
import type {
  FeedbackSource,
  GenerateSnapshot,
  LogEntry,
  Project,
  ProjectSummary,
  QualityReport,
  ReaderProfile,
  ReviewNote,
  ReviewTriage,
  StartFrom,
  StepId,
  TextRoute,
  TextVersion,
  VersionKind,
  VersionSource,
} from "./types";
import { LIMITS } from "./types";

export const STEPS: {
  id: StepId;
  title: string;
  short: string;
  hint: string;
  result: string;
}[] = [
  {
    id: 1,
    title: "想法 → 大纲",
    short: "大纲",
    result: "大纲",
    hint: "把想法收成可写的大纲。生成之后可以自己提意见，也可以请读者看大纲。确认之前不能写初稿。",
  },
  {
    id: 2,
    title: "大纲 → 初稿",
    short: "初稿",
    result: "初稿",
    hint: "按大纲写一节正文，字数落到目标区间。读者可以请，不必齐。确认之前不能润色。",
  },
  {
    id: 3,
    title: "稿件 → 润色",
    short: "润色",
    result: "润色稿",
    hint: "对照大纲把这一节润开。从完整稿件进来时，稿件就是这里的输入。确认本步即这版定稿。",
  },
];

const KIND_LABEL: Record<VersionKind, string> = {
  outline: "大纲",
  draft: "初稿",
  polish: "润色",
};

const READER_PRESETS: Record<Locale, { name: string; blurb: string; prompt: string }[]> = {
  zh: [
    {
      name: "R18读者",
      blurb: "主流男性向成人小说读者。看评分、追读意愿、爽点和弃文点。",
      prompt: DEFAULT_READER_PROMPTS.r18,
    },
    {
      name: "怪物Z",
      blurb: "只代表个人口味。看喜不喜欢、戳中点和出戏点。",
      prompt: DEFAULT_READER_PROMPTS.monster,
    },
    {
      name: "中年男",
      blurb: "看人话、前后矛盾，以及哪些句子可留、哪些别动。",
      prompt: DEFAULT_READER_PROMPTS.middle,
    },
  ],
  en: [
    {
      name: "R18 reader",
      blurb: "A mainstream reader of male-oriented adult fiction. Looks at the score, whether he'd keep reading, what works, and what would make him quit.",
      prompt: DEFAULT_READER_PROMPTS_EN.r18,
    },
    {
      name: "Monster Z",
      blurb: "Only a personal taste. Looks at whether he likes it, what lands, and what pulls him out of the story.",
      prompt: DEFAULT_READER_PROMPTS_EN.monster,
    },
    {
      name: "Middle-aged man",
      blurb: "Looks at whether people sound like people, contradictions, which lines to keep, and which to leave alone.",
      prompt: DEFAULT_READER_PROMPTS_EN.middle,
    },
  ],
};

const READER_IDS = ["r18", "monster", "middle"] as const;

/** New workspaces only. Stored readers are never rewritten to the other language. */
export function defaultReaders(locale: Locale = "zh"): ReaderProfile[] {
  return READER_PRESETS[locale].map((preset, index) => ({
    id: READER_IDS[index]!,
    name: preset.name,
    blurb: preset.blurb,
    prompt: preset.prompt,
    blocked: false,
    origin: "builtin" as const,
  }));
}

export function activeReaders(readers: ReaderProfile[]): ReaderProfile[] {
  return readers.filter((reader) => !reader.blocked && reader.name.trim() && reader.prompt.trim());
}

export function isStepId(value: unknown): value is StepId {
  return value === 1 || value === 2 || value === 3;
}

export function isStartFrom(value: unknown): value is StartFrom {
  return value === "idea" || value === "outline" || value === "manuscript";
}

export function isVersionKind(value: unknown): value is VersionKind {
  return value === "outline" || value === "draft" || value === "polish";
}

export function stepKind(step: StepId): VersionKind {
  if (step === 1) return "outline";
  if (step === 2) return "draft";
  return "polish";
}

export function textForStep(project: Project, step: StepId): string {
  const kind = stepKind(step);
  if (kind === "outline") return project.outline;
  if (kind === "draft") return project.draft;
  return project.polished;
}

export function canViewStep(project: Project, step: StepId): boolean {
  if (step === 1) return true;
  return project.confirmed[(step - 1) as StepId];
}

export function wordTargetLabel(project: Pick<Project, "wordMin" | "wordMax">): string {
  const min = project.wordMin;
  const max = project.wordMax;
  if (min && max) return `${min}–${max} 字`;
  if (min) return `至少 ${min} 字`;
  if (max) return `不超过 ${max} 字`;
  return "未设目标";
}

export function excerpt(text: string, max = 500): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return "（空）";
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max)}…`;
}

export function appendLog(
  project: Project,
  entry: Omit<LogEntry, "id" | "at"> & { at?: string },
): LogEntry {
  const item: LogEntry = {
    id: crypto.randomUUID(),
    at: entry.at ?? new Date().toISOString(),
    step: entry.step,
    type: entry.type,
    summary: entry.summary,
    detail: entry.detail,
    versionId: entry.versionId,
  };
  project.log.push(item);
  return item;
}

export function pushVersion(
  project: Project,
  kind: VersionKind,
  text: string,
  source: VersionSource,
  note: string,
  now = new Date().toISOString(),
): TextVersion {
  const prior = project.versions.filter((version) => version.kind === kind).length;
  const base = KIND_LABEL[kind];
  const version: TextVersion = {
    id: crypto.randomUUID(),
    kind,
    label: prior === 0 ? base : `${base}修改${prior}`,
    text,
    source,
    note,
    createdAt: now,
  };
  project.versions.push(version);
  project.currentVersion[kind] = version.id;
  if (kind === "outline") project.outline = text;
  else if (kind === "draft") project.draft = text;
  else project.polished = text;
  return version;
}

export function versionsOf(project: Project, kind: VersionKind): TextVersion[] {
  return project.versions.filter((version) => version.kind === kind);
}

function currentVersion(project: Project, kind: VersionKind): TextVersion | undefined {
  const id = project.currentVersion[kind];
  return project.versions.find((version) => version.id === id);
}

export function ensureVersion(project: Project, kind: VersionKind, note: string): TextVersion | null {
  const text = kind === "outline" ? project.outline : kind === "draft" ? project.draft : project.polished;
  if (!text.trim()) return null;
  const current = currentVersion(project, kind);
  if (current && current.text === text) return current;
  return pushVersion(project, kind, text, "manual", note);
}

export function reviewsForStep(project: Project, step: StepId): ReviewNote[] {
  const latest = new Map<string, ReviewNote>();
  for (const note of project.reviews) {
    if (note.step !== step) continue;
    latest.set(note.readerId, note);
  }
  return [...latest.values()];
}

export function applyConfirm(project: Project, step: StepId): { ok: true } | { ok: false; error: string } {
  if (!canViewStep(project, step)) return { ok: false, error: "前面一步还没确认。" };
  if (step > project.currentStep) return { ok: false, error: "不能跳过还没确认的步骤。" };
  const text = textForStep(project, step).trim();
  if (!text) return { ok: false, error: `${STEPS.find((item) => item.id === step)?.result ?? "这一步"}还是空的。` };
  const version = ensureVersion(project, stepKind(step), "确认前收下的手改");
  const now = new Date().toISOString();
  project.confirmed[step] = true;
  project.confirmedAt[step] = now;
  if (step === project.currentStep && step < 3) project.currentStep = (step + 1) as StepId;
  appendLog(project, {
    at: now,
    step,
    type: "confirm",
    summary: `确认${STEPS.find((item) => item.id === step)?.short ?? ""}。当前停在第 ${project.currentStep} 步。`,
    detail: version ? `版本 ${version.label}（${version.id}）` : "",
    versionId: version?.id ?? null,
  });
  return { ok: true };
}

export function applyRollback(project: Project, versionId: string): { ok: true; version: TextVersion } | { ok: false; error: string } {
  const version = project.versions.find((item) => item.id === versionId);
  if (!version) return { ok: false, error: "没有这个版本。" };
  project.currentVersion[version.kind] = version.id;
  if (version.kind === "outline") project.outline = version.text;
  else if (version.kind === "draft") project.draft = version.text;
  else project.polished = version.text;
  const step = version.kind === "outline" ? 1 : version.kind === "draft" ? 2 : 3;
  appendLog(project, {
    step,
    type: "rollback",
    summary: `回滚到${version.label}。`,
    detail: excerpt(version.text, 800),
    versionId: version.id,
  });
  return { ok: true, version };
}

export function applyReview(
  project: Project,
  input: { reader: ReaderProfile; step: StepId; text: string; via?: TextRoute; viaDetail?: string },
): ReviewNote {
  const version = ensureVersion(project, stepKind(input.step), "送审前的手改");
  const note: ReviewNote = {
    id: crypto.randomUUID(),
    readerId: input.reader.id,
    readerName: input.reader.name,
    step: input.step,
    versionId: version?.id ?? "",
    text: input.text,
    createdAt: new Date().toISOString(),
    triage: "unset",
    discussion: "",
  };
  project.reviews.push(note);
  appendLog(project, {
    at: note.createdAt,
    step: input.step,
    type: "review",
    summary: `${input.reader.name}看完第 ${input.step} 步。${viaSuffix(input.via, input.viaDetail)}`,
    detail: input.text,
    versionId: note.versionId || null,
  });
  return note;
}

export const READER_REVISE_NONE = "还没有读者意见。可以只按你自己的意见改，或先请一位读者看。";
export const READER_REVISE_NEED_ADOPTION = "请先采纳至少一条读者意见。";

export function reviewTriageOf(value: unknown): ReviewTriage {
  return value === "adopted" || value === "ignored" || value === "unset" ? value : "unset";
}

export type ReaderReviseSelection = {
  adopted: ReviewNote[];
  ignored: ReviewNote[];
  unset: ReviewNote[];
  text: string;
};

/** 讨论增订和意见正文一起送去改稿，避免讨论停在对话框里。 */
export function opinionForRevise(note: ReviewNote): string {
  const text = note.text.trim();
  const discussion = note.discussion.trim();
  if (!discussion) return text;
  if (!text) return `讨论增订：\n${discussion}`;
  return `${text}\n\n讨论增订：\n${discussion}`;
}

function currentReview(project: Project, reviewId: string): { ok: true; note: ReviewNote } | { ok: false; error: string } {
  const note = project.reviews.find((item) => item.id === reviewId);
  if (!note) return { ok: false, error: "没有这条读者意见。" };
  const latest = reviewsForStep(project, note.step).find((item) => item.readerId === note.readerId);
  if (!latest || latest.id !== note.id) return { ok: false, error: "这是更早的一条意见。请对当前这条处理。" };
  return { ok: true, note };
}

export function applyReviewTriage(
  project: Project,
  reviewId: string,
  triage: ReviewTriage,
): { ok: true; note: ReviewNote } | { ok: false; error: string } {
  const found = currentReview(project, reviewId);
  if (!found.ok) return found;
  if (!found.note.text.trim()) return { ok: false, error: "这条意见是空的。" };
  found.note.triage = triage;
  return found;
}

export function applyReviewAmendment(
  project: Project,
  input: { reviewId: string; text: string; discussion: string },
): { ok: true; note: ReviewNote } | { ok: false; error: string } {
  const found = currentReview(project, input.reviewId);
  if (!found.ok) return found;
  const text = input.text.trim();
  if (!text) return { ok: false, error: "意见不能改成空的。" };
  const textIssue = lengthError("review", text);
  if (textIssue) return { ok: false, error: textIssue };
  const discussion = input.discussion.trim();
  const talkIssue = lengthError("feedback", discussion);
  if (talkIssue) return { ok: false, error: talkIssue };
  const note = found.note;
  const textChanged = note.text.trim() !== text;
  const talkChanged = note.discussion.trim() !== discussion;
  if (!textChanged && !talkChanged) return { ok: true, note };
  note.text = text;
  note.discussion = discussion;
  if (textChanged) note.triage = "unset";
  appendLog(project, {
    step: note.step,
    type: "review-discuss",
    summary: textChanged
      ? `改了${note.readerName}的意见，采纳状态回到未定。`
      : `记下对${note.readerName}这条意见的讨论。`,
    detail: `意见：\n${text}\n\n讨论：\n${discussion || "（无）"}`,
    versionId: note.versionId || null,
  });
  return { ok: true, note };
}

/** 同一条意见被讨论改写。不新开一条，这样界面还停在这位读者的当前意见上；采纳状态回到未定。 */
export function amendReviewOpinion(
  project: Project,
  input: { readerId: string; step: StepId; text: string; discussion: string; via?: TextRoute; viaDetail?: string },
): { ok: true; note: ReviewNote } | { ok: false; error: string } {
  const note = reviewsForStep(project, input.step).find((item) => item.readerId === input.readerId);
  if (!note?.text.trim()) return { ok: false, error: "还没有这条读者意见，无从讨论。" };
  const text = input.text.trim();
  if (!text) return { ok: false, error: "没有改出新的意见。" };
  const issue = lengthError("review", text);
  if (issue) return { ok: false, error: issue };
  note.text = text;
  note.discussion = "";
  note.triage = "unset";
  appendLog(project, {
    step: input.step,
    type: "review-discuss",
    summary: `按讨论改了${note.readerName}的意见。请再决定是否采纳。${viaSuffix(input.via, input.viaDetail)}`,
    detail: `讨论：\n${input.discussion.trim() || "（无）"}\n\n改后意见：\n${text}`,
    versionId: note.versionId || null,
  });
  return { ok: true, note };
}

function visibleStepNotes(project: Project, step: StepId, readers?: ReaderProfile[]): ReviewNote[] {
  const allowed = readers ? new Set(readers.filter((reader) => !reader.blocked).map((reader) => reader.id)) : null;
  return reviewsForStep(project, step).filter(
    (note) => note.text.trim() && (allowed === null || allowed.has(note.readerId)),
  );
}

/** 只有明确采纳的当前意见会进入改稿。未定和忽略都不算。 */
export function readerReviseSelection(project: Project, step: StepId, readers?: ReaderProfile[]): ReaderReviseSelection {
  const notes = visibleStepNotes(project, step, readers);
  const adopted = notes.filter((note) => reviewTriageOf(note.triage) === "adopted");
  const ignored = notes.filter((note) => reviewTriageOf(note.triage) === "ignored");
  const unset = notes.filter((note) => reviewTriageOf(note.triage) === "unset");
  return {
    adopted,
    ignored,
    unset,
    text: adopted.map((note) => `## ${note.readerName}\n${opinionForRevise(note)}`).join("\n\n"),
  };
}

export function readerReviseLogNote(selection: ReaderReviseSelection): string {
  const list = (items: ReviewNote[]) => (items.length ? items.map((note) => note.readerName).join("、") : "无");
  return `采纳：${list(selection.adopted)}。已忽略、未送进改稿：${list(selection.ignored)}。未定、未送进改稿：${list(selection.unset)}。`;
}

export function applyQualityReport(project: Project, step: StepId, text: string, via?: TextRoute, viaDetail?: string): QualityReport {
  const version = ensureVersion(project, stepKind(step), "质检前的手改");
  const report: QualityReport = {
    step,
    versionId: version?.id ?? "",
    text,
    createdAt: new Date().toISOString(),
  };
  project.qualityReport = report;
  appendLog(project, {
    at: report.createdAt,
    step,
    type: "quality-check",
    summary: `结构质检第 ${step} 步。${viaSuffix(via, viaDetail)}`,
    detail: text,
    versionId: report.versionId || null,
  });
  return report;
}

/**
 * 质检清单只能改它对照过的那一版正文。
 * 对得上时返回 null，调用方可以按清单改。
 * 对不上时返回给页面和接口共用的一句说明。
 */
export function qualityReviseBlock(project: Project, step: StepId): string | null {
  const report = project.qualityReport;
  if (!report || report.step !== step || !report.text.trim()) return "还没有质检清单。";
  const version = project.versions.find((item) => item.id === report.versionId);
  const current = textForStep(project, step);
  if (version && version.kind === stepKind(step) && version.text === current) return null;
  if (version && version.kind === stepKind(step)) {
    const thenCount = countChars(version.text);
    const nowCount = countChars(current);
    if (thenCount !== nowCount) {
      return `质检清单对着的是更早的正文（${thenCount} 字），现在是 ${nowCount} 字。请再跑一次结构质检。`;
    }
    return `质检清单对着的是更早的正文（${thenCount} 字）。正文已经改过，请再跑一次结构质检。`;
  }
  return "这份质检清单对不上当前正文。请再跑一次结构质检。";
}

function viaSuffix(via: TextRoute | undefined, detail?: string): string {
  if (!via) return "";
  const extra = detail?.trim();
  return extra ? `（${routeMark(via)} · ${extra}）` : `（${routeMark(via)}）`;
}

export function feedbackBundle(project: Project, step: StepId, source: FeedbackSource, userFeedback: string): string {
  if (source === "user") return userFeedback.trim();
  if (source === "quality") {
    if (qualityReviseBlock(project, step)) return "";
    return project.qualityReport?.text.trim() ?? "";
  }
  return readerNotesForStep(project, step);
}

/** 当前步骤里已采纳的意见。未定、忽略、空正文和屏蔽读者都不在里面。 */
export function readerNotesForStep(project: Project, step: StepId, readers?: ReaderProfile[]): string {
  return readerReviseSelection(project, step, readers).text;
}

export function applySnapshot(project: Project, snapshot: GenerateSnapshot | undefined) {
  if (!snapshot) return;
  if (typeof snapshot.idea === "string") project.idea = snapshot.idea;
  if (typeof snapshot.outline === "string") project.outline = snapshot.outline;
  if (typeof snapshot.draft === "string") project.draft = snapshot.draft;
  if (typeof snapshot.polished === "string") project.polished = snapshot.polished;
  if (snapshot.wordMin === null || typeof snapshot.wordMin === "number") project.wordMin = snapshot.wordMin ?? null;
  if (snapshot.wordMax === null || typeof snapshot.wordMax === "number") project.wordMax = snapshot.wordMax ?? null;
}

const LENGTH_LABEL: Record<string, { max: number; name: string }> = {
  title: { max: LIMITS.title, name: "标题" },
  idea: { max: LIMITS.idea, name: "想法" },
  outline: { max: LIMITS.outline, name: "大纲" },
  draft: { max: LIMITS.draft, name: "初稿" },
  polished: { max: LIMITS.polished, name: "润色稿" },
  feedback: { max: LIMITS.feedback, name: "修改意见" },
  prompt: { max: LIMITS.prompt, name: "提示词" },
  review: { max: LIMITS.review, name: "读者意见" },
};

export function lengthError(field: keyof typeof LENGTH_LABEL, value: string): string | null {
  const rule = LENGTH_LABEL[field];
  if (!rule) return null;
  if (value.length > rule.max) return `${rule.name}太长，请收到 ${rule.max} 字以内。`;
  return null;
}

export function parseWordTarget(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  if (rounded < 0 || rounded > 200_000) return undefined;
  return rounded === 0 ? null : rounded;
}

export function toSummary(project: Project): ProjectSummary {
  return {
    id: project.id,
    title: project.title,
    currentStep: project.currentStep,
    polishConfirmed: project.confirmed[3],
    startFrom: project.startFrom,
    updatedAt: project.updatedAt,
    createdAt: project.createdAt,
    archivePath: archivePath(project.ownerId, project.id),
  };
}

function blankConfirmed(): Project["confirmed"] {
  return { 1: false, 2: false, 3: false };
}

function blankConfirmedAt(): Project["confirmedAt"] {
  return { 1: null, 2: null, 3: null };
}

export function createProjectRecord(input: {
  id: string;
  ownerId: string;
  title: string;
  startFrom?: StartFrom;
  idea?: string;
  outline?: string;
  manuscript?: string;
  wordMin?: number | null;
  wordMax?: number | null;
  now?: string;
}): Project {
  const now = input.now ?? new Date().toISOString();
  const startFrom = input.startFrom ?? "idea";
  const project: Project = {
    id: input.id,
    ownerId: input.ownerId,
    title: input.title.trim(),
    startFrom,
    idea: input.idea ?? "",
    outline: input.outline ?? "",
    draft: "",
    polished: "",
    wordMin: input.wordMin === undefined ? 2000 : input.wordMin,
    wordMax: input.wordMax === undefined ? 3500 : input.wordMax,
    versions: [],
    currentVersion: {},
    reviews: [],
    qualityReport: null,
    confirmed: blankConfirmed(),
    confirmedAt: blankConfirmedAt(),
    currentStep: 1,
    log: [],
    pendingJob: null,
    createdAt: now,
    updatedAt: now,
    revision: 1,
  };
  if (startFrom === "outline" && project.outline.trim()) {
    pushVersion(project, "outline", project.outline, "import", "开稿时放入的大纲", now);
  }
  if (startFrom === "manuscript") {
    const manuscript = (input.manuscript ?? "").trim();
    if (manuscript) {
      pushVersion(project, "draft", manuscript, "import", "开稿时放入的完整稿件", now);
      pushVersion(project, "polish", manuscript, "import", "润色步骤的起始稿", now);
    }
    project.confirmed[1] = true;
    project.confirmed[2] = true;
    project.confirmedAt[1] = now;
    project.confirmedAt[2] = now;
    project.currentStep = 3;
  }
  appendLog(project, {
    at: now,
    step: project.currentStep,
    type: "create",
    summary:
      startFrom === "manuscript"
        ? "从完整稿件开稿。步骤 1、2 记为已确认，稿件进入润色。"
        : startFrom === "outline"
          ? "从大纲开稿。确认大纲后才能写初稿。"
          : "从想法开稿。",
    detail: excerpt(startFrom === "manuscript" ? project.polished : startFrom === "outline" ? project.outline : project.idea),
    versionId: project.currentVersion.polish ?? project.currentVersion.outline ?? null,
  });
  return project;
}
