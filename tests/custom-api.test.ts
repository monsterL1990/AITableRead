import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { complianceHandoff, complianceNoteForRoute } from "../lib/compliance";
import { DEEPSEEK_OPENAI_BASE_URL, DEEPSEEK_PRESET_MODEL, customSelectionError, maskApiKey, parseCustomApiPatch } from "../lib/custom-api";
import { routeMark } from "../lib/format";
import { chatCompletionsUrl, streamChat } from "../lib/llm";
import { projectToMarkdown } from "../lib/markdown";
import { createProjectRecord } from "../lib/pipeline";
import { draftReaderFromSpec } from "../lib/reader-spec";
import { describeTextRoute, planGeneration, publicConfigRouteFields, resolveTextRoute } from "../lib/text-route";
import type { CustomApiConfig } from "../lib/types";

const both = {
  DSH_BASE_URL: "http://dsh.example:8080",
  DSH_TOKEN: "t",
  DSH_SESSION_ID: "s",
  OPENAI_BASE_URL: "http://llm.example/v1",
  OPENAI_API_KEY: "env-cliproxy-key",
  OPENAI_MODEL: "grok-4.6",
};

const secret = "sk-deepseek-secret-9999";
const custom: CustomApiConfig = {
  baseUrl: "https://api.deepseek.com",
  apiKey: secret,
  model: "deepseek-flash",
};

test("custom preference stays on the custom API even when DSH and CLIProxy are ready", () => {
  assert.equal(resolveTextRoute(both, "custom"), "custom");
  assert.equal(resolveTextRoute(both, "dsh"), "dsh");
  assert.equal(resolveTextRoute(both, "cliproxy"), "cliproxy");
  assert.equal(DEEPSEEK_OPENAI_BASE_URL, "https://api.deepseek.com");
  assert.equal(chatCompletionsUrl(DEEPSEEK_OPENAI_BASE_URL), "https://api.deepseek.com/chat/completions");
  assert.equal(chatCompletionsUrl("https://api.deepseek.com/v1"), "https://api.deepseek.com/v1/chat/completions");
  assert.equal(DEEPSEEK_PRESET_MODEL, "deepseek-flash");

  const described = describeTextRoute(both, "custom", custom);
  assert.equal(described.textRoute, "custom");
  assert.equal(described.preferredTextRoute, "custom");
  assert.equal(described.textRouteNote, "");
  assert.equal(described.customApi.configured, true);
  assert.equal(described.customApi.apiKeyMask, maskApiKey(secret));
  assert.equal(described.customApi.apiKeyMask, "••••9999");
  assert.equal(JSON.stringify(described).includes(secret), false);
  assert.equal(JSON.stringify(described).includes("env-cliproxy-key"), false);
  assert.equal("apiKey" in described.customApi, false);

  const config = publicConfigRouteFields(both, "custom", { devPasswordHint: false, authConfigured: true }, custom);
  assert.equal(config.demoMode, false);
  assert.equal(config.textRoute, "custom");
  assert.equal(config.model, "deepseek-flash");
  assert.equal(config.baseUrl, "https://api.deepseek.com");
  assert.notEqual(config.model, "grok-4.6");
  assert.equal(config.customApi.apiKeyMask, "••••9999");
  assert.equal(JSON.stringify(config).includes(secret), false);
  assert.equal(JSON.stringify(config).includes("env-cliproxy-key"), false);

  const incomplete = describeTextRoute(both, "custom", { baseUrl: "https://api.deepseek.com", apiKey: "", model: "deepseek-flash" });
  assert.equal(incomplete.textRoute, "custom");
  assert.equal(resolveTextRoute(both, "custom"), "custom");
  assert.match(incomplete.textRouteNote, /缺 API Key/);
  assert.match(incomplete.textRouteNote, /不会改用 CLIProxy/);
  assert.match(incomplete.textRouteNote, /不会换成演示稿/);
  const incompleteConfig = publicConfigRouteFields(
    both,
    "custom",
    { devPasswordHint: false, authConfigured: true },
    { baseUrl: "https://api.deepseek.com", apiKey: secret, model: "" },
  );
  assert.equal(incompleteConfig.demoMode, false);
  assert.equal(incompleteConfig.textRoute, "custom");
  assert.notEqual(incompleteConfig.model, "grok-4.6");
  assert.equal(JSON.stringify(incompleteConfig).includes("deepseek-secret"), false);

  const handoff = complianceHandoff(both, "custom");
  assert.equal(handoff.provider, "custom");
  assert.match(handoff.note, /出字经自定义 API/);
  assert.match(handoff.note, /不经 purge/);
  assert.equal(complianceNoteForRoute("custom", true).provider, "custom");
  const project = createProjectRecord({ id: "p-custom", ownerId: "local", title: "回声", idea: "想法" });
  const markdown = projectToMarkdown(project, "current", { textRoute: "custom", dshConfigured: true });
  assert.match(markdown, /出字经自定义 API/);
  assert.match(markdown, /不经 purge/);
  assert.doesNotMatch(markdown, /出字经 CLIProxy/);
  assert.equal(routeMark("custom"), "经自定义 API");
  assert.match(customSelectionError({ baseUrl: "https://api.deepseek.com", apiKey: "", model: "deepseek-flash" }) ?? "", /缺 API Key/);
  assert.match(customSelectionError({ baseUrl: "", apiKey: "", model: "" }) ?? "", /还不能选这条/);
  assert.equal(customSelectionError(custom), null);
});

