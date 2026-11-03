import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { complianceHandoff } from "../lib/compliance";
import { buildGeneration, generationLogDetail, stepReviews, unfinishedProseMessage } from "../lib/generation";
import { countChars } from "../lib/format";
import { chatCompletionsUrl, getLlmConfig } from "../lib/llm";
import { projectToMarkdown } from "../lib/markdown";
import {
  applyConfirm,
  applyQualityReport,
  applyReview,
  applyReviewTriage,
  applyRollback,
  canViewStep,
  createProjectRecord,
  defaultReaders,
  feedbackBundle,
  pushVersion,
  qualityReviseBlock,
  readerNotesForStep,
  STEPS,
} from "../lib/pipeline";
import { DEFAULT_PROMPTS } from "../lib/prompts";
import { demoText } from "../lib/demo-text";
import { configuredPassword, getPassword } from "../lib/session";

test("three steps, and a later step stays locked until the previous one is confirmed", () => {
  assert.deepEqual(
    STEPS.map((step) => step.short),
    ["大纲", "初稿", "润色"],
  );
  const project = createProjectRecord({
    id: "p1",
    ownerId: "local",
    title: "回声",
    idea: "两个成年人重逢",
  });
  assert.equal(canViewStep(project, 1), true);
  assert.equal(canViewStep(project, 2), false);
  assert.equal(applyConfirm(project, 2).ok, false);
  assert.equal(project.currentStep, 1);

  project.outline = "大纲正文";
  assert.equal(applyConfirm(project, 1).ok, true);
  assert.equal(project.confirmed[1], true);
  assert.equal(project.currentStep, 2);
  assert.equal(canViewStep(project, 2), true);
  assert.equal(canViewStep(project, 3), false);

  assert.equal(applyConfirm(project, 2).ok, false);
  project.draft = "初稿正文";
  assert.equal(applyConfirm(project, 2).ok, true);
  assert.equal(project.currentStep, 3);
  project.polished = "润色正文";
  assert.equal(applyConfirm(project, 3).ok, true);
  assert.equal(project.confirmed[3], true);
  assert.equal(project.currentStep, 3);
});

test("reader reviews are optional, including on the outline", () => {
  const project = createProjectRecord({
    id: "p-readers",
    ownerId: "local",
    title: "回声",
    idea: "想法",
  });
  project.outline = "大纲正文";
  assert.equal(project.reviews.length, 0);
  assert.equal(applyConfirm(project, 1).ok, true);
  assert.equal(project.currentStep, 2);
});

test("a full manuscript opens on polish with the first two steps confirmed", () => {
  const project = createProjectRecord({
    id: "p-ms",
    ownerId: "local",
    title: "回声",
    startFrom: "manuscript",
    manuscript: "门外站着梁照。",
  });
  assert.equal(project.currentStep, 3);
  assert.equal(project.confirmed[1], true);
  assert.equal(project.confirmed[2], true);
  assert.equal(project.confirmed[3], false);
  assert.equal(project.draft, "门外站着梁照。");
  assert.equal(project.polished, "门外站着梁照。");
  assert.equal(canViewStep(project, 3), true);
});

test("versions append and roll back without dropping the log", () => {
  const project = createProjectRecord({
    id: "p-ver",
    ownerId: "local",
    title: "回声",
    idea: "想法",
  });
  const first = pushVersion(project, "outline", "第一版大纲", "generate", "生成");
  const second = pushVersion(project, "outline", "第二版大纲", "feedback", "按作者意见改");
  assert.equal(first.label, "大纲");
  assert.equal(second.label, "大纲修改1");
  assert.equal(project.outline, "第二版大纲");
  assert.equal(applyRollback(project, first.id).ok, true);
  assert.equal(project.outline, "第一版大纲");
  assert.equal(project.versions.length, 2);
  assert.equal(project.log.some((entry) => entry.type === "rollback" && entry.versionId === first.id), true);

  project.draft = "手改过的初稿";
  assert.equal(applyConfirm(project, 1).ok, true);
  project.draft = "初稿";
  const confirmed = applyConfirm(project, 2);
  assert.equal(confirmed.ok, true);
  assert.equal(project.log.some((entry) => entry.type === "confirm"), true);

  const reader = defaultReaders()[0]!;
  applyReview(project, { reader, step: 2, text: "追读意愿还在。" });
  assert.equal(project.log.some((entry) => entry.type === "review" && entry.detail.includes("追读意愿还在")), true);
  applyQualityReport(project, 2, "字数不够，第二拍被跳过。");
  assert.equal(project.log.some((entry) => entry.type === "quality-check"), true);
  assert.match(generationLogDetail("revise-from-feedback", "第四拍写具体一点", "改完的正文"), /第四拍写具体一点/);
});

