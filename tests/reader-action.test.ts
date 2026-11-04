import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "node:test";
import { ModeBanner } from "../components/mode-banner";
import { ReaderDiscussForm } from "../components/reader-triage";
import { Dialog } from "../components/ui/dialog";
import { StepPanels } from "../components/step-panels";
import { connectedModelLines } from "../lib/format";
import { createProjectRecord, defaultReaders } from "../lib/pipeline";
import {
  keepReviews,
  readerCardBody,
  readerCardFailed,
  reviewAllButtonLabel,
  reviewBlockedBySaveMessage,
  reviewOneButtonLabel,
  reviewRequestFailedMessage,
  reviewTriageLabel,
} from "../lib/reader-action";
import type { PublicConfig, ReviewNote } from "../lib/types";

const config: PublicConfig = {
  demoMode: false,
  missing: [],
  model: "grok-4.6",
  baseUrl: "http://llm.example/v1",
  devPasswordHint: false,
  authConfigured: true,
  textRoute: "cliproxy",
  dshConfigured: false,
  dshMissing: [],
  preferredTextRoute: "cliproxy",
  textRouteNote: "",
  customApi: {
    baseUrl: "",
    model: "",
    apiKeyMask: "",
    configured: false,
    missing: ["接口地址", "API Key", "模型"],
  },
  dshModel: null,
};

function textOf(html: string) {
  return html.replace(/<[^>]+>/g, "");
}

test("connected model copy keeps the model, url, and key note apart", () => {
  const lines = connectedModelLines("grok-4.6", "http://llm.example/v1");
  assert.deepEqual(
    lines.map((line) => line.text),
    ["已连接模型 grok-4.6", "http://llm.example/v1", "密钥只留在服务器。"],
  );
  const html = renderToStaticMarkup(createElement(ModeBanner, { config }));
  const text = textOf(html);
  assert.equal(text.includes("grok-4.6http"), false);
  assert.equal(text.includes("v1密钥"), false);
  assert.match(text, /出字经 OpenAI 兼容接口/);
  assert.match(text, /未配齐 DSH，出字不经 DSH/);
  assert.match(text, /grok-4\.6 /);
  assert.match(text, /llm\.example\/v1 /);
  assert.equal(html.match(/<p[\s>]/g)?.length, 5);
  const dshHtml = textOf(
    renderToStaticMarkup(
      createElement(ModeBanner, {
        config: { ...config, textRoute: "dsh", dshConfigured: true, model: null, baseUrl: null, dshMissing: [], preferredTextRoute: "dsh", textRouteNote: "" },
      }),
    ),
  );
  assert.match(dshHtml, /出字经 DSH/);
  assert.match(dshHtml, /设置/);
  assert.match(dshHtml, /模板会话/);
  assert.equal(dshHtml.includes("已连接模型"), false);
  assert.equal(dshHtml.includes("跑一次合规清洗"), false);
  const picked = textOf(
    renderToStaticMarkup(
      createElement(ModeBanner, {
        config: {
          ...config,
          textRoute: "dsh",
          dshConfigured: true,
          model: null,
          baseUrl: null,
          dshMissing: [],
          preferredTextRoute: "dsh",
          textRouteNote: "",
          dshModel: { provider: "deepseek-official", model: "deepseek-flash" },
        },
      }),
    ),
  );
  assert.match(picked, /deepseek-official \/ deepseek-flash/);
  assert.match(picked, /不要求 purge/);
  assert.doesNotMatch(picked, /合规清洗/);
  assert.equal(picked.includes("经自定义 API"), false);
  const chosen = textOf(
    renderToStaticMarkup(
      createElement(ModeBanner, {
        config: {
          ...config,
          dshConfigured: true,
          dshMissing: [],
          preferredTextRoute: "cliproxy",
          textRoute: "cliproxy",
          textRouteNote: "",
        },
      }),
    ),
  );
  assert.match(chosen, /出字经 OpenAI 兼容接口/);
  assert.match(chosen, /不经 purge/);
  assert.equal(chosen.includes("未配齐 DSH"), false);
  const customHtml = textOf(
    renderToStaticMarkup(
      createElement(ModeBanner, {
        config: {
          ...config,
          dshConfigured: true,
          dshMissing: [],
          preferredTextRoute: "custom",
          textRoute: "custom",
          textRouteNote: "",
          model: "deepseek-flash",
          baseUrl: "https://api.deepseek.com",
          customApi: {
            baseUrl: "https://api.deepseek.com",
            model: "deepseek-flash",
            apiKeyMask: "••••9999",
            configured: true,
            missing: [],
          },
        },
      }),
    ),
  );
  assert.match(customHtml, /出字经自定义 API/);
  assert.match(customHtml, /不经 purge/);
  assert.match(customHtml, /deepseek-flash/);
  assert.equal(customHtml.includes("••••9999"), false);
  assert.equal(customHtml.includes("未配齐 DSH"), false);
  const incomplete = textOf(
    renderToStaticMarkup(
      createElement(ModeBanner, {
        config: {
          ...config,
          demoMode: false,
          preferredTextRoute: "custom",
          textRoute: "custom",
          model: null,
          baseUrl: null,
          textRouteNote: "自定义 API 还没填全（缺 API Key）。请到设置里补上接口地址、API Key 和模型。这次不会改用环境里的 OpenAI 兼容接口，也不会换成演示稿。",
          customApi: {
            baseUrl: "https://api.deepseek.com",
            model: "deepseek-flash",
            apiKeyMask: "",
            configured: false,
            missing: ["API Key"],
          },
        },
      }),
    ),
  );
  assert.match(incomplete, /自定义 API 还没填全/);
  assert.match(incomplete, /不会改用环境里的 OpenAI 兼容接口/);
  assert.match(incomplete, /不会换成演示稿/);
  assert.equal(incomplete.includes("演示模式"), false);
});

