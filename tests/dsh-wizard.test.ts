import assert from "node:assert/strict";
import test from "node:test";
import { applyAccountTextPolicy, accountSettingsFields, publicConfigForAccount } from "../lib/account-policy";
import { inspectDshConnection } from "../lib/dsh";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DshWizard } from "../components/dsh-wizard";
import { dshRouteDetail } from "../components/settings-desk";
import { complianceNoteForRoute } from "../lib/compliance";
import { projectToMarkdown } from "../lib/markdown";
import { createProjectRecord } from "../lib/pipeline";
import {
  DEFAULT_DSH_PROBE_PORTS,
  DSH_TOKEN_HELP,
  dshAdvancedSummary,
  dshReconnectNotice,
  dshSavedSummary,
  mergeDshEnv,
  parseDshBrowserUrl,
  parseDshConnectionPatch,
  probeLocalDshPorts,
  probePortsFromEnv,
  readDshTokenInput,
  toPublicDshConnection,
  emptyDshConnection,
} from "../lib/dsh-setup";
import { EMPTY_CUSTOM_API } from "../lib/custom-api";

const extras = { devPasswordHint: false, authConfigured: true };

test("the launch token is not a model key, and a dsh web url yields token plus origin", () => {
  assert.match(DSH_TOKEN_HELP, /不是模型的 API Key/);
  assert.match(DSH_TOKEN_HELP, /dsh web/);
  assert.match(DSH_TOKEN_HELP, /3080/);
  assert.deepEqual(readDshTokenInput("launch-token"), { token: "launch-token", baseUrl: "" });
  assert.deepEqual(readDshTokenInput("http://127.0.0.1:3080/?token=abc-def"), {
    token: "abc-def",
    baseUrl: "http://127.0.0.1:3080",
  });
  assert.deepEqual(readDshTokenInput("dsh web: http://127.0.0.1:3080/?token=abc-def"), {
    token: "abc-def",
    baseUrl: "http://127.0.0.1:3080",
  });
  const saved = parseDshConnectionPatch(
    { baseUrl: "http://127.0.0.1:3080/ui", token: "http://127.0.0.1:3080/?token=abc-def", sessionId: "sess-1" },
    emptyDshConnection(),
  );
  assert.equal(saved.ok, true);
  if (saved.ok) assert.equal(saved.connection.token, "abc-def");
});

test("default probe ports start at dsh web's 3080", () => {
  assert.deepEqual(DEFAULT_DSH_PROBE_PORTS, [3080, 3081, 3099]);
  assert.deepEqual(probePortsFromEnv({ DSH_PROBE_PORTS: "" }), [3080, 3081, 3099]);
  assert.deepEqual(probePortsFromEnv({ DSH_PROBE_PORTS: "3099" }), [3099]);
});

test("browser url becomes an origin and keeps basic auth out of the base url", () => {
  const plain = parseDshBrowserUrl("http://127.0.0.1:3099/ui/sessions?x=1#top");
  assert.equal(plain.ok, true);
  if (plain.ok) {
    assert.equal(plain.baseUrl, "http://127.0.0.1:3099");
    assert.equal(plain.basicUser, "");
  }
  const local = parseDshBrowserUrl("localhost:3081/app");
  assert.equal(local.ok, true);
  if (local.ok) assert.equal(local.baseUrl, "http://localhost:3081");
  const auth = parseDshBrowserUrl("http://ada:s3cret@127.0.0.1:3099/desk");
  assert.equal(auth.ok, true);
  if (auth.ok) {
    assert.equal(auth.baseUrl, "http://127.0.0.1:3099");
    assert.equal(auth.basicUser, "ada");
    assert.equal(auth.basicPassword, "s3cret");
  }
  const rejected = parseDshBrowserUrl("ftp://127.0.0.1/dsh");
  assert.equal(rejected.ok, false);
  assert.equal(parseDshBrowserUrl("").ok, false);
});

