import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "node:test";
import { applyAccountTextPolicy, byokPurgeActive, lockPresetDsModel, presetDsModel, publicConfigForAccount, settingsWrite } from "../lib/account-policy";
import { ModeBanner } from "../components/mode-banner";
import { settingsIntro } from "../components/settings-desk";
import { DshWizard } from "../components/dsh-wizard";
import { NewAccountTypeField } from "../components/admin-desk";
import { complianceNoteForRoute } from "../lib/compliance";
import { ephemeralFailureMessage, redactCredential } from "../lib/dsh-ephemeral";
import { promptDshSession } from "../lib/dsh";
import { projectToMarkdown } from "../lib/markdown";
import { createProjectRecord } from "../lib/pipeline";
import { planGeneration } from "../lib/text-route";

const secret = "sk-byok-secret-9999-zzzz";
const dshEnv = { DSH_BASE_URL: "http://dsh.example:8080", DSH_TOKEN: "t", DSH_SESSION_ID: "session-1" };
const extras = { devPasswordHint: false, authConfigured: true };
const customApi = { baseUrl: "https://api.deepseek.com", apiKey: secret, model: "deepseek-flash" };

function textOf(html: string) {
  return html.replace(/<[^>]+>/g, "");
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

function ok(value: unknown) {
  return json({ type: "server-response", result: { ok: true, value } });
}

function fail(message: string, code?: string) {
  return json({ type: "server-response", result: { ok: false, error: { message, ...(code ? { code } : {}) } } });
}

type Call = { method: string; args: unknown; body: string };

function connectOr(handle: (method: string, args: unknown, body: string) => Response | Promise<Response>): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    if (url.includes("/connect")) {
      return new Response(null, { status: 302, headers: { "set-cookie": "dsh_api=abc; Path=/" } });
    }
    const body = String(init?.body ?? "");
    const parsed = JSON.parse(body) as { method?: string; payload?: { args?: unknown } };
    return handle(parsed.method ?? "", parsed.payload?.args, body);
  };
}

function listedSessions() {
  return {
    items: [
      {
        sessionId: "session-1",
        running: false,
        projections: { kind: "sequenced", asOfSeq: 1, values: { agentPreset: "gaojian-purge" } },
      },
      {
        sessionId: "job-1",
        running: false,
        agentAvailable: true,
        projections: { kind: "sequenced", asOfSeq: 2, values: {} },
      },
    ],
  };
}