test("empty API keys render a configure-API nudge instead of crashing", () => {
  const demo: PublicConfig = {
    ...config,
    demoMode: true,
    missing: ["OPENAI_BASE_URL", "OPENAI_API_KEY"],
    model: null,
    baseUrl: null,
    textRoute: "demo",
    dshConfigured: false,
    dshMissing: ["DSH_BASE_URL", "DSH_TOKEN", "DSH_SESSION_ID"],
    preferredTextRoute: "cliproxy",
    textRouteNote: "",
  };
  const html = renderToStaticMarkup(createElement(ModeBanner, { config: demo }));
  const text = textOf(html);
  assert.match(text, /请先配置 API/);
  assert.match(text, /不会因此崩溃/);
  assert.match(text, /OPENAI_BASE_URL/);
  assert.match(html, /href="\/settings"/);
  assert.equal(text.includes("出字经 OpenAI 兼容接口。"), false);
});

test("save failure before review says the readers never started", () => {
  assert.equal(reviewBlockedBySaveMessage(null, "没能保存。"), "稿子没保存，读者还没开始看。");
  assert.equal(reviewBlockedBySaveMessage("R18读者", "Failed to fetch"), "稿子没保存，R18读者还没开始看。");
  assert.equal(reviewBlockedBySaveMessage(null, "标题不能为空。"), "稿子没保存，读者还没开始看。标题不能为空。");
});

test("review http failure is distinct from a save failure", () => {
  const network = reviewRequestFailedMessage("怪物Z", new TypeError("Failed to fetch"));
  assert.equal(network, "怪物Z没看成。连接断了，意见没有写上。");
  assert.equal(network.includes("没能保存"), false);
  assert.equal(network.includes("还没开始看"), false);
  assert.equal(reviewRequestFailedMessage(null, new Error("生成失败。")), "读者没看成。请再试一次。");
  assert.equal(reviewRequestFailedMessage("中年男", new Error("没有这位读者。")), "中年男没看成。没有这位读者。");
});

