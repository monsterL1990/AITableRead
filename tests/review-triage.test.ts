import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildGeneration, generationLogDetail } from "../lib/generation";
import {
  amendReviewOpinion,
  applyReview,
  applyReviewAmendment,
  applyReviewTriage,
  createProjectRecord,
  defaultReaders,
  READER_REVISE_NEED_ADOPTION,
  READER_REVISE_NONE,
  readerReviseLogNote,
  readerReviseSelection,
} from "../lib/pipeline";

function draftProject() {
  const project = createProjectRecord({ id: "p-triage", ownerId: "local", title: "回声", idea: "想法" });
  project.draft = "初稿正文";
  return project;
}

test("unset and ignored opinions stay out of a reader revision; only adopted ones go in", () => {
  const project = draftProject();
  const [first, second, third] = defaultReaders();
  const adopted = applyReview(project, { reader: first!, step: 2, text: "第四拍要补成动作。" });
  const ignored = applyReview(project, { reader: second!, step: 2, text: "这一场我不要。" });
  const unset = applyReview(project, { reader: third!, step: 2, text: "人话还在，先别动。" });
  assert.equal(adopted.triage, "unset");
  assert.equal(applyReviewTriage(project, adopted.id, "adopted").ok, true);
  assert.equal(applyReviewTriage(project, ignored.id, "ignored").ok, true);
  assert.equal(unset.triage, "unset");

  const selection = readerReviseSelection(project, 2, defaultReaders());
  assert.deepEqual(selection.adopted.map((note) => note.readerName), ["R18读者"]);
  assert.deepEqual(selection.ignored.map((note) => note.readerName), ["怪物Z"]);
  assert.deepEqual(selection.unset.map((note) => note.readerName), ["中年男"]);
  assert.match(selection.text, /## R18读者\n第四拍要补成动作。/);
  assert.doesNotMatch(selection.text, /这一场我不要/);
  assert.doesNotMatch(selection.text, /人话还在/);

  const revised = buildGeneration({
    task: "revise-from-feedback",
    step: 2,
    project,
    feedback: "客户端把怪物Z和中年男也塞进来了。这一场我不要。人话还在，先别动。",
    feedbackSource: "readers",
    readers: defaultReaders(),
  });
  assert.equal("error" in revised, false);
  if ("error" in revised) return;
  assert.match(revised.user, /# 意见（读者）\n## R18读者\n第四拍要补成动作。/);
  assert.doesNotMatch(revised.user, /这一场我不要/);
  assert.doesNotMatch(revised.user, /人话还在/);
  assert.doesNotMatch(revised.user, /客户端把怪物Z/);
  assert.equal(revised.loggedFeedback, selection.text);
  assert.equal(revised.logNote, readerReviseLogNote(selection));
  assert.match(revised.logNote ?? "", /采纳：R18读者。已忽略、未送进改稿：怪物Z。未定、未送进改稿：中年男。/);
  const detail = generationLogDetail("revise-from-feedback", revised.loggedFeedback ?? "", "改完的正文", revised.logNote);
  assert.match(detail, /采纳：R18读者/);
  assert.match(detail, /已忽略、未送进改稿：怪物Z/);
  assert.match(detail, /意见原文：\n## R18读者\n第四拍要补成动作。/);
  assert.doesNotMatch(detail, /这一场我不要/);

  const noneAdopted = buildGeneration({
    task: "revise-from-feedback",
    step: 2,
    project: {
      ...project,
      reviews: project.reviews.map((note) => ({ ...note, triage: "unset" as const })),
    },
    feedback: "第四拍要补成动作。",
    feedbackSource: "readers",
    readers: defaultReaders(),
  });
  assert.equal("error" in noneAdopted, true);
  if (!("error" in noneAdopted)) return;
  assert.equal(noneAdopted.error, READER_REVISE_NEED_ADOPTION);

  const onlyIgnored = buildGeneration({
    task: "revise-from-feedback",
    step: 2,
    project: {
      ...project,
      reviews: project.reviews.map((note) => ({ ...note, triage: note.id === ignored.id ? ("ignored" as const) : ("unset" as const) })),
    },
    feedback: ignored.text,
    feedbackSource: "readers",
  });
  assert.equal("error" in onlyIgnored, true);
  if (!("error" in onlyIgnored)) return;
  assert.equal(onlyIgnored.error, READER_REVISE_NEED_ADOPTION);

  const empty = buildGeneration({
    task: "revise-from-feedback",
    step: 2,
    project: { ...project, reviews: [] },
    feedback: "客户端还留着旧意见。",
    feedbackSource: "readers",
  });
  assert.equal("error" in empty, true);
  if (!("error" in empty)) return;
  assert.equal(empty.error, READER_REVISE_NONE);
});

test("a new reader opinion replaces the old one and resets triage", () => {
  const project = draftProject();
  const reader = defaultReaders()[0]!;
  const first = applyReview(project, { reader, step: 2, text: "旧意见，已经采纳。" });
  assert.equal(applyReviewTriage(project, first.id, "adopted").ok, true);
  assert.match(readerReviseSelection(project, 2).text, /旧意见，已经采纳。/);

  const second = applyReview(project, { reader, step: 2, text: "新意见，还没决定。" });
  assert.equal(second.triage, "unset");
  assert.equal(second.discussion, "");
  assert.equal(first.triage, "adopted");
  assert.notEqual(second.id, first.id);

  const selection = readerReviseSelection(project, 2);
  assert.equal(selection.text, "");
  assert.equal(selection.adopted.length, 0);
  assert.equal(selection.unset[0]?.id, second.id);
  const stale = applyReviewTriage(project, first.id, "adopted");
  assert.equal(stale.ok, false);
  if (stale.ok) return;
  assert.match(stale.error, /更早的一条意见/);
  assert.equal(readerReviseSelection(project, 2).text, "");

  const blocked = buildGeneration({
    task: "revise-from-feedback",
    step: 2,
    project,
    feedback: "旧意见，已经采纳。",
    feedbackSource: "readers",
  });
  assert.equal("error" in blocked, true);
  if (!("error" in blocked)) return;
  assert.equal(blocked.error, READER_REVISE_NEED_ADOPTION);
});

test("discussion is saved onto the opinion, and an AI amend replaces that text", () => {
  const project = draftProject();
  const reader = defaultReaders()[1]!;
  const note = applyReview(project, { reader, step: 2, text: "戳中点太虚。" });
  assert.equal(applyReviewTriage(project, note.id, "adopted").ok, true);

  const noted = applyReviewAmendment(project, {
    reviewId: note.id,
    text: note.text,
    discussion: "把档口那一场写成动作。",
  });
  assert.equal(noted.ok, true);
  if (!noted.ok) return;
  assert.equal(noted.note.triage, "adopted");
  assert.match(readerReviseSelection(project, 2).text, /## 怪物Z\n戳中点太虚。\n\n讨论增订：\n把档口那一场写成动作。/);
  assert.match(project.log.at(-1)!.summary, /记下对怪物Z这条意见的讨论/);

  const rewritten = applyReviewAmendment(project, {
    reviewId: note.id,
    text: "档口那场要看见手和钱。",
    discussion: "把档口那一场写成动作。",
  });
  assert.equal(rewritten.ok, true);
  if (!rewritten.ok) return;
  assert.equal(rewritten.note.triage, "unset");
  assert.match(project.log.at(-1)!.summary, /采纳状态回到未定/);
  assert.equal(readerReviseSelection(project, 2).text, "");

  assert.equal(applyReviewTriage(project, note.id, "adopted").ok, true);
  const amended = amendReviewOpinion(project, {
    readerId: reader.id,
    step: 2,
    text: "档口的钱和手都要写上。",
    discussion: "再具体一点。",
    via: "demo",
  });
  assert.equal(amended.ok, true);
  if (!amended.ok) return;
  assert.equal(amended.note.id, note.id);
  assert.equal(amended.note.text, "档口的钱和手都要写上。");
  assert.equal(amended.note.discussion, "");
  assert.equal(amended.note.triage, "unset");
  assert.match(project.log.at(-1)!.summary, /按讨论改了怪物Z的意见/);
  assert.match(project.log.at(-1)!.summary, /请再决定是否采纳/);
  assert.match(project.log.at(-1)!.detail, /再具体一点/);
  assert.match(project.log.at(-1)!.detail, /档口的钱和手都要写上/);
  assert.equal(readerReviseSelection(project, 2).adopted.length, 0);

  const missing = buildGeneration({
    task: "amend-review",
    step: 2,
    project,
    reader,
    feedback: "",
  });
  assert.equal("error" in missing, true);
  if (!("error" in missing)) return;
  assert.match(missing.error, /先写下想怎么改这条意见/);

  const prompt = buildGeneration({
    task: "amend-review",
    step: 2,
    project,
    reader,
    feedback: "保留钱和手。",
  });
  assert.equal("error" in prompt, false);
  if ("error" in prompt) return;
  assert.match(prompt.user, /# 当前意见\n档口的钱和手都要写上。/);
  assert.match(prompt.user, /# 作者这次的讨论\n保留钱和手。/);
  assert.doesNotMatch(prompt.user, /请按意见改这份/);
  assert.match(prompt.demo, /保留钱和手/);
});

test("stored reviews keep an explicit triage and read a missing one as unset", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gaojian-triage-"));
  const file = path.join(dir, "store.json");
  process.env.GAOJIAN_DATA_FILE = file;
  await writeFile(
    file,
    JSON.stringify({
      version: 2,
      prompts: {},
      readers: [],
      projects: [
        {
          id: "old-triage",
          ownerId: "local",
          title: "回声",
          startFrom: "idea",
          idea: "想法",
          outline: "",
          draft: "初稿",
          polished: "",
          versions: [],
          currentVersion: {},
          reviews: [
            {
              id: "plain",
              readerId: "r18",
              readerName: "R18读者",
              step: 2,
              versionId: "",
              text: "未标",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
            {
              id: "kept",
              readerId: "monster",
              readerName: "怪物Z",
              step: 2,
              versionId: "",
              text: "要",
              createdAt: "2026-01-01T00:00:00.000Z",
              triage: "adopted",
              discussion: "补第四拍",
            },
            {
              id: "bad",
              readerId: "middle",
              readerName: "中年男",
              step: 2,
              versionId: "",
              text: "丢",
              createdAt: "2026-01-01T00:00:00.000Z",
              triage: "nope",
            },
          ],
          confirmed: { 1: true, 2: false, 3: false },
          confirmedAt: {},
          currentStep: 2,
          log: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          revision: 2,
        },
      ],
    }),
  );
  const store = await import("../lib/store");
  const loaded = await store.getProject("local", "old-triage");
  assert.equal(loaded?.reviews.find((note) => note.id === "plain")?.triage, "unset");
  assert.equal(loaded?.reviews.find((note) => note.id === "plain")?.discussion, "");
  assert.equal(loaded?.reviews.find((note) => note.id === "kept")?.triage, "adopted");
  assert.equal(loaded?.reviews.find((note) => note.id === "kept")?.discussion, "补第四拍");
  assert.equal(loaded?.reviews.find((note) => note.id === "bad")?.triage, "unset");

  const saved = await store.updateProject("local", "old-triage", (project) => {
    assert.equal(applyReviewTriage(project, "kept", "ignored").ok, true);
  });
  assert.equal(saved?.reviews.find((note) => note.id === "kept")?.triage, "ignored");
  const again = await store.getProject("local", "old-triage");
  assert.equal(again?.reviews.find((note) => note.id === "kept")?.triage, "ignored");
  assert.equal(again?.reviews.find((note) => note.id === "plain")?.triage, "unset");
});
