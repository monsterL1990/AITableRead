import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogFromValue, matchDshModel, parseModelCatalog } from "../lib/dsh-catalog";
import { promptDshSession, readDshModelCatalog } from "../lib/dsh";

const sample = {
  default: { provider: "xai-oauth", model: "grok-4.7" },
  routableProviders: ["deepseek-official", "xai-oauth"],
  groups: [
    {
      id: "deepseek-official",
      name: "DeepSeek",
      models: [{ id: "deepseek-flash", name: "DeepSeek-V4.1-Flash-1017" }],
    },
    {
      id: "xai-oauth",
      name: "xAI",
      models: [{ id: "grok-4.7", name: "grok-4.7" }],
    },
    {
      id: "not-routable",
      name: "别的",
      models: [{ id: "hidden", name: "不该出现" }],
    },
  ],
  failures: [{ id: "offline", name: "离线提供方", message: "连接超时" }],
};

function json(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

test("the settings catalog keeps routable models and the kernel default", () => {
  const parsed = parseModelCatalog(sample);
  assert.deepEqual(
    parsed.options.map((item) => [item.provider, item.model, item.name]),
    [
      ["deepseek-official", "deepseek-flash", "DeepSeek-V4.1-Flash-1017"],
      ["xai-oauth", "grok-4.7", "grok-4.7"],
    ],
  );
  assert.equal(parsed.options.some((item) => item.model === "hidden"), false);
  assert.equal(parsed.defaultModel?.provider, "xai-oauth");
  assert.equal(parsed.defaultModel?.model, "grok-4.7");
  assert.equal(parsed.failures[0]?.provider, "offline");
  const view = catalogFromValue(sample);
  assert.equal(view.loaded, true);
  const picked = matchDshModel({ provider: "deepseek-official", model: "deepseek-flash" }, view.options);
  assert.equal(picked.ok, true);
  if (picked.ok) assert.deepEqual(picked.model, { provider: "deepseek-official", model: "deepseek-flash" });
  assert.equal(matchDshModel({ provider: "not-routable", model: "hidden" }, view.options).ok, false);
  assert.equal(matchDshModel({ provider: "deepseek-official", model: "deepseek-chat" }, view.options).ok, false);
});

test("a chosen DSH model is selected on the new session before the prompt", async () => {
  const methods: string[] = [];
  let selected: { sessionId?: string; provider?: string; model?: string } = {};
  let requestId = "";
  let clock = 0;
  const env = { DSH_BASE_URL: "http://dsh.example:8080", DSH_TOKEN: "t", DSH_SESSION_ID: "session-1" };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/connect")) {
      return new Response(null, { status: 302, headers: { "set-cookie": "dsh_api=abc; HttpOnly; Path=/" } });
    }
    const body = JSON.parse(String(init?.body)) as {
      method?: string;
      payload?: { args?: { request?: { sessionId?: string; provider?: string; model?: string; content?: { text?: string }[]; address?: { sessionId?: string } } } };
    };
    methods.push(body.method ?? url);
    const request = body.payload?.args?.request;
    if (body.method === "session/modelCatalog") {
      return json({ type: "server-response", result: { ok: true, value: sample } });
    }
    if (body.method === "session/list") {
      return json({
        type: "server-response",
        result: {
          ok: true,
          value: {
            items: [
              { sessionId: "session-1", running: false, projections: { kind: "sequenced", asOfSeq: 1, values: { agentPreset: "gaojian-purge" } } },
              { sessionId: "job-1", running: false, agentAvailable: true, projections: { kind: "sequenced", asOfSeq: 2, values: {} } },
            ],
          },
        },
      });
    }
    if (body.method === "session/create") {
      return json({ type: "server-response", result: { ok: true, value: { sessionId: "job-1", agentPreset: "gaojian-purge" } } });
    }
    if (body.method === "session/selectModel") {
      selected = { sessionId: request?.sessionId, provider: request?.provider, model: request?.model };
      return json({ type: "server-response", result: { ok: true, value: { selected: { provider: request?.provider, model: request?.model } } } });
    }
    if (body.method === "session/prompt") {
      assert.equal(request?.sessionId, "job-1");
      requestId = /稿间请求 ([0-9a-f-]+)/.exec(request?.content?.[0]?.text ?? "")?.[1] ?? "";
      return json({ type: "server-response", result: { ok: true, value: { accepted: true } } });
    }
    if (body.method === "session/page") {
      return json({
        type: "server-response",
        result: {
          ok: true,
          value: {
            records: [
              { event: { type: "user/message", data: { content: [{ type: "text", text: `稿间请求 ${requestId}` }] } } },
              { event: { type: "assistant/message", data: { message: { content: [{ type: "text", text: "门外站着梁照。" }] } } } },
            ],
          },
        },
      });
    }
    throw new Error(`意外的调用 ${body.method ?? url}`);
  };
  const catalog = await readDshModelCatalog({ env, fetchImpl });
  assert.equal(parseModelCatalog(catalog).options[0]?.model, "deepseek-flash");
  const text = await promptDshSession(
    { user: "写一节。" },
    { env, fetchImpl, sleep: async () => undefined, now: () => (clock += 1000), model: { provider: "deepseek-official", model: "deepseek-flash" } },
  );
  assert.equal(text, "门外站着梁照。");
  assert.deepEqual(selected, { sessionId: "job-1", provider: "deepseek-official", model: "deepseek-flash" });
  const selectAt = methods.indexOf("session/selectModel");
  const promptAt = methods.indexOf("session/prompt");
  assert.equal(selectAt >= 0 && promptAt > selectAt, true);

  methods.length = 0;
  await assert.rejects(
    () =>
      promptDshSession(
        { user: "写一节。" },
        {
          env,
          sleep: async () => undefined,
          model: { provider: "deepseek-official", model: "deepseek-flash" },
          fetchImpl: async (input, init) => {
            const url = String(input);
            if (url.includes("/connect")) return new Response(null, { status: 302, headers: { "set-cookie": "dsh_api=abc; Path=/" } });
            const body = JSON.parse(String(init?.body)) as { method?: string };
            methods.push(body.method ?? "");
            if (body.method === "session/list") {
              return json({
                type: "server-response",
                result: { ok: true, value: { items: [{ sessionId: "session-1", running: false, agentPreset: "gaojian-purge" }] } },
              });
            }
            if (body.method === "session/create") {
              return json({ type: "server-response", result: { ok: true, value: { sessionId: "job-2" } } });
            }
            if (body.method === "session/selectModel") {
              return json({ type: "server-response", result: { ok: false, error: { message: "session/model-unavailable" } } });
            }
            if (body.method === "session/cancel") {
              return json({ type: "server-response", result: { ok: true, value: { accepted: true } } });
            }
            if (body.method === "session/prompt") throw new Error("不该提交");
            throw new Error(`意外的调用 ${body.method ?? url}`);
          },
        },
      ),
    /没有提交/,
  );
  assert.equal(methods.includes("session/prompt"), false);
  assert.equal(methods.includes("session/cancel"), true);
});