test("a failed round trip does not drop opinions already on the page", () => {
  const older: ReviewNote = {
    id: "old",
    readerId: "r18",
    readerName: "R18读者",
    step: 2,
    versionId: "v1",
    text: "追读意愿还在",
    createdAt: "2026-01-01T00:00:00.000Z",
    triage: "unset",
    discussion: "",
  };
  const newer: ReviewNote = {
    id: "new",
    readerId: "monster",
    readerName: "怪物Z",
    step: 2,
    versionId: "v1",
    text: "这一场我喜欢",
    createdAt: "2026-01-02T00:00:00.000Z",
    triage: "adopted",
    discussion: "",
  };
  assert.deepEqual(keepReviews([older], []), [older]);
  assert.deepEqual(keepReviews([older], [older, newer]).map((note) => note.id), ["old", "new"]);
  assert.deepEqual(keepReviews([], [newer]), [newer]);
  const body = readerCardBody(older.text, "稿子没保存，读者还没开始看。");
  assert.equal(body.opinion, "追读意愿还在");
  assert.equal(body.error, "稿子没保存，读者还没开始看。");
  assert.deepEqual(readerCardBody("   ", "读者没看成。"), { opinion: null, error: "读者没看成。" });
  assert.equal(readerCardFailed({ message: "x", readerId: null }, "middle"), true);
  assert.equal(readerCardFailed({ message: "x", readerId: "r18" }, "middle"), false);
});

test("reader cards do not pretend a failed invite finished with an empty opinion", () => {
  const project = createProjectRecord({
    id: "p-readers",
    ownerId: "local",
    title: "回声",
    idea: "两个成年人重逢",
  });
  project.outline = "第一场他们见面。";
  project.reviews.push({
    id: "note-r18",
    readerId: "r18",
    readerName: "R18读者",
    step: 1,
    versionId: "",
    text: "追读意愿还在",
    createdAt: project.createdAt,
    triage: "unset",
    discussion: "",
  });
  const message = "稿子没保存，读者还没开始看。";
  const html = renderToStaticMarkup(
    createElement(StepPanels, {
      project,
      viewStep: 1,
      readers: defaultReaders(),
      feedback: "",
      busy: false,
      generating: "",
      onFeedback: () => undefined,
      onChange: () => undefined,
      onGenerate: () => undefined,
      onRevise: () => undefined,
      onReview: () => undefined,
      onReviewAll: () => undefined,
      onTriage: async () => true,
      onSaveOpinion: async () => true,
      onAmendOpinion: () => undefined,
      readerFailure: { message, readerId: null },
      onQuality: () => undefined,
      onRollback: () => undefined,
      onConfirm: () => undefined,
    }),
  );
  assert.equal(html.includes("还没有意见。"), false);
  assert.equal(html.includes("追读意愿还在"), true);
  assert.equal(html.includes(message), true);
  assert.equal(html.includes("再请一次"), true);
  assert.equal(html.includes("合规清洗"), false);
  assert.equal(html.includes("跑一次合规清洗"), false);
  assert.equal(html.includes('aria-invalid="true"'), true);
  assert.equal(reviewAllButtonLabel("", true), "再请一次");
  assert.equal(reviewOneButtonLabel(false, true, false), "再看一次");
  assert.equal(reviewOneButtonLabel(true, false, false), "在看…");
  assert.equal(html.includes("data-reader-triage=\"r18\""), true);
  assert.equal(html.includes("data-reader-triage=\"monster\""), false);
  assert.equal(html.includes("data-reader-triage=\"middle\""), false);
  assert.match(html, />\s*采纳\s*</);
  assert.match(html, />\s*忽略\s*</);
  assert.match(html, />\s*讨论\s*</);
  assert.equal(html.includes("请先采纳至少一条读者意见。"), true);
  assert.equal(html.includes(reviewTriageLabel("unset")), true);
  const revise = buttonOpeningTag(html, "revise-from-readers");
  assert.equal(hasDisabledAttribute(revise), true);
  assert.equal(html.includes("正在看…"), false);
});