test("custom prompts still receive the adult hard rule and no compliance markers", () => {
  const project = createProjectRecord({
    id: "p2",
    ownerId: "local",
    title: "回声",
    idea: "34 岁的编辑",
  });
  const built = buildGeneration({
    task: "outline",
    project,
    prompts: { outline: "只写大纲。" },
  });
  assert.equal("error" in built, false);
  if ("error" in built) return;
  assert.match(built.system, /系统硬性规则/);
  assert.match(built.system, /18/);
  assert.doesNotMatch(built.system, /合规修改/);
  for (const text of Object.values(DEFAULT_PROMPTS)) {
    assert.doesNotMatch(text, /合规修改/);
  }
  assert.doesNotMatch(demoText("polish", project), /合规修改/);
});

test("feedback, quality check, and blocked readers", () => {
  const project = createProjectRecord({
    id: "p3",
    ownerId: "local",
    title: "回声",
    idea: "想法",
    wordMin: 2000,
    wordMax: 3500,
  });
  project.outline = "节拍甲：梁照在门口停住。";
  project.draft = "短正文";
  const revised = buildGeneration({
    task: "revise-from-feedback",
    step: 2,
    project,
    feedback: "第四拍写具体一点",
    feedbackSource: "user",
  });
  assert.equal("error" in revised, false);
  if ("error" in revised) return;
  assert.match(revised.user, /第四拍写具体一点/);
  assert.match(revised.user, /2000/);
  assert.match(revised.user, /同一份在/);
  assert.match(revised.system, /同一份在/);
  assert.match(revised.system, /不要另发收尾/);
  assert.doesNotMatch(revised.system, /合规修改/);

  const quality = buildGeneration({ task: "quality-check", step: 2, project });
  assert.equal("error" in quality, false);
  if ("error" in quality) return;
  assert.match(quality.user, /节拍甲/);
  assert.match(quality.user, /2000/);
  assert.match(quality.user, new RegExp(String(countChars(project.draft))));

  const blocked = defaultReaders()[0]!;
  blocked.blocked = true;
  const review = buildGeneration({ task: "review", step: 2, project, reader: blocked });
  assert.equal("error" in review, true);
});