test("saved connection patch refuses secrets inside the base url", () => {
  const current = emptyDshConnection();
  const bad = parseDshConnectionPatch(
    { baseUrl: "http://ada:s3cret@127.0.0.1:3099", token: "tok", sessionId: "sess-1" },
    current,
  );
  assert.equal(bad.ok, false);
  const good = parseDshConnectionPatch(
    { baseUrl: "http://127.0.0.1:3099/ui", token: "tok", sessionId: "sess-1", basicUser: "ada", basicPassword: "s3cret" },
    current,
  );
  assert.equal(good.ok, true);
  if (good.ok) {
    assert.equal(good.connection.baseUrl, "http://127.0.0.1:3099");
    assert.equal(good.connection.basicPassword, "s3cret");
  }
});

test("probe records a miss without hanging", async () => {
  const fetchImpl = ((_url: string | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const abort = () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      };
      if (init?.signal?.aborted) abort();
      else init?.signal?.addEventListener("abort", abort, { once: true });
    })) as typeof fetch;
  const started = Date.now();
  const rows = await probeLocalDshPorts([3099, 3081], { fetchImpl, timeoutMs: 30 });
  assert.ok(Date.now() - started < 1_000);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.ok),
    [false, false],
  );
  assert.equal(rows[0]?.url, "http://127.0.0.1:3099");
  assert.equal(rows[0]?.error, "没有应答");
});

test("probe treats any http answer as a hit", async () => {
  const fetchImpl = (async () => new Response(null, { status: 401 })) as typeof fetch;
  const rows = await probeLocalDshPorts([3081], { fetchImpl, timeoutMs: 50 });
  assert.equal(rows[0]?.ok, true);
  assert.equal(rows[0]?.status, 401);
  assert.equal(rows[0]?.url, "http://127.0.0.1:3081");
});

test("inspect lists sessions and sends basic auth separately from the token", async () => {
  const seen: string[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const authorization = new Headers(init?.headers).get("authorization") ?? "";
    seen.push(authorization);
    if (url.includes("/connect")) {
      return new Response(null, { status: 302, headers: { "set-cookie": "dsh_api=abc; Path=/" } });
    }
    const body = JSON.parse(String(init?.body)) as { method?: string };
    if (body.method === "session/list") {
      return Response.json({ items: [{ sessionId: "sess-1", title: "稿", running: false }] });
    }
    if (body.method === "session/modelCatalog") {
      return Response.json({ routableProviders: [], groups: [] });
    }
    return new Response("no", { status: 500 });
  }) as typeof fetch;
  const result = await inspectDshConnection(
    { baseUrl: "http://127.0.0.1:3099/", token: "launch-token", basicUser: "ada", basicPassword: "s3cret" },
    { fetchImpl },
  );
  assert.equal(result.sessions[0]?.sessionId, "sess-1");
  assert.equal(result.sessions[0]?.title, "稿");
  assert.equal(result.sessions[0]?.running, false);
  assert.equal(result.catalog.loaded, true);
  const expected = `Basic ${Buffer.from("ada:s3cret", "utf8").toString("base64")}`;
  assert.ok(seen.length >= 2);
  assert.ok(seen.every((value) => value === expected));
  assert.equal(seen.some((value) => value.includes("launch-token")), false);
});