test("account policy keeps preset on station DSH and does not force purge for a custom key", () => {
  const stored = {
    preferredTextRoute: "custom" as const,
    customApi,
    dshModel: { provider: "deepseek-official", model: "deepseek-flash" },
    purgeEnabled: true,
  };
  const preset = applyAccountTextPolicy("preset-grok", stored, dshEnv);
  assert.equal(preset.route, "dsh");
  assert.equal(preset.ephemeralProvider, false);
  assert.deepEqual(preset.dshModel, { provider: "xai-oauth", model: "grok-4.7" });
  assert.equal(preset.customApi.apiKey, "");
  assert.equal(planGeneration(preset.route, preset.customApi, dshEnv, { ephemeralProvider: preset.ephemeralProvider }).transport, "dsh");

  const direct = applyAccountTextPolicy("custom", { ...stored, purgeEnabled: false }, dshEnv);
  assert.equal(direct.route, "custom");
  assert.equal(direct.ephemeralProvider, false);
  assert.equal(direct.dshModel, null);
  const directPlan = planGeneration(direct.route, direct.customApi, dshEnv, { ephemeralProvider: direct.ephemeralProvider });
  assert.equal(directPlan.transport, "custom");

  const purged = applyAccountTextPolicy("custom", stored, dshEnv);
  assert.equal(purged.route, "custom");
  assert.equal(purged.ephemeralProvider, false);
  assert.equal(planGeneration(purged.route, purged.customApi, dshEnv, { ephemeralProvider: purged.ephemeralProvider }).transport, "custom");

  const ownerDirect = applyAccountTextPolicy("owner", { ...stored, preferredTextRoute: "dsh", purgeEnabled: true }, dshEnv);
  assert.equal(ownerDirect.route, "dsh");
  assert.equal(ownerDirect.ephemeralProvider, false);
  const ownerByok = applyAccountTextPolicy("owner", stored, dshEnv);
  assert.equal(ownerByok.route, "custom");
  assert.equal(ownerByok.ephemeralProvider, false);

  assert.throws(
    () => planGeneration("custom", customApi, {}, { ephemeralProvider: true }),
    (error: Error) => {
      assert.match(error.message, /未配齐 DSH/);
      assert.match(error.message, /不会改成直连/);
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );
  assert.throws(
    () => planGeneration("custom", { ...customApi, apiKey: "" }, dshEnv, { ephemeralProvider: true }),
    (error: Error) => {
      assert.match(error.message, /自定义 API 还没填全/);
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );
});

test("purge is not stored as a required switch and stays out of the public payload", async () => {
  const presetWrite = settingsWrite("preset-grok", { purgeEnabled: true });
  assert.equal(settingsWrite("preset-ds", { purgeEnabled: true }).ok, false);
  assert.equal(presetWrite.ok, false);
  const customWrite = settingsWrite("custom", { purgeEnabled: true });
  assert.equal(customWrite.ok, false);
  if (!customWrite.ok) assert.match(customWrite.error, /不要求 purge/);
  const ownerWrite = settingsWrite("owner", { purgeEnabled: false });
  assert.equal(ownerWrite.ok, false);
  if (!ownerWrite.ok) assert.match(ownerWrite.error, /不要求 purge/);

  const dir = await mkdtemp(path.join(tmpdir(), "gaojian-byok-"));
  const previous = process.env.GAOJIAN_DATA_FILE;
  process.env.GAOJIAN_DATA_FILE = path.join(dir, "store.json");
  try {
    const store = await import("../lib/store");
    assert.equal((await store.getSettings("ada")).purgeEnabled, false);
    await store.updateTextSettings(
      { preferredTextRoute: "custom", customApi, purgeEnabled: true },
      "ada",
    );
    await store.updateTextSettings(
      { preferredTextRoute: "cliproxy", customApi: { baseUrl: "https://api.deepseek.com", apiKey: "owner-key-should-stay", model: "m" }, purgeEnabled: false },
      "local",
    );
    const saved = await store.getSettings("ada");
    assert.equal(saved.purgeEnabled, false);
    assert.equal(saved.customApi.apiKey, secret);
    assert.equal((await store.getSettings("local")).purgeEnabled, false);
    assert.equal((await store.getSettings("local")).customApi.apiKey, "owner-key-should-stay");
    const raw = await readFile(process.env.GAOJIAN_DATA_FILE, "utf8");
    const parsed = JSON.parse(raw) as { workspaces?: { ada?: { settings?: { purgeEnabled?: boolean; customApi?: { apiKey?: string } } } } };
    assert.equal(parsed.workspaces?.ada?.settings?.purgeEnabled, false);
    assert.equal(parsed.workspaces?.ada?.settings?.customApi?.apiKey, secret);
    assert.equal(raw.includes("settings.update"), false);
    assert.equal(saved.customApi.apiKey, secret);

    const config = publicConfigForAccount("custom", saved, dshEnv, extras);
    const encoded = JSON.stringify(config);
    assert.equal(encoded.includes(secret), false);
    assert.equal(config.purgeEnabled, false);
    assert.equal(config.customApi.apiKeyMask.endsWith("zzzz"), true);
    assert.equal("apiKey" in config.customApi, false);
    assert.equal(byokPurgeActive(config), false);
    const banner = textOf(renderToStaticMarkup(createElement(ModeBanner, { config })));
    assert.match(banner, /不经 purge/);
    assert.equal(banner.includes("临时 provider"), false);
    assert.equal(banner.includes("合规清洗"), false);
  } finally {
    if (previous === undefined) delete process.env.GAOJIAN_DATA_FILE;
    else process.env.GAOJIAN_DATA_FILE = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("settings copy no longer requires purge", () => {
  const wizard = textOf(
    renderToStaticMarkup(
      createElement(DshWizard, {
        onCancel() {},
        onSaved() {},
        onUseCustom() {},
      }),
    ),
  );
  assert.match(wizard, /你有自己的 DSH 吗/);
  assert.match(wizard, /没有，去用自定义接口/);
  assert.match(wizard, /粘贴浏览器里的 DSH 地址/);
  assert.doesNotMatch(wizard, /合规清洗|经 DSH purge|custom-api-purge/);
  const intro = settingsIntro("full");
  assert.match(intro, /不要求 purge/);
  assert.doesNotMatch(intro, /经 DSH purge/);
  const project = createProjectRecord({ id: "p-byok", ownerId: "ada", title: "回声", idea: "想法" });
  const markdown = projectToMarkdown(project, "current", { textRoute: "custom", dshConfigured: true, byokPurge: true });
  assert.match(markdown, /不经 purge/);
  assert.doesNotMatch(markdown, /合规清洗随/);
  assert.match(complianceNoteForRoute("custom", true, false).note, /不经 purge/);
  assert.match(complianceNoteForRoute("dsh", true).note, /不要求 purge/);
  assert.doesNotMatch(complianceNoteForRoute("dsh", true).note, /合规清洗/);
});

test("ephemeral provider attaches, selects, prompts, then detaches without echoing the key", async () => {
  const calls: Call[] = [];
  let requestId = "";
  let polls = 0;
  const fetchImpl = connectOr((method, args, body) => {
    calls.push({ method, args, body });
    const request = (args as { request?: Record<string, unknown> } | undefined)?.request;
    if (method === "session/list") return ok(listedSessions());
    if (method === "session/create") {
      assert.equal(request?.agentPreset, "gaojian-purge");
      assert.equal(body.includes(secret), false);
      return ok({ sessionId: "job-1" });
    }
    if (method === "ephemeralProvider/attach") {
      assert.equal(request?.provider, undefined);
      assert.equal(request?.baseUrl, "https://api.deepseek.com");
      assert.equal(request?.apiKey, secret);
      assert.equal(request?.model, "deepseek-flash");
      assert.equal(request?.api, "openai-completions");
      return ok({
        ok: true,
        providerId: "ephemeral-norm-job-1",
        sessionId: "job-1",
        model: "deepseek-flash",
        api: "openai-completions",
        baseUrl: "https://api.deepseek.com",
        expiresAt: "2026-10-28T16:00:00.000Z",
        ttlMs: 7_200_000,
      });
    }
    if (method === "session/selectModel") {
      assert.equal(request?.provider, "ephemeral-norm-job-1");
      assert.equal(request?.model, "deepseek-flash");
      assert.equal(body.includes(secret), false);
      return ok({ selected: { provider: request?.provider, model: request?.model } });
    }
    if (method === "session/prompt") {
      assert.equal(body.includes(secret), false);
      requestId = /稿间请求 ([0-9a-f-]+)/.exec(String((request?.content as { text?: string }[] | undefined)?.[0]?.text ?? ""))?.[1] ?? "";
      return ok({ accepted: true });
    }
    if (method === "session/page") {
      polls += 1;
      return ok({
        records: [
          { event: { type: "user/message", data: { content: [{ type: "text", text: `稿间请求 ${requestId}` }] } } },
          { event: { type: "assistant/message", data: { message: { content: [{ type: "text", text: "门外站着梁照。" }] } } } },
        ],
      });
    }
    if (method === "ephemeralProvider/detach") {
      assert.equal(request?.sessionId, "job-1");
      assert.equal(request?.providerId, undefined);
      assert.equal(body.includes(secret), false);
      return ok({ ok: true, detached: true, providerId: "ephemeral-norm-job-1", sessionId: "job-1", reason: "explicit" });
    }
    if (method === "session/models" || method.includes("settings")) throw new Error(`不该调用 ${method}`);
    throw new Error(`意外的调用 ${method}`);
  });
  let clock = 0;
  const text = await promptDshSession(
    { user: "写一节。" },
    {
      env: dshEnv,
      fetchImpl,
      sleep: async () => undefined,
      now: () => (clock += 1000),
      ephemeralCredential: customApi,
    },
  );
  assert.equal(text, "门外站着梁照。");
  assert.equal(polls >= 2, true);
  const at = (method: string) => calls.findIndex((call) => call.method === method);
  const createAt = at("session/create");
  const attachAt = at("ephemeralProvider/attach");
  const selectAt = at("session/selectModel");
  const promptAt = at("session/prompt");
  const detachAt = at("ephemeralProvider/detach");
  assert.equal(createAt >= 0 && createAt < attachAt && attachAt < selectAt && selectAt < promptAt && promptAt < detachAt, true);
  assert.equal(calls.some((call) => call.method.includes("settings")), false);
  assert.equal(calls.some((call) => call.method === "session/cancel"), false);
});

test("ephemeral failures stay explicit and still detach after a successful attach", async () => {
  assert.equal(ephemeralFailureMessage(`INVALID_CREDENTIAL ${secret}`, secret).includes(secret), false);
  assert.match(ephemeralFailureMessage("unknown method", secret), /DSH ephemeral provider 未就绪/);
  assert.match(ephemeralFailureMessage("gateway/bad-request"), /没有通过 DSH 校验/);
  assert.match(ephemeralFailureMessage("session/model-unavailable"), /已经卸下/);
  assert.match(ephemeralFailureMessage("上游返回 503"), /上游返回 503/);
  assert.match(ephemeralFailureMessage("model-unavailable"), /已经卸下/);
  assert.equal(redactCredential(`token ${secret} end`, secret).includes(secret), false);

  async function run(handle: (method: string, args: unknown, body: string) => Response | Promise<Response>) {
    const calls: string[] = [];
    const fetchImpl = connectOr((method, args, body) => {
      calls.push(method);
      if (method === "session/list") return ok(listedSessions());
      if (method === "session/create") return ok({ sessionId: "job-1" });
      return handle(method, args, body);
    });
    let clock = 0;
    await promptDshSession(
      { user: "写一节。" },
      { env: dshEnv, fetchImpl, sleep: async () => undefined, now: () => (clock += 1000), ephemeralCredential: customApi },
    );
    return calls;
  }

  await assert.rejects(
    () => run((method) => (method === "ephemeralProvider/attach" ? fail(`unknown method ${secret}`) : fail("不该到这"))),
    (error: Error) => {
      assert.match(error.message, /DSH ephemeral provider 未就绪/);
      assert.match(error.message, /没有改成直连/);
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );

  const missing = await run((method) => {
    if (method === "ephemeralProvider/attach") return fail(`gateway/bad-request ${secret}`);
    if (method === "session/prompt") throw new Error(`不该调用 ${method}`);
    if (method === "ephemeralProvider/detach") return ok({ ok: true, detached: false, reason: "absent" });
    return fail("不该到这");
  }).then(
    () => {
      throw new Error("应该失败");
    },
    (error: Error) => error,
  );
  assert.match(missing.message, /没有通过 DSH 校验/);
  assert.equal(missing.message.includes(secret), false);

  const selectCalls: string[] = [];
  await assert.rejects(
    () =>
      run((method) => {
        selectCalls.push(method);
        if (method === "ephemeralProvider/attach") {
          return ok({ providerId: "ephemeral-norm-job-1", model: "deepseek-flash" });
        }
        if (method === "session/selectModel") return fail("session/model-unavailable");
        if (method === "ephemeralProvider/detach") return ok({ detached: true });
        if (method === "session/cancel") return ok({ accepted: true });
        if (method === "session/prompt") throw new Error("不该提交");
        return fail(`意外 ${method}`);
      }),
    /已经卸下/,
  );
  assert.equal(selectCalls.includes("session/prompt"), false);
  assert.equal(selectCalls.includes("ephemeralProvider/detach"), true);
  assert.equal(selectCalls.includes("settings.update"), false);

  await assert.rejects(
    () =>
      run((method, _args, body) => {
        if (method === "ephemeralProvider/attach") return ok({ providerId: "ephemeral-norm-job-1", model: "deepseek-flash" });
        if (method === "session/selectModel") {
          assert.equal(body.includes(secret), false);
          return ok({ selected: true });
        }
        if (method === "session/prompt") return fail(`上游返回 503 ${secret}`);
        if (method === "ephemeralProvider/detach") return ok({ detached: true });
        if (method === "session/cancel") return ok({ accepted: true });
        return fail(`意外 ${method}`);
      }),
    (error: Error) => {
      assert.match(error.message, /上游返回 503/);
      assert.match(error.message, /没有改成直连/);
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );

  await assert.rejects(
    () =>
      promptDshSession(
        { user: "写一节。" },
        {
          env: dshEnv,
          sleep: async () => undefined,
          ephemeralCredential: customApi,
          fetchImpl: connectOr((method) => {
            if (method === "session/list") {
              return ok({ items: [{ sessionId: "session-1", running: false, agentPreset: "gaojian-purge" }] });
            }
            if (method === "session/create") return new Response("missing", { status: 404 });
            if (method === "ephemeralProvider/attach") throw new Error("不该把 Key 挂到共享会话");
            return ok({});
          }),
        },
      ),
    /不会挂到共享会话/,
  );
});

test("preset deepseek is locked to a catalog model and every new workspace gets the same readers", async () => {
  const stored = {
    preferredTextRoute: "custom" as const,
    customApi,
    dshModel: null,
    purgeEnabled: true,
  };
  const ds = applyAccountTextPolicy("preset-ds", stored, dshEnv);
  assert.equal(ds.route, "dsh");
  assert.equal(ds.ephemeralProvider, false);
  assert.equal(ds.mustMatchCatalog, true);
  assert.deepEqual(ds.dshModel, { provider: "deepseek-official", model: "deepseek-flash" });
  assert.equal(ds.customApi.apiKey, "");
  assert.deepEqual(
    presetDsModel({ GAOJIAN_PRESET_DS_PROVIDER: "deepseek-official", GAOJIAN_PRESET_DS_MODEL: "deepseek-v4-pro" }),
    { provider: "deepseek-official", model: "deepseek-v4-pro" },
  );
  const catalog = {
    routableProviders: ["deepseek-official", "xai-oauth"],
    groups: [
      { id: "deepseek-official", name: "DeepSeek", models: [{ id: "deepseek-flash", name: "flash" }] },
      { id: "xai-oauth", name: "xAI", models: [{ id: "grok-4.7", name: "grok" }] },
    ],
  };
  const locked = await lockPresetDsModel(ds, { readCatalog: async () => catalog });
  assert.deepEqual(locked.dshModel, { provider: "deepseek-official", model: "deepseek-flash" });
  await assert.rejects(
    () =>
      lockPresetDsModel(
        { ...ds, dshModel: { provider: "deepseek-official", model: "deepseek-v4-pro" } },
        { readCatalog: async () => catalog },
      ),
    /不在当前 DSH 目录里/,
  );
  await assert.rejects(
    () => lockPresetDsModel(ds, { readCatalog: async () => { throw new Error("down"); } }),
    /没拉下来/,
  );
  const grok = applyAccountTextPolicy("preset-grok", stored, dshEnv);
  let called = false;
  const skipped = await lockPresetDsModel(grok, {
    readCatalog: async () => {
      called = true;
      return catalog;
    },
  });
  assert.equal(called, false);
  assert.equal(skipped.mustMatchCatalog, false);
  assert.equal(skipped.dshModel?.model, "grok-4.7");
  const shown = publicConfigForAccount("preset-ds", stored, dshEnv, extras);
  assert.equal(shown.accountType, "preset-ds");
  assert.equal(shown.settingsVisibility, "hidden");
  assert.equal(shown.dshModel?.model, "deepseek-flash");
  assert.equal(JSON.stringify(shown).includes(secret), false);
  const banner = textOf(renderToStaticMarkup(createElement(ModeBanner, { config: shown })));
  assert.match(banner, /预设 DeepSeek/);
  assert.equal(banner.includes("/settings"), false);

  const choices = textOf(renderToStaticMarkup(createElement(NewAccountTypeField, { type: "preset-ds" })));
  assert.match(choices, /预设 Grok/);
  assert.match(choices, /预设 DeepSeek/);
  assert.match(choices, /非预设/);
  assert.match(choices, /不要求 purge/);
  assert.doesNotMatch(choices, /经 DSH purge/);

  const dir = await mkdtemp(path.join(tmpdir(), "gaojian-readers-"));
  const previous = process.env.GAOJIAN_DATA_FILE;
  process.env.GAOJIAN_DATA_FILE = path.join(dir, "store.json");
  try {
    const store = await import("../lib/store");
    await store.updateTextSettings({ purgeEnabled: false }, "ada");
    await store.updateTextSettings({ purgeEnabled: false }, "bao");
    const names = (await store.listReaders("ada")).map((reader) => reader.name);
    assert.deepEqual(names, ["R18读者", "怪物Z", "中年男"]);
    assert.deepEqual(
      (await store.listReaders("bao")).map((reader) => reader.name),
      names,
    );
  } finally {
    if (previous === undefined) delete process.env.GAOJIAN_DATA_FILE;
    else process.env.GAOJIAN_DATA_FILE = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