test("visible reader notes for the current step revise the manuscript when the feedback field is empty", () => {
  const project = createProjectRecord({
    id: "p-notes",
    ownerId: "local",
    title: "回声",
    idea: "想法",
  });
  project.outline = "大纲正文";
  project.draft = "初稿正文";
  const [first, second, third] = defaultReaders();
  const hidden = { ...third!, blocked: true };
  applyReview(project, { reader: first!, step: 2, text: "旧意见，不该再用。" });
  const current = applyReview(project, { reader: first!, step: 2, text: "第四拍被跳过，动机接不上。" });
  assert.equal(applyReviewTriage(project, current.id, "adopted").ok, true);
  applyReview(project, { reader: second!, step: 2, text: "   " });
  const outlineNote = applyReview(project, { reader: second!, step: 1, text: "这是大纲上的意见。" });
  assert.equal(applyReviewTriage(project, outlineNote.id, "adopted").ok, true);
  applyReview(project, { reader: hidden, step: 2, text: "屏蔽读者的意见不该进这一版。" });

  const revised = buildGeneration({
    task: "revise-from-feedback",
    step: 2,
    project,
    feedback: "",
    feedbackSource: "readers",
    readers: [first!, second!, hidden],
  });
  assert.equal("error" in revised, false);
  if ("error" in revised) return;
  assert.match(revised.user, /## R18读者\n第四拍被跳过，动机接不上。/);
  assert.equal(revised.loggedFeedback, "## R18读者\n第四拍被跳过，动机接不上。");
  assert.match(revised.user, /# 当前初稿\n初稿正文/);
  assert.doesNotMatch(revised.user, /旧意见，不该再用/);
  assert.doesNotMatch(revised.user, /这是大纲上的意见/);
  assert.doesNotMatch(revised.user, /屏蔽读者的意见不该进这一版/);
  assert.doesNotMatch(revised.user, /怪物Z/);

  const otherStep = buildGeneration({
    task: "revise-from-feedback",
    step: 1,
    project,
    feedback: "",
    feedbackSource: "readers",
  });
  assert.equal("error" in otherStep, false);
  if ("error" in otherStep) return;
  assert.match(otherStep.user, /这是大纲上的意见/);
  assert.doesNotMatch(otherStep.user, /第四拍被跳过/);

  const empty = buildGeneration({
    task: "revise-from-feedback",
    step: 3,
    project,
    feedback: "",
    feedbackSource: "readers",
  });
  assert.equal("error" in empty, true);
  if (!("error" in empty)) return;
  assert.match(empty.error, /还没有读者意见/);
});

test("step 3 reader revise leaves the polish checklist stale until quality is run again", () => {
  const original = "门外站着梁照。雨先打在棚上。";
  const project = createProjectRecord({
    id: "p-polish-qc",
    ownerId: "local",
    title: "回声",
    startFrom: "manuscript",
    manuscript: original,
    wordMin: 2000,
    wordMax: 3500,
  });
  assert.equal(project.currentStep, 3);
  const base = project.versions.find((version) => version.kind === "polish");
  assert.equal(base?.label, "润色");
  applyQualityReport(project, 3, "第四拍偏薄。清单对着这一版润色稿。");
  assert.equal(project.qualityReport?.versionId, base?.id);
  assert.equal(qualityReviseBlock(project, 3), null);

  const current = buildGeneration({
    task: "revise-from-feedback",
    step: 3,
    project,
    feedback: "",
    feedbackSource: "quality",
  });
  assert.equal("error" in current, false);
  if ("error" in current) return;
  assert.match(current.user, /# 意见（结构质检）\n第四拍偏薄。清单对着这一版润色稿。/);
  assert.match(current.user, /# 当前润色稿\n门外站着梁照。雨先打在棚上。/);

  const reader = defaultReaders()[0]!;
  applyReview(project, { reader, step: 3, text: "第四拍停得太快。" });
  const longer = `${original}他没有下楼，只把地址又看了一遍。`;
  const revised = pushVersion(project, "polish", longer, "feedback", "按读者意见改");
  assert.equal(revised.label, "润色修改1");
  assert.equal(project.polished, longer);
  assert.notEqual(project.qualityReport?.versionId, revised.id);
  const message = `质检清单对着的是更早的正文（${countChars(original)} 字），现在是 ${countChars(longer)} 字。请再跑一次结构质检。`;
  assert.equal(qualityReviseBlock(project, 3), message);

  const blocked = buildGeneration({
    task: "revise-from-feedback",
    step: 3,
    project,
    feedback: "",
    feedbackSource: "quality",
  });
  assert.equal("error" in blocked, true);
  if (!("error" in blocked)) return;
  assert.equal(blocked.error, message);
  assert.equal(project.polished, longer);
  assert.equal(project.versions.filter((version) => version.kind === "polish").length, 2);

  applyQualityReport(project, 3, "字数仍短，门牌还没写上。");
  assert.equal(qualityReviseBlock(project, 3), null);
  const again = buildGeneration({
    task: "revise-from-feedback",
    step: 3,
    project,
    feedback: "",
    feedbackSource: "quality",
  });
  assert.equal("error" in again, false);
  if ("error" in again) return;
  assert.match(again.user, /# 意见（结构质检）\n字数仍短，门牌还没写上。/);
  assert.match(again.user, /他没有下楼，只把地址又看了一遍。/);
  assert.equal(again.loggedFeedback, "字数仍短，门牌还没写上。");
});

test("quality revise follows the current checklist and refuses one written for an older draft", () => {
  const project = createProjectRecord({
    id: "p-qc",
    ownerId: "local",
    title: "回声",
    idea: "想法",
    wordMin: 2000,
    wordMax: 3500,
  });
  project.outline = "节拍甲：梁照在门口停住。";
  const original = "门外站着梁照。";
  const generated = pushVersion(project, "draft", original, "generate", "生成");
  assert.equal(generated.label, "初稿");
  applyQualityReport(project, 2, "门牌没有写进正文。实际字数对着这一版。");
  assert.equal(project.qualityReport?.versionId, generated.id);
  assert.equal(qualityReviseBlock(project, 2), null);
  assert.equal(feedbackBundle(project, 2, "quality", ""), "门牌没有写进正文。实际字数对着这一版。");

  const fresh = buildGeneration({
    task: "revise-from-feedback",
    step: 2,
    project,
    feedback: "",
    feedbackSource: "quality",
  });
  assert.equal("error" in fresh, false);
  if ("error" in fresh) return;
  assert.match(fresh.user, /# 意见（结构质检）\n门牌没有写进正文。实际字数对着这一版。/);
  assert.match(fresh.user, /# 当前初稿\n门外站着梁照。/);
  assert.equal(fresh.loggedFeedback, "门牌没有写进正文。实际字数对着这一版。");

  const planted = buildGeneration({
    task: "revise-from-feedback",
    step: 2,
    project,
    feedback: "客户端塞进来的旧清单，不该用。",
    feedbackSource: "quality",
  });
  assert.equal("error" in planted, false);
  if ("error" in planted) return;
  assert.match(planted.user, /门牌没有写进正文/);
  assert.doesNotMatch(planted.user, /客户端塞进来的旧清单/);

  const longer = "门外站着梁照。他看了眼门牌，才把地址发出去。";
  const revised = pushVersion(project, "draft", longer, "feedback", "按读者意见改");
  assert.equal(revised.label, "初稿修改1");
  assert.notEqual(countChars(original), countChars(longer));
  const stale = buildGeneration({
    task: "revise-from-feedback",
    step: 2,
    project,
    feedback: "门牌没有写进正文。实际字数对着这一版。",
    feedbackSource: "quality",
  });
  assert.equal("error" in stale, true);
  if (!("error" in stale)) return;
  const staleMessage = `质检清单对着的是更早的正文（${countChars(original)} 字），现在是 ${countChars(longer)} 字。请再跑一次结构质检。`;
  assert.equal(stale.error, staleMessage);
  assert.equal(qualityReviseBlock(project, 2), staleMessage);
  assert.equal(feedbackBundle(project, 2, "quality", "门牌没有写进正文。"), "");

  applyRollback(project, generated.id);
  assert.equal(project.draft, original);
  assert.equal(qualityReviseBlock(project, 2), null);

  project.draft = "窗边站着梁照。";
  assert.equal(countChars(project.draft), countChars(original));
  const sameLength = qualityReviseBlock(project, 2);
  assert.equal(sameLength, `质检清单对着的是更早的正文（${countChars(original)} 字）。正文已经改过，请再跑一次结构质检。`);
  const sameLengthRevise = buildGeneration({
    task: "revise-from-feedback",
    step: 2,
    project,
    feedback: "",
    feedbackSource: "quality",
  });
  assert.equal("error" in sameLengthRevise, true);
  if (!("error" in sameLengthRevise)) return;
  assert.equal(sameLengthRevise.error, sameLength);

  project.draft = longer;
  project.polished = "润色稿还在。";
  const otherStep = buildGeneration({
    task: "revise-from-feedback",
    step: 3,
    project,
    feedback: "",
    feedbackSource: "quality",
  });
  assert.equal("error" in otherStep, true);
  if (!("error" in otherStep)) return;
  assert.equal(otherStep.error, "还没有质检清单。");

  project.qualityReport = null;
  const missing = buildGeneration({
    task: "revise-from-feedback",
    step: 2,
    project,
    feedback: "",
    feedbackSource: "quality",
  });
  assert.equal("error" in missing, true);
  if (!("error" in missing)) return;
  assert.equal(missing.error, "还没有质检清单。");
});

test("adopted reader cards revise from the store, and a client payload cannot smuggle the rest", () => {
  const project = createProjectRecord({ id: "p-three", ownerId: "local", title: "回声", idea: "想法" });
  project.draft = "初稿正文";
  const readers = defaultReaders();
  const lines = ["评分 5，追读意愿低。", "戳中点是档口那个画面。", "人话还在，别把对话磨成反射。"];
  readers.forEach((reader, index) => {
    const note = applyReview(project, { reader, step: 2, text: lines[index]! });
    assert.equal(applyReviewTriage(project, note.id, "adopted").ok, true);
  });
  const shown = readerNotesForStep(project, 2, readers);
  assert.match(shown, /## R18读者\n评分 5，追读意愿低。/);
  assert.match(shown, /## 怪物Z\n戳中点是档口那个画面。/);
  assert.match(shown, /## 中年男\n人话还在，别把对话磨成反射。/);

  const fromStore = buildGeneration({
    task: "revise-from-feedback",
    step: 2,
    project,
    feedback: "",
    feedbackSource: "readers",
    readers,
  });
  assert.equal("error" in fromStore, false);
  if ("error" in fromStore) return;
  assert.match(fromStore.user, /评分 5，追读意愿低。/);
  assert.match(fromStore.user, /戳中点是档口那个画面。/);
  assert.match(fromStore.user, /人话还在，别把对话磨成反射。/);
  assert.equal(fromStore.loggedFeedback, shown);
  assert.match(fromStore.logNote ?? "", /采纳：R18读者、怪物Z、中年男/);

  const planted = buildGeneration({
    task: "revise-from-feedback",
    step: 2,
    project,
    feedback: "客户端塞进来的旧意见，不该用。",
    feedbackSource: "readers",
    readers,
  });
  assert.equal("error" in planted, false);
  if ("error" in planted) return;
  assert.equal(planted.loggedFeedback, shown);
  assert.doesNotMatch(planted.user, /客户端塞进来的旧意见/);

  const cardsOnly = buildGeneration({
    task: "revise-from-feedback",
    step: 2,
    project: { ...project, reviews: [] },
    feedback: shown,
    feedbackSource: "readers",
    readers,
  });
  assert.equal("error" in cardsOnly, true);
  if (!("error" in cardsOnly)) return;
  assert.match(cardsOnly.error, /还没有读者意见/);
});

test("review and quality logs name whether the words came through DSH", () => {
  const project = createProjectRecord({ id: "p-route", ownerId: "local", title: "回声", idea: "想法" });
  const reader = defaultReaders()[0]!;
  applyReview(project, { reader, step: 1, text: "意见", via: "dsh" });
  assert.match(project.log.at(-1)!.summary, /经 DSH/);
  assert.equal(stepReviews(project, 1).length, 1);
  applyQualityReport(project, 2, "清单", "cliproxy");
  assert.match(project.log.at(-1)!.summary, /经 CLIProxy/);
  assert.equal(stepReviews(project, 2).length, 0);
});

test("markdown export names the text route and keeps no compliance markers", () => {
  const handoff = complianceHandoff();
  assert.equal(handoff.provider, "cliproxy");
  assert.equal(handoff.status, "not-configured");
  assert.match(handoff.note, /未配齐 DSH/);
  assert.match(handoff.note, /CLIProxy/);
  assert.doesNotMatch(handoff.note, /永不|跑一次合规清洗/);

  const configured = complianceHandoff({
    DSH_BASE_URL: "http://dsh.example:8080",
    DSH_TOKEN: "launch-token",
    DSH_SESSION_ID: "session-1",
  });
  assert.equal(configured.provider, "dsh");
  assert.equal(configured.status, "configured");
  assert.match(configured.note, /出字经 DSH/);
  assert.doesNotMatch(configured.note, /跑一次/);

  const cliproxy = complianceHandoff({
    OPENAI_BASE_URL: "http://llm.example/v1",
    OPENAI_API_KEY: "secret",
  });
  assert.equal(cliproxy.status, "not-configured");
  assert.match(cliproxy.note, /出字经 CLIProxy/);

  const project = createProjectRecord({ id: "p4", ownerId: "local", title: "回声", idea: "想法" });
  project.outline = "大纲";
  project.draft = "初稿";
  project.polished = "门外站着人。梁照四十一岁。";
  const full = projectToMarkdown(project, "full");
  assert.match(full, /# 回声/);
  assert.match(full, /未配齐 DSH/);
  assert.doesNotMatch(full, /dsh-purge/);
  assert.match(full, /写作站\/local\/p4\//);
  assert.doesNotMatch(full, /合规修改开始/);
  assert.doesNotMatch(full, /合规修改结束/);
  const current = projectToMarkdown(project, "current");
  assert.match(current, /梁照四十一岁/);
  assert.match(current, /不含合规修改标记/);
  assert.doesNotMatch(current, /合规修改开始|合规修改结束/);
});

test("openai compatible url stays a single chat completions path", () => {
  assert.equal(
    chatCompletionsUrl("http://llm.example/v1"),
    "http://llm.example/v1/chat/completions",
  );
  assert.equal(
    chatCompletionsUrl("http://llm.example/v1/chat/completions/"),
    "http://llm.example/v1/chat/completions",
  );
  const missing = getLlmConfig({ OPENAI_BASE_URL: "", OPENAI_API_KEY: "", OPENAI_MODEL: "" });
  assert.equal(missing.demo, true);
  assert.deepEqual(missing.missing, ["OPENAI_BASE_URL", "OPENAI_API_KEY"]);
  const baseOnly = getLlmConfig({
    OPENAI_BASE_URL: "http://llm.example/v1",
    OPENAI_API_KEY: "  ",
    OPENAI_MODEL: "proxy-model",
  });
  assert.equal(baseOnly.demo, true);
  assert.deepEqual(baseOnly.missing, ["OPENAI_API_KEY"]);
  const ready = getLlmConfig({
    OPENAI_BASE_URL: "http://llm.example/v1",
    OPENAI_API_KEY: "secret",
    OPENAI_MODEL: "demo-model",
  });
  assert.equal(ready.demo, false);
  assert.equal(ready.model, "demo-model");
});

test("login password prefers APP_PASSWORD and refuses an empty production env", () => {
  assert.equal(configuredPassword({ APP_PASSWORD: " desk ", AUTH_PASSWORD: "other" }), "desk");
  assert.equal(configuredPassword({ APP_PASSWORD: "", AUTH_PASSWORD: " from-auth " }), "from-auth");
  assert.equal(getPassword({ NODE_ENV: "production" }), null);
  assert.equal(getPassword({ NODE_ENV: "production", AUTH_PASSWORD: "site-secret" }), "site-secret");
  assert.equal(getPassword({ NODE_ENV: "development" }), "changeme");
});

test("projects stay inside one owner and old five-step files migrate", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gaojian-"));
  const file = path.join(dir, "store.json");
  process.env.GAOJIAN_DATA_FILE = file;
  const store = await import("../lib/store");
  const created = await store.createProject("local", { title: "回声", startFrom: "idea", idea: "两个成年人" });
  assert.equal(created.ownerId, "local");
  assert.equal(created.currentStep, 1);
  assert.equal(created.wordMin, 2000);
  const saved = await store.updateProject("local", created.id, (project) => {
    project.outline = "有大纲";
  });
  assert.equal(saved?.outline, "有大纲");
  assert.equal(saved && saved.revision > created.revision, true);
  assert.equal(await store.getProject("friend", created.id), null);
  assert.equal(await store.deleteProject("friend", created.id), false);
  assert.equal(await store.deleteProject("local", created.id), true);

  await writeFile(
    file,
    JSON.stringify({
      version: 1,
      prompts: { revise: "旧的改稿提示，不要删掉。" },
      projects: [
        {
          id: "old",
          ownerId: "local",
          title: "旧稿",
          idea: "想法",
          outline: "旧大纲",
          draft: "旧初稿",
          revised: "旧改稿",
          reviews: { r18: "好看", monster: "", middle: "可留" },
          currentStep: 4,
          finalized: false,
          revision: 3,
        },
      ],
    }),
  );
  const migrated = await store.getProject("local", "old");
  assert.equal(migrated?.currentStep, 3);
  assert.equal(migrated?.confirmed[1], true);
  assert.equal(migrated?.confirmed[2], true);
  assert.equal(migrated?.polished, "旧改稿");
  const kept = migrated?.reviews.find((note) => note.step === 2 && note.text === "好看");
  assert.ok(kept);
  assert.equal(kept?.triage, "unset");
  assert.equal(kept?.discussion, "");
  assert.equal(migrated?.log.some((entry) => entry.type === "migrate"), true);
  const prompts = await store.getPromptOverrides();
  assert.match(prompts.reviseFromFeedback ?? "", /旧的改稿提示/);
  const readers = await store.listReaders();
  assert.equal(readers.length, 3);

  await rm(dir, { recursive: true, force: true });
  delete process.env.GAOJIAN_DATA_FILE;
});

test("a plan stub is not a finished draft, and prose that is merely under a long target still is", () => {
  const plan = "先按大纲把六拍写成正文，写完核对字数和节拍，不够就补场面，不补心情。";
  const doubled = `${plan}\n${plan}`;
  const rejected = unfinishedProseMessage("draft", 2, doubled, 20000);
  assert.ok(rejected);
  assert.match(rejected ?? "", /没有保存/);
  assert.match(rejected ?? "", /写作计划/);
  assert.match(rejected ?? "", /20000/);
  assert.match(rejected ?? "", /原稿保持不变/);

  const prose = "雨先打在自行车棚上。沈酌把红笔搁进笔洗，才听见纸袋碰在门外。".repeat(12);
  assert.equal(unfinishedProseMessage("draft", 2, prose, 20000), null);
  const project = createProjectRecord({
    id: "p-long",
    ownerId: "local",
    title: "私人影院",
    idea: "想法",
    wordMin: 20000,
    wordMax: 50000,
  });
  assert.equal(unfinishedProseMessage("draft", 2, demoText("draft", project), 50000), null);
  assert.match(unfinishedProseMessage("polish", 3, "门外站着梁照。", null) ?? "", /润色稿/);
  assert.equal(unfinishedProseMessage("quality-check", 2, doubled, 20000), null);
  assert.equal(unfinishedProseMessage("review", 2, doubled, 20000), null);
  assert.equal(unfinishedProseMessage("outline", 1, doubled, 20000), null);
  assert.match(unfinishedProseMessage("revise-from-feedback", 2, doubled, 20000) ?? "", /初稿没有写完/);
  assert.equal(unfinishedProseMessage("revise-from-feedback", 1, doubled, 20000), null);

  project.outline = "六拍。登记名、职业、三个月。";
  const built = buildGeneration({ task: "draft", project });
  assert.equal("error" in built, false);
  if ("error" in built) return;
  assert.match(built.user, /20000–50000/);
  assert.match(built.user, /先按大纲/);
  assert.match(built.user, /不要总结/);
  assert.match(built.user, /同一份在/);
  assert.match(built.system, /禁止只交/);
  assert.match(built.system, /不要另发收尾/);
});

test("text route preference stays in the manuscript store", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gaojian-settings-"));
  const file = path.join(dir, "store.json");
  process.env.GAOJIAN_DATA_FILE = file;
  try {
    const store = await import("../lib/store");
    assert.equal((await store.getSettings()).preferredTextRoute, null);
    const project = await store.createProject("local", { title: "回声", startFrom: "idea", idea: "两个成年人" });
    assert.equal((await store.setPreferredTextRoute("cliproxy")).preferredTextRoute, "cliproxy");
    assert.equal((await store.getSettings()).preferredTextRoute, "cliproxy");
    assert.equal((await store.getProject("local", project.id))?.title, "回声");
    const raw = JSON.parse(await readFile(file, "utf8")) as {
      workspaces?: { local?: { settings?: { preferredTextRoute?: string } } };
    };
    assert.equal(raw.workspaces?.local?.settings?.preferredTextRoute, "cliproxy");
    assert.equal(JSON.stringify(raw).includes("secret"), false);
    const settings = raw.workspaces?.local?.settings;
    if (!settings) throw new Error("missing settings");
    settings.preferredTextRoute = "custom";
    await writeFile(file, JSON.stringify(raw));
    assert.equal((await store.getSettings()).preferredTextRoute, "custom");
    settings.preferredTextRoute = "sideways";
    await writeFile(file, JSON.stringify(raw));
    assert.equal((await store.getSettings()).preferredTextRoute, null);
    await store.setPreferredTextRoute("dsh");
    assert.equal((await store.getSettings()).preferredTextRoute, "dsh");
  } finally {
    await rm(dir, { recursive: true, force: true });
    delete process.env.GAOJIAN_DATA_FILE;
  }
});