test("a saved wizard connection is the text route and the token stays out of public settings", () => {
  const token = "super-secret-token";
  const stored = {
    preferredTextRoute: "dsh" as const,
    customApi: { ...EMPTY_CUSTOM_API },
    dshModel: { provider: "deepseek-official", model: "deepseek-flash" },
    purgeEnabled: true,
    dsh: {
      baseUrl: "http://127.0.0.1:3099",
      token,
      sessionId: "sess-1",
      basicUser: "ada",
      basicPassword: "basic-pass-zz",
    },
  };
  const active = applyAccountTextPolicy("owner", stored, {});
  assert.equal(active.route, "dsh");
  assert.equal(active.ephemeralProvider, false);
  assert.equal(active.dshEnv?.DSH_BASE_URL, "http://127.0.0.1:3099");
  assert.equal(active.dshEnv?.DSH_SESSION_ID, "sess-1");
  assert.equal(active.dshEnv?.DSH_BASIC_USER, "ada");
  const fields = accountSettingsFields("owner", stored, {});
  assert.equal(fields.dshConfigured, true);
  assert.equal(fields.dshConnection.configured, true);
  assert.equal(fields.dshConnection.baseUrl, "http://127.0.0.1:3099");
  assert.equal(fields.dshConnection.sessionId, "sess-1");
  assert.equal(fields.dshConnection.hasBasicPassword, true);
  assert.equal(fields.purgeEnabled, false);
  const encoded = JSON.stringify(fields);
  assert.equal(encoded.includes(token), false);
  assert.equal(encoded.includes("basic-pass-zz"), false);
  assert.equal(toPublicDshConnection(stored.dsh).tokenMask.endsWith("oken"), true);
  const config = publicConfigForAccount("owner", stored, {}, extras);
  assert.equal(config.textRoute, "dsh");
  assert.equal(JSON.stringify(config).includes(token), false);
  const env = mergeDshEnv(stored, { DSH_BASE_URL: "http://env.example", DSH_TOKEN: "env", DSH_SESSION_ID: "env-session" });
  assert.equal(env?.DSH_BASE_URL, "http://127.0.0.1:3099");
  assert.equal(env?.DSH_SESSION_ID, "sess-1");
});

test("saved state, reconnect, and export notes do not show the session id", () => {
  const id = "session-7823138a-ec27-457b-aeea-89299ca28f2d";
  const line = dshSavedSummary({ baseUrl: "http://127.0.0.1:3080", tokenMask: "…fD5g" });
  assert.equal(line, "已保存 http://127.0.0.1:3080，令牌 …fD5g。");
  assert.equal(line.includes("会话"), false);
  assert.equal(line.includes(id), false);
  assert.equal(dshSavedSummary({ baseUrl: "http://127.0.0.1:3080" }), "已保存 http://127.0.0.1:3080。");
  assert.equal(dshAdvancedSummary(true), "高级：已指定模板会话");
  assert.equal(dshAdvancedSummary(true).includes(id), false);
  assert.equal(dshReconnectNotice(false).includes(id), false);
  assert.equal(dshReconnectNotice(true).includes(id), false);
  assert.match(dshReconnectNotice(true), /已新建围读专用会话/);
  assert.equal(dshRouteDetail(false).includes("再选会话"), false);
  assert.match(dshRouteDetail(false), /自己建专用会话/);
  const desk = readFileSync(new URL("../components/settings-desk.tsx", import.meta.url), "utf8");
  const wizardSource = readFileSync(new URL("../components/dsh-wizard.tsx", import.meta.url), "utf8");
  assert.equal(desk.includes("dshConnection.sessionId"), false);
  assert.equal(wizardSource.includes("{dedicatedSessionId}"), false);
  assert.equal(wizardSource.includes("${item.title} · ${item.sessionId}"), false);
  assert.match(wizardSource, /围读会自己建会话/);
  assert.match(wizardSource, /dshAdvancedSummary/);
  const wizard = renderToStaticMarkup(
    createElement(DshWizard, {
      onCancel() {},
      onSaved() {},
      onUseCustom() {},
    }),
  );
  assert.equal(wizard.includes(id), false);
  assert.match(wizard, /模型和专用会话/);
  const project = createProjectRecord({ id: "p-dsh", ownerId: "local", title: "稿", idea: "想法" });
  const markdown = projectToMarkdown(project, "full", { textRoute: "dsh", dshConfigured: true });
  assert.match(markdown, /出字经 DSH/);
  assert.equal(markdown.includes(id), false);
  assert.equal(complianceNoteForRoute("dsh", true).note.includes("session-"), false);
  const api = readFileSync(new URL("../content/api.md", import.meta.url), "utf8");
  assert.match(api, /不显示会话 id/);
  assert.equal(api.includes("选会话和模型"), false);
});
