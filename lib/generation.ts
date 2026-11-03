import { countChars } from "./format";
import { demoText } from "./demo-text";
import {
  excerpt,
  lengthError,
  qualityReviseBlock,
  READER_REVISE_NEED_ADOPTION,
  READER_REVISE_NONE,
  readerReviseLogNote,
  readerReviseSelection,
  reviewsForStep,
  stepKind,
  textForStep,
  wordTargetLabel,
} from "./pipeline";
import { resolveSystem, withHardRule } from "./prompts";
import type {
  FeedbackSource,
  GenerateTask,
  Project,
  PromptKey,
  ReaderProfile,
  StepId,
} from "./types";

export type BuiltGeneration = {
  system: string;
  user: string;
  temperature: number;
  demo: string;
  /** 改稿时真正送进提示、并写进流程记录的意见。请求字段经常是空的。 */
  loggedFeedback?: string;
  /** 写进流程记录，不送进模型。读者改稿用来记下采纳了谁、跳过了谁。 */
  logNote?: string;
};

function targetBlock(project: Project): string {
  if (project.wordMin || project.wordMax) {
    return `目标字数（不计空白）：${wordTargetLabel(project)}。这是硬约束。偏短不合格，不要用概述句凑篇幅。`;
  }
  return "未设目标字数。正文仍须写满一节，大约 2000 到 3500 字（不计空白），不要交短稿。";
}

function proseOpening(project: Project): string {
  const wide = Math.max(project.wordMin ?? 0, project.wordMax ?? 0) >= 8000;
  const noAck = "只回这一份完整正文，不要另发「已替换」「已写入文件」或「同一份在…」。";
  if (wide) {
    return `直接写叙事正文，尽量往目标下限写满场面，不要总结。禁止只回计划、提纲，或「先按大纲…」「我将…」「写完核对…」这类说明。${noAck}`;
  }
  return `直接写叙事正文。禁止只回计划、提纲，或「先按大纲…」「我将…」这类说明。${noAck}`;
}

const PLAN_STUB = /先按大纲|写完核对|核对字数和节拍|不够就补场面|不补心情|写作计划|我将按|先列提纲|以下是步骤|先按大纲把/;
const TINY_PROSE_CHARS = 160;
const PLAN_STUB_CHARS = 600;

function writesManuscript(task: GenerateTask, step: StepId): boolean {
  if (task === "draft" || task === "polish") return true;
  return task === "revise-from-feedback" && step !== 1;
}

function manuscriptLabel(task: GenerateTask, step: StepId): string {
  if (task === "polish" || step === 3) return "润色稿";
  return "初稿";
}

/**
 * 一轮已经结束之后的保险：几十个字的计划句或明显不是叙事的短稿，不能当作正文收下。
 * 短于目标下限但已经是一节正文的，仍交给页面上的「还短于下限」，这里不拦。
 */
export function unfinishedProseMessage(
  task: GenerateTask,
  step: StepId,
  text: string,
  wordMin: number | null,
): string | null {
  if (!writesManuscript(task, step)) return null;
  const count = countChars(text);
  const plan = PLAN_STUB.test(text.replace(/\s/g, ""));
  const tiny = count < TINY_PROSE_CHARS;
  const planStub = plan && count < PLAN_STUB_CHARS;
  if (!tiny && !planStub) return null;
  const label = manuscriptLabel(task, step);
  const target = wordMin ? `，目标至少 ${wordMin} 字` : "";
  if (plan) {
    return `${label}没有写完：只写回 ${count} 字${target}，内容像是写作计划而不是正文，没有保存。原稿保持不变。`;
  }
  return `${label}没有写完：只写回 ${count} 字${target}，短得不像一节正文，没有保存。原稿保持不变。`;
}