test("triage stays off a card that is still being read", () => {
  const project = createProjectRecord({
    id: "p-wait",
    ownerId: "local",
    title: "回声",
    idea: "两个成年人重逢",
  });
  project.outline = "第一场他们见面。";
  const html = renderToStaticMarkup(
    createElement(StepPanels, {
      project,
      viewStep: 1,
      readers: defaultReaders(),
      feedback: "",
      busy: true,
      generating: "r18",
      onFeedback: () => undefined,
      onChange: () => undefined,
      onGenerate: () => undefined,
      onRevise: () => undefined,
      onReview: () => undefined,
      onReviewAll: () => undefined,
      onTriage: async () => true,
      onSaveOpinion: async () => true,
      onAmendOpinion: () => undefined,
      readerFailure: null,
      onQuality: () => undefined,
      onRollback: () => undefined,
      onConfirm: () => undefined,
    }),
  );
  assert.equal(html.includes("正在看…"), true);
  assert.equal(html.includes("data-reader-triage="), false);
  assert.doesNotMatch(html, />\s*采纳\s*</);
  assert.equal(html.includes("还没有意见。"), true);
});

test("an adopted opinion enables revise and shows the selected state", () => {
  const project = createProjectRecord({
    id: "p-adopted",
    ownerId: "local",
    title: "回声",
    idea: "两个成年人重逢",
  });
  project.outline = "第一场他们见面。";
  project.reviews.push({
    id: "note-r18",
    readerId: "r18",
    readerName: "R18读者",
    step: 1,
    versionId: "",
    text: "追读意愿还在",
    createdAt: project.createdAt,
    triage: "adopted",
    discussion: "",
  });
  const html = renderToStaticMarkup(
    createElement(StepPanels, {
      project,
      viewStep: 1,
      readers: defaultReaders(),
      feedback: "",
      busy: false,
      generating: "",
      onFeedback: () => undefined,
      onChange: () => undefined,
      onGenerate: () => undefined,
      onRevise: () => undefined,
      onReview: () => undefined,
      onReviewAll: () => undefined,
      onTriage: async () => true,
      onSaveOpinion: async () => true,
      onAmendOpinion: () => undefined,
      readerFailure: null,
      onQuality: () => undefined,
      onRollback: () => undefined,
      onConfirm: () => undefined,
    }),
  );
  assert.equal(html.includes("请先采纳至少一条读者意见。"), false);
  assert.equal(html.includes(reviewTriageLabel("adopted")), true);
  assert.match(html, /aria-pressed="true"/);
  const revise = buttonOpeningTag(html, "revise-from-readers");
  assert.equal(hasDisabledAttribute(revise), false);
});

test("the discuss form can save, amend, and adopt that opinion", () => {
  const note: ReviewNote = {
    id: "note-r18",
    readerId: "r18",
    readerName: "R18读者",
    step: 1,
    versionId: "",
    text: "追读意愿还在",
    createdAt: "2026-01-01T00:00:00.000Z",
    triage: "unset",
    discussion: "",
  };
  const html = renderToStaticMarkup(
    createElement(
      Dialog,
      { open: true },
      createElement(ReaderDiscussForm, {
        note,
        busy: false,
        amending: false,
        onSave: async () => true,
        onAmend: () => undefined,
        onTriage: async () => true,
        onClose: () => undefined,
      }),
    ),
  );
  assert.equal(html.includes("讨论这条意见"), true);
  assert.equal(html.includes("这条意见"), true);
  assert.equal(html.includes("你想怎么改"), true);
  assert.equal(html.includes("保存这条意见"), true);
  assert.equal(html.includes("让 AI 根据我的讨论改这条意见"), true);
  assert.equal(html.includes("采纳这条意见"), true);
  assert.equal(html.includes("追读意愿还在"), true);
});

function buttonOpeningTag(html: string, action: string): string {
  const match = html.match(new RegExp(`<button\\b(?=[^>]*data-action="${action}")[^>]*>`));
  assert.ok(match, `missing ${action} in ${html}`);
  return match[0];
}

function hasDisabledAttribute(tag: string): boolean {
  return /(?:^|\s)disabled(?:\s*=|\s|>|$)/.test(tag);
}