test("a new DSH session copies the template model when the user did not pick one", async () => {
  const methods: string[] = [];
  let selected: { sessionId?: string; provider?: string; model?: string } = {};
  let requestId = "";
  let clock = 0;
  const env = { DSH_BASE_URL: "http://dsh.example:8080", DSH_TOKEN: "t", DSH_SESSION_ID: "session-1" };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/connect")) return new Response(null, { status: 302, headers: { "set-cookie": "dsh_api=abc; Path=/" } });
    const body = JSON.parse(String(init?.body)) as {
      method?: string;
      payload?: { args?: { request?: { sessionId?: string; provider?: string; model?: string; content?: { text?: string }[] } } };
    };
    methods.push(body.method ?? "");
    const request = body.payload?.args?.request;
    if (body.method === "session/list") {
      return json({
        type: "server-response",
        result: {
          ok: true,
          value: {
            items: [
              { sessionId: "session-1", running: false, agentPreset: "gaojian-purge" },
              { sessionId: "job-1", running: false, agentAvailable: true, projections: { kind: "sequenced", asOfSeq: 2, values: {} } },
            ],
          },
        },
      });
    }
    if (body.method === "session/create") {
      return json({ type: "server-response", result: { ok: true, value: { sessionId: "job-1" } } });
    }
    if (body.method === "session/models") {
      assert.equal(request?.sessionId, "session-1");
      return json({
        type: "server-response",
        result: { ok: true, value: { current: { provider: "xai-oauth", model: "grok-4.7" }, routable: true, groups: [], failures: [] } },
      });
    }
    if (body.method === "session/selectModel") {
      selected = { sessionId: request?.sessionId, provider: request?.provider, model: request?.model };
      return json({ type: "server-response", result: { ok: true, value: { selected } } });
    }
    if (body.method === "session/prompt") {
      requestId = /稿间请求 ([0-9a-f-]+)/.exec(request?.content?.[0]?.text ?? "")?.[1] ?? "";
      return json({ type: "server-response", result: { ok: true, value: { accepted: true } } });
    }
    if (body.method === "session/page") {
      return json({
        type: "server-response",
        result: {
          ok: true,
          value: {
            records: [
              { event: { type: "user/message", data: { content: [{ type: "text", text: `稿间请求 ${requestId}` }] } } },
              { event: { type: "assistant/message", data: { message: { content: [{ type: "text", text: "沿用模板模型。" }] } } } },
            ],
          },
        },
      });
    }
    if (body.method === "session/cancel") return json({ type: "server-response", result: { ok: true, value: { accepted: true } } });
    throw new Error(`意外的调用 ${body.method ?? url}`);
  };
  const text = await promptDshSession({ user: "写一节。" }, { env, fetchImpl, sleep: async () => undefined, now: () => (clock += 1000) });
  assert.equal(text, "沿用模板模型。");
  assert.deepEqual(selected, { sessionId: "job-1", provider: "xai-oauth", model: "grok-4.7" });
  assert.equal(methods.indexOf("session/selectModel") < methods.indexOf("session/prompt"), true);

  methods.length = 0;
  let seenId = "";
  const skipped = await promptDshSession(
    { user: "写一节。" },
    {
      env,
      sleep: async () => undefined,
      now: () => (clock += 1000),
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.includes("/connect")) return new Response(null, { status: 302, headers: { "set-cookie": "dsh_api=abc; Path=/" } });
        const body = JSON.parse(String(init?.body)) as {
          method?: string;
          payload?: { args?: { request?: { content?: { text?: string }[] } } };
        };
        methods.push(body.method ?? "");
        if (body.method === "session/models") return json({ type: "server-response", result: { ok: false, error: { message: "没有这个方法" } } });
        if (body.method === "session/selectModel") throw new Error("不该选模");
        if (body.method === "session/list") {
          return json({
            type: "server-response",
            result: {
              ok: true,
              value: {
                items: [
                  { sessionId: "session-1", running: false, agentPreset: "gaojian-purge" },
                  { sessionId: "job-3", running: false, agentAvailable: true, projections: { kind: "sequenced", asOfSeq: 1, values: {} } },
                ],
              },
            },
          });
        }
        if (body.method === "session/create") return json({ type: "server-response", result: { ok: true, value: { sessionId: "job-3" } } });
        if (body.method === "session/prompt") {
          seenId = /稿间请求 ([0-9a-f-]+)/.exec(body.payload?.args?.request?.content?.[0]?.text ?? "")?.[1] ?? "";
          return json({ type: "server-response", result: { ok: true, value: { accepted: true } } });
        }
        if (body.method === "session/page") {
          return json({
            type: "server-response",
            result: {
              ok: true,
              value: {
                records: [
                  { event: { type: "user/message", data: { content: [{ type: "text", text: `稿间请求 ${seenId}` }] } } },
                  { event: { type: "assistant/message", data: { message: { content: [{ type: "text", text: "仍可出字。" }] } } } },
                ],
              },
            },
          });
        }
        throw new Error(`意外的调用 ${body.method ?? url}`);
      },
    },
  );
  assert.equal(methods.includes("session/selectModel"), false);
  assert.equal(methods.includes("session/prompt"), true);
  assert.equal(skipped, "仍可出字。");
});
