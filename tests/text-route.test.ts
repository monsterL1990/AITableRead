import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { complianceHandoff } from "../lib/compliance";
import { projectToMarkdown } from "../lib/markdown";
import { createProjectRecord } from "../lib/pipeline";
import { describeTextRoute, parsePreferredTextRoute, publicConfigRouteFields, resolveTextRoute } from "../lib/text-route";

const both = {
  DSH_BASE_URL: "http://dsh.example:8080",
  DSH_TOKEN: "t",
  DSH_SESSION_ID: "s",
  OPENAI_BASE_URL: "http://llm.example/v1",
  OPENAI_API_KEY: "secret-key",
  OPENAI_MODEL: "grok-4.6",
};

test("preference defaults to dsh when DSH is configured", () => {
  assert.equal(resolveTextRoute(both), "dsh");
  assert.equal(resolveTextRoute(both, null), "dsh");
  const described = describeTextRoute(both, null);
  assert.equal(described.preferredTextRoute, "dsh");
  assert.equal(described.textRoute, "dsh");
  assert.equal(described.dshConfigured, true);
  assert.deepEqual(described.dshMissing, []);
  assert.equal(described.textRouteNote, "");
  const config = publicConfigRouteFields(both, null, { devPasswordHint: false, authConfigured: true });
  assert.equal(config.demoMode, false);
  assert.equal(config.textRoute, "dsh");
  assert.equal(config.preferredTextRoute, "dsh");
  assert.equal(config.model, null);
  assert.equal(config.baseUrl, null);
  assert.equal(JSON.stringify(config).includes("secret-key"), false);
});

test("cliproxy preference forces CLIProxy even when DSH is configured", () => {
  assert.equal(resolveTextRoute(both, "cliproxy"), "cliproxy");
  const described = describeTextRoute(both, "cliproxy");
  assert.equal(described.preferredTextRoute, "cliproxy");
  assert.equal(described.textRoute, "cliproxy");
  assert.equal(described.dshConfigured, true);
  assert.equal(described.textRouteNote, "");
  const config = publicConfigRouteFields(both, "cliproxy", { devPasswordHint: false, authConfigured: true });
  assert.equal(config.textRoute, "cliproxy");
  assert.equal(config.preferredTextRoute, "cliproxy");
  assert.equal(config.demoMode, false);
  assert.equal(config.model, "grok-4.6");
  assert.equal(config.baseUrl, "http://llm.example/v1");
  assert.equal(JSON.stringify(config).includes("secret-key"), false);
  const handoff = complianceHandoff(both, "cliproxy");
  assert.equal(handoff.provider, "cliproxy");
  assert.match(handoff.note, /出字经 CLIProxy/);
  assert.doesNotMatch(handoff.note, /未配齐 DSH/);
  const project = createProjectRecord({ id: "p-route", ownerId: "local", title: "回声", idea: "想法" });
  const markdown = projectToMarkdown(project, "current", { textRoute: "cliproxy", dshConfigured: true });
  assert.match(markdown, /出字经 CLIProxy/);
  assert.doesNotMatch(markdown, /未配齐 DSH/);
});

test("dsh preference is ignored when DSH is not configured", () => {
  const partial = {
    DSH_BASE_URL: "http://dsh.example:8080",
    DSH_TOKEN: "",
    DSH_SESSION_ID: "s",
    OPENAI_BASE_URL: "http://llm.example/v1",
    OPENAI_API_KEY: "k",
  };
  assert.equal(resolveTextRoute(partial, "dsh"), "cliproxy");
  const described = describeTextRoute(partial, "dsh");
  assert.equal(described.dshConfigured, false);
  assert.equal(described.preferredTextRoute, "dsh");
  assert.equal(described.textRoute, "cliproxy");
  assert.match(described.textRouteNote, /未配齐 DSH/);
  assert.match(described.textRouteNote, /DSH_TOKEN/);
  assert.match(described.textRouteNote, /CLIProxy/);
  const config = publicConfigRouteFields(partial, "dsh", { devPasswordHint: false, authConfigured: true });
  assert.equal(config.textRoute, "cliproxy");
  assert.equal(config.preferredTextRoute, "dsh");
  assert.equal(config.dshConfigured, false);
  assert.deepEqual(config.dshMissing, ["DSH_TOKEN"]);

  const nowhere = describeTextRoute({ DSH_BASE_URL: "", DSH_TOKEN: "", DSH_SESSION_ID: "" }, "dsh");
  assert.equal(nowhere.textRoute, "demo");
  assert.equal(nowhere.preferredTextRoute, "dsh");
  assert.match(nowhere.textRouteNote, /演示稿/);

  const unset = describeTextRoute(
    { OPENAI_BASE_URL: "http://llm.example/v1", OPENAI_API_KEY: "k" },
    null,
  );
  assert.equal(unset.preferredTextRoute, "cliproxy");
  assert.equal(unset.textRoute, "cliproxy");
  assert.equal(unset.textRouteNote, "");

  assert.equal(parsePreferredTextRoute("dsh", false).ok, false);
  assert.equal(parsePreferredTextRoute("cliproxy", false).ok, true);
  const customParsed = parsePreferredTextRoute("custom", false);
  assert.equal(customParsed.ok, true);
  if (customParsed.ok) assert.equal(customParsed.route, "custom");
  const accepted = parsePreferredTextRoute("dsh", true);
  assert.equal(accepted.ok, true);
  if (accepted.ok) assert.equal(accepted.route, "dsh");
});

test("generation resolves the stored preference while DSH stays configured", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gaojian-route-"));
  const file = path.join(dir, "store.json");
  const keys = ["GAOJIAN_DATA_FILE", "DSH_BASE_URL", "DSH_TOKEN", "DSH_SESSION_ID", "OPENAI_BASE_URL", "OPENAI_API_KEY", "OPENAI_MODEL"] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.GAOJIAN_DATA_FILE = file;
  process.env.DSH_BASE_URL = "http://dsh.example:8080";
  process.env.DSH_TOKEN = "t";
  process.env.DSH_SESSION_ID = "s";
  process.env.OPENAI_BASE_URL = "http://llm.example/v1";
  process.env.OPENAI_API_KEY = "k";
  process.env.OPENAI_MODEL = "grok-4.6";
  try {
    const { setPreferredTextRoute } = await import("../lib/store");
    const { resolveActiveTextRoute } = await import("../lib/active-text-route");
    assert.equal(await resolveActiveTextRoute(), "dsh");
    await setPreferredTextRoute("cliproxy");
    assert.equal(await resolveActiveTextRoute(), "cliproxy");
    await setPreferredTextRoute("dsh");
    assert.equal(await resolveActiveTextRoute(), "dsh");
    delete process.env.DSH_TOKEN;
    await setPreferredTextRoute("dsh");
    assert.equal(await resolveActiveTextRoute(), "cliproxy");
  } finally {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
