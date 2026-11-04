import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { catalog } from "../lib/i18n/catalog";
import { localeFromAcceptLanguage, parseLocale, resolveLocale } from "../lib/i18n/locale";
import { localize, translate } from "../lib/i18n/translate";
import { getUiLocale, setUiLocale } from "../lib/store";

test("accept-language prefers English only when English ranks first", () => {
  assert.equal(localeFromAcceptLanguage(null), "zh");
  assert.equal(localeFromAcceptLanguage(""), "zh");
  assert.equal(localeFromAcceptLanguage("zh-CN,zh;q=0.9,en;q=0.8"), "zh");
  assert.equal(localeFromAcceptLanguage("en-US,en;q=0.9,zh-CN;q=0.8"), "en");
  assert.equal(localeFromAcceptLanguage("fr-FR,fr;q=0.9"), "zh");
  assert.equal(localeFromAcceptLanguage("en;q=0,zh-CN;q=0.5"), "zh");
});

test("resolveLocale prefers the screen, then the saved choice, then the environment", () => {
  assert.equal(resolveLocale({ explicit: "en", stored: "zh", env: "zh", acceptLanguage: "zh-CN" }), "en");
  assert.equal(resolveLocale({ cookie: "en", stored: "zh", acceptLanguage: "zh-CN" }), "en");
  assert.equal(resolveLocale({ stored: "en", env: "zh", acceptLanguage: "zh-CN" }), "en");
  assert.equal(resolveLocale({ env: "en", acceptLanguage: "zh-CN" }), "en");
  assert.equal(resolveLocale({ env: "zh-CN", acceptLanguage: "en-US" }), "zh");
  assert.equal(resolveLocale({ env: "fr", acceptLanguage: "en" }), "en");
  assert.equal(resolveLocale({ acceptLanguage: "de" }), "zh");
  assert.equal(parseLocale("en-GB"), "en");
  assert.equal(parseLocale("zh_Hans"), "zh");
  assert.equal(parseLocale("ja"), null);
});

test("Chinese catalog values are what the interface shows, and English covers every id", () => {
  assert.equal(translate("zh", "home.title"), "稿单");
  assert.equal(translate("en", "home.title"), "Manuscripts");
  assert.equal(translate("zh", "home.deleteAsk", { title: "回声" }), "删除「回声」？");
  assert.equal(translate("en", "shell.accounts"), "Accounts");
  assert.equal(translate("en", "login.username"), "Username");
  for (const id of Object.keys(catalog)) {
    const [zh, en] = catalog[id as keyof typeof catalog];
    assert.equal(zh.length > 0, true, id);
    assert.equal(en.length > 0, true, id);
  }
});

test("stored and generated Chinese is translated at display time and left alone in Chinese", () => {
  assert.equal(localize("zh", "大纲修改2"), "大纲修改2");
  assert.equal(localize("en", "大纲修改2"), "Outline revision 2");
  assert.equal(localize("en", "刚刚"), "Just now");
  assert.equal(localize("en", "3 分钟前"), "3 min ago");
  assert.equal(localize("en", "2000–3500 字"), "2000–3500 chars");
  assert.equal(localize("en", "未配齐 DSH，出字不经 DSH。"), "DSH is not fully set up, so writing does not go through DSH.");
  assert.equal(
    localize("en", "未配齐 DSH（缺 DSH_TOKEN、DSH_SESSION_ID），出字不经 DSH。"),
    "DSH is not fully set up (missing DSH_TOKEN, DSH_SESSION_ID), so writing does not go through DSH.",
  );
  assert.equal(localize("en", "标题太长，请收到 80 字以内。"), "Title is too long. Keep it within 80 characters.");
  assert.equal(localize("en", "已连接模型 grok-4.6"), "Model connected: grok-4.6");
  assert.equal(localize("en", "正在按质检改…（已进行 3 分）"), "Revising from the checklist… (3 min so far)");
  assert.equal(localize("en", "正在按质检改…（已进行不到 1 分）"), "Revising from the checklist… (under 1 min so far)");
  assert.equal(localize("en", "确认大纲。当前停在第 2 步。"), "Confirmed Outline. Now on step 2.");
  assert.equal(localize("en", "从想法开稿。"), "Opened from an idea.");
  assert.equal(localize("en", "门外站着梁照。"), "门外站着梁照。");
  assert.equal(localize("en", "未登录"), "Not signed in.");
  assert.equal(
    localize("en", "稿子没保存，R18读者还没开始看。标题不能为空。"),
    "The manuscript wasn't saved, so R18读者 hasn't started. The title can't be empty.",
  );
});

test("the language choice is stored in the manuscript store", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "weidu-locale-"));
  const previous = process.env.GAOJIAN_DATA_FILE;
  process.env.GAOJIAN_DATA_FILE = path.join(dir, "store.json");
  try {
    assert.equal(await getUiLocale(), null);
    assert.equal(await setUiLocale("en"), "en");
    assert.equal(await getUiLocale(), "en");
    assert.equal(await setUiLocale("zh"), "zh");
    assert.equal(await getUiLocale(), "zh");
  } finally {
    if (previous === undefined) delete process.env.GAOJIAN_DATA_FILE;
    else process.env.GAOJIAN_DATA_FILE = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