export function buildGeneration(input: {
  task: GenerateTask;
  project: Project;
  step?: StepId;
  reader?: ReaderProfile;
  feedback?: string;
  feedbackSource?: FeedbackSource;
  prompts?: Partial<Record<PromptKey, string>>;
  readers?: ReaderProfile[];
}): BuiltGeneration | { error: string } {
  const { task, project, prompts } = input;
  const step = input.step ?? (task === "polish" || task === "quality-check" ? 3 : task === "draft" ? 2 : 1);

  if (task === "outline") {
    if (!project.idea.trim()) return { error: "先写下想法，再生成大纲。" };
    return {
      system: resolveSystem(prompts, "outline"),
      user: `请根据下面的想法写大纲。节拍要细到能按目标字数写满一节。\n\n${targetBlock(project)}\n\n# 想法\n${project.idea.trim()}`,
      temperature: 0.7,
      demo: demoText("outline", project),
    };
  }

  if (task === "draft") {
    if (!project.outline.trim()) return { error: "大纲还是空的，不能写初稿。" };
    return {
      system: resolveSystem(prompts, "draft"),
      user: `请根据大纲写一节正文。想法只作参照，情节以大纲为准。${proseOpening(project)}\n\n${targetBlock(project)}\n\n# 大纲\n${project.outline.trim()}\n\n# 想法\n${project.idea.trim() || "（无）"}`,
      temperature: 0.85,
      demo: demoText("draft", project),
    };
  }

  if (task === "polish") {
    const source = project.draft.trim() || project.polished.trim();
    if (!source) return { error: "没有稿件，无从润色。" };
    return {
      system: resolveSystem(prompts, "polish"),
      user: `请把下面的稿件润色成可以留下的一节。大纲是结构依据。${proseOpening(project)}\n\n${targetBlock(project)}\n\n# 大纲\n${project.outline.trim() || "（无大纲。不要另起情节，只把现有场面写开。）"}\n\n# 稿件\n${source}`,
      temperature: 0.7,
      demo: demoText("polish", project),
    };
  }

  if (task === "review") {
    const reader = input.reader;
    if (!reader) return { error: "要指定一位读者。" };
    if (reader.blocked) return { error: `${reader.name}已屏蔽，不参与审阅。` };
    const material = textForStep(project, step).trim();
    if (!material) return { error: "这一步还没有文字，读者无稿可看。" };
    const kind = step === 1 ? "大纲" : step === 2 ? "初稿" : "润色稿";
    return {
      system: withHardRule(reader.prompt),
      user: `你现在只以「${reader.name}」的身份看这份${kind}。\n\n# 大纲\n${project.outline.trim() || "（无大纲）"}\n\n# ${kind}\n${material}`,
      temperature: 0.4,
      demo: demoText("review", project, { readerName: reader.name }),
    };
  }

  if (task === "amend-review") {
    const reader = input.reader;
    if (!reader) return { error: "要指定一位读者。" };
    if (reader.blocked) return { error: `${reader.name}已屏蔽，不参与审阅。` };
    const discussion = (input.feedback ?? "").trim();
    if (!discussion) return { error: "先写下想怎么改这条意见。" };
    const talkIssue = lengthError("feedback", discussion);
    if (talkIssue) return { error: talkIssue };
    const note = reviewsForStep(project, step).find((item) => item.readerId === reader.id && item.text.trim());
    if (!note) return { error: "还没有这条读者意见，无从讨论。" };
    return {
      system: withHardRule(`你是改稿助手。作者正在讨论一位读者已经写下的意见。请按作者的讨论，改写这条意见，让它更具体、能交给改稿执行。
保持这位读者的口吻和立场，不要改成作者本人的旁白，不要输出稿件正文。
只输出改写后的意见。不要加「好的」之类的前言。
必须遵守文末的系统硬性规则。`),
      user: `读者：${reader.name}\n\n# 当前意见\n${note.text.trim()}${note.discussion.trim() ? `\n\n# 已记下的讨论增订\n${note.discussion.trim()}` : ""}\n\n# 作者这次的讨论\n${discussion}`,
      temperature: 0.4,
      demo: demoText("amend-review", project, { readerName: reader.name, feedback: discussion }),
      loggedFeedback: discussion,
    };
  }

  if (task === "quality-check") {
    if (step === 1) return { error: "结构质检看的是正文，不对大纲单独出清单。" };
    const prose = (step === 3 ? project.polished.trim() || project.draft.trim() : project.draft.trim());
    if (!prose) return { error: "还没有可质检的正文。" };
    return {
      system: resolveSystem(prompts, "qualityCheck"),
      user: `请做结构质检。\n\n${targetBlock(project)}\n实际字数（不计空白）：${countChars(prose)}\n\n# 大纲\n${project.outline.trim() || "（无大纲）"}\n\n# 正文\n${prose}`,
      temperature: 0.2,
      demo: demoText("quality-check", project),
    };
  }

  const source = input.feedbackSource ?? "user";
  const provided = (input.feedback ?? "").trim();
  let feedback = provided;
  let logNote: string | undefined;
  if (source === "readers") {
    // 请求里带来的意见文本可能是旧页面。只认稿上已经采纳的当前意见。
    const selection = readerReviseSelection(project, step, input.readers);
    if (!selection.text) {
      if (selection.unset.length > 0 || selection.ignored.length > 0) return { error: READER_REVISE_NEED_ADOPTION };
      return { error: READER_REVISE_NONE };
    }
    feedback = selection.text;
    logNote = readerReviseLogNote(selection);
  }
  if (source === "quality") {
    const block = qualityReviseBlock(project, step);
    if (block) return { error: block };
    // 只认稿上仍对得上的那份清单。请求里夹带的旧清单不能绕过。
    feedback = project.qualityReport?.text.trim() ?? "";
  }
  if (!feedback) {
    if (source === "readers") return { error: READER_REVISE_NONE };
    if (source === "quality") return { error: "还没有质检清单。" };
    return { error: "先写下修改意见。" };
  }
  const current = textForStep(project, step).trim() || (step === 3 ? project.draft.trim() : "");
  if (!current) return { error: "这一步还是空的，无从改起。" };
  const label = step === 1 ? "大纲" : step === 2 ? "初稿" : "润色稿";
  const opinion = feedback;
  const prose = step === 1 ? "" : `${proseOpening(project)}\n`;
  return {
    system: resolveSystem(prompts, "reviseFromFeedback"),
    user: `请按意见改这份${label}。${prose}${targetBlock(project)}\n\n# 大纲\n${project.outline.trim() || "（无大纲）"}\n\n# 当前${label}\n${current}\n\n# 意见（${source === "user" ? "作者" : source === "readers" ? "读者" : "结构质检"}）\n${opinion}`,
    temperature: 0.7,
    demo: demoText("revise-from-feedback", project, { feedback: opinion.slice(0, 80) }),
    loggedFeedback: opinion,
    logNote,
  };
}

export function snapshotForTask(task: GenerateTask, project: Project): {
  idea?: string;
  outline?: string;
  draft?: string;
  polished?: string;
  wordMin: number | null;
  wordMax: number | null;
} {
  const words = { wordMin: project.wordMin, wordMax: project.wordMax };
  if (task === "outline") return { idea: project.idea, ...words };
  if (task === "draft") return { idea: project.idea, outline: project.outline, ...words };
  if (task === "polish") return { outline: project.outline, draft: project.draft, polished: project.polished, ...words };
  return {
    idea: project.idea,
    outline: project.outline,
    draft: project.draft,
    polished: project.polished,
    ...words,
  };
}

export function generationLogDetail(task: GenerateTask, feedback: string, output: string, logNote?: string): string {
  const body =
    task === "revise-from-feedback"
      ? `意见原文：\n${feedback.trim()}\n\n结果节选：\n${excerpt(output, 800)}`
      : excerpt(output, 800);
  return logNote ? `${logNote}\n\n${body}` : body;
}

export function reviewedVersionKind(step: StepId) {
  return stepKind(step);
}

export function stepReviews(project: Project, step: StepId) {
  return reviewsForStep(project, step);
}