test("generation plan uses the saved custom endpoint and refuses an incomplete one", () => {
  const customPlan = planGeneration("custom", custom, both);
  assert.equal(customPlan.transport, "custom");
  if (customPlan.transport !== "custom") return;
  assert.equal(customPlan.llm.baseUrl, "https://api.deepseek.com");
  assert.equal(customPlan.llm.apiKey, secret);
  assert.equal(customPlan.llm.model, "deepseek-flash");
  assert.equal(customPlan.llm.kind, "custom");
  assert.notEqual(customPlan.llm.apiKey, both.OPENAI_API_KEY);

  const dshPlan = planGeneration("dsh", custom, both);
  assert.equal(dshPlan.transport, "dsh");
  const cliproxyPlan = planGeneration("cliproxy", custom, both);
  assert.equal(cliproxyPlan.transport, "cliproxy");
  if (cliproxyPlan.transport !== "cliproxy") return;
  assert.equal(cliproxyPlan.llm.apiKey, "env-cliproxy-key");
  assert.equal(cliproxyPlan.llm.model, "grok-4.6");
  assert.equal(planGeneration("demo", custom, both).transport, "demo");

  assert.throws(
    () => planGeneration("custom", { baseUrl: "", apiKey: secret, model: "" }, both),
    (error: Error) => {
      assert.match(error.message, /不会改用 CLIProxy/);
      assert.match(error.message, /不会换成演示稿/);
      assert.equal(error.message.includes(secret), false);
      assert.equal(error.message.includes("env-cliproxy-key"), false);
      return true;
    },
  );
});

test("custom streaming calls the saved chat completions endpoint and hides the key", async () => {
  const plan = planGeneration("custom", custom, both);
  assert.equal(plan.transport, "custom");
  if (plan.transport !== "custom") return;
  let seenUrl = "";
  let seenAuth = "";
  let seenModel = "";
  const text = await streamChat(
    {
      system: "写正文",
      user: "门外站着梁照。",
      temperature: 0.4,
      onDelta() {},
      fetchImpl: async (input, init) => {
        seenUrl = String(input);
        const headers = init?.headers as { authorization?: string };
        seenAuth = headers.authorization ?? "";
        seenModel = (JSON.parse(String(init?.body)) as { model?: string }).model ?? "";
        return new Response(JSON.stringify({ error: { message: `rejected ${secret}` } }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      },
    },
    plan.llm,
  ).catch((error: unknown) => error);
  assert.equal(seenUrl, "https://api.deepseek.com/chat/completions");
  assert.equal(seenAuth, `Bearer ${secret}`);
  assert.equal(seenModel, "deepseek-flash");
  assert.equal(seenAuth.includes(both.OPENAI_API_KEY), false);
  assert.ok(text instanceof Error);
  assert.match(text.message, /拒绝了密钥/);
  assert.equal(text.message.includes(secret), false);

  let streamed = "";
  const ok = await streamChat(
    {
      system: "写正文",
      user: "门外站着梁照。",
      temperature: 0.4,
      onDelta: (piece) => {
        streamed += piece;
      },
      fetchImpl: async () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "门外" } }] })}\n\n`));
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "先想一下" } }] })}\n\n`),
            );
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "站着梁照。" } }] })}\n\n`));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });
        return new Response(stream, { headers: { "content-type": "text/event-stream" } });
      },
    },
    plan.llm,
  );
  assert.equal(ok, "门外站着梁照。");
  assert.equal(streamed, "门外站着梁照。");
  assert.equal(ok.includes("先想一下"), false);
});

test("masked custom settings round-trip in the store and blank keys are kept", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gaojian-custom-"));
  const file = path.join(dir, "store.json");
  const previous = process.env.GAOJIAN_DATA_FILE;
  process.env.GAOJIAN_DATA_FILE = file;
  try {
    const store = await import("../lib/store");
    const { resolveActiveTextRoute } = await import("../lib/active-text-route");
    await store.updateTextSettings({
      preferredTextRoute: "custom",
      customApi: custom,
    });
    assert.equal(await resolveActiveTextRoute(), "custom");
    const saved = await store.getSettings();
    assert.equal(saved.customApi.apiKey, secret);
    const raw = JSON.parse(await readFile(file, "utf8")) as {
      workspaces?: { local?: { settings?: { customApi?: { apiKey?: string } } } };
    };
    assert.equal(raw.workspaces?.local?.settings?.customApi?.apiKey, secret);
    const described = describeTextRoute(undefined, saved.preferredTextRoute, saved.customApi);
    assert.equal(JSON.stringify(described).includes("deepseek-secret"), false);
    assert.equal(described.customApi.apiKeyMask, "••••9999");

    const kept = parseCustomApiPatch({ baseUrl: "https://api.deepseek.com/v1", model: "deepseek-v4-pro", apiKey: "" }, saved.customApi);
    assert.equal(kept.ok, true);
    if (!kept.ok) return;
    assert.equal(kept.config.apiKey, secret);
    assert.equal(kept.config.baseUrl, "https://api.deepseek.com/v1");
    assert.equal(kept.config.model, "deepseek-v4-pro");
    const cleared = parseCustomApiPatch({ baseUrl: kept.config.baseUrl, model: kept.config.model, clearApiKey: true }, kept.config);
    assert.equal(cleared.ok, true);
    if (!cleared.ok) return;
    assert.equal(cleared.config.apiKey, "");
    const leaked = parseCustomApiPatch({ baseUrl: `https://example.test/?k=${secret}`, model: "deepseek-flash", apiKey: secret }, saved.customApi);
    assert.equal(leaked.ok, false);

    await store.setPreferredTextRoute("dsh");
    assert.equal((await store.getSettings()).preferredTextRoute, "dsh");
    assert.equal((await store.getSettings()).customApi.apiKey, secret);
    process.env.DSH_BASE_URL = "http://dsh.example:8080";
    process.env.DSH_TOKEN = "t";
    process.env.DSH_SESSION_ID = "s";
    assert.equal(await resolveActiveTextRoute(), "dsh");
  } finally {
    if (previous === undefined) delete process.env.GAOJIAN_DATA_FILE;
    else process.env.GAOJIAN_DATA_FILE = previous;
    delete process.env.DSH_BASE_URL;
    delete process.env.DSH_TOKEN;
    delete process.env.DSH_SESSION_ID;
    await rm(dir, { recursive: true, force: true });
  }
});

test("drafting a reader on the custom route uses that endpoint and does not pretend to be demo", async () => {
  await assert.rejects(
    () =>
      draftReaderFromSpec(
        { requirement: "看节拍有没有被跳过", files: [{ name: "a.md", bytes: new TextEncoder().encode("节拍要写细。") }] },
        { route: "custom", customApi: { baseUrl: "https://api.deepseek.com", apiKey: "", model: "deepseek-flash" } },
      ),
    (error: Error) => {
      assert.match(error.message, /自定义 API 还没填全/);
      assert.match(error.message, /不会换成演示稿/);
      assert.doesNotMatch(error.message, /演示模式不会假装/);
      return true;
    },
  );

  let seenAuth = "";
  const drafted = await draftReaderFromSpec(
    { requirement: "看节拍有没有被跳过", files: [] },
    {
      route: "custom",
      customApi: custom,
      fetchImpl: async (_input, init) => {
        const headers = init?.headers as { authorization?: string };
        seenAuth = headers.authorization ?? "";
        const body = JSON.parse(String(init?.body)) as { model?: string };
        assert.equal(body.model, "deepseek-flash");
        assert.notEqual(headers.authorization, "Bearer env-cliproxy-key");
        return Response.json({
          choices: [{ message: { content: JSON.stringify({ name: "节拍读者", blurb: "盯节拍。", prompt: "指出跳过的节拍。" }) } }],
        });
      },
    },
  );
  assert.equal(drafted.name, "节拍读者");
  assert.equal(seenAuth, `Bearer ${secret}`);
});
