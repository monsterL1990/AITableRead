import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, test } from "node:test";
import {
  applyAccountTextPolicy,
  publicConfigForAccount,
  settingsSections,
  settingsWrite,
} from "../lib/account-policy";
import {
  createAccount,
  hashPassword,
  listAccounts,
  loginWithPassword,
  removeAccount,
  resolveSessionAccount,
  updateAccount,
  validateNewUid,
  verifyPassword,
} from "../lib/accounts";
import { ModeBanner } from "../components/mode-banner";
import { createSessionToken, verifySessionToken } from "../lib/session";
import { planGeneration } from "../lib/text-route";
import { EMPTY_CUSTOM_API } from "../lib/custom-api";

const secret = "owner-secret-key";
const friendPassword = "correct-horse";
const dshEnv = { DSH_BASE_URL: "http://dsh.example:8080", DSH_TOKEN: "t", DSH_SESSION_ID: "s" };
const extras = { devPasswordHint: false, authConfigured: true };

function textOf(html: string) {
  return html.replace(/<[^>]+>/g, "");
}

async function withAccounts(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), "gaojian-accounts-"));
  const previous = {
    GAOJIAN_DATA_FILE: process.env.GAOJIAN_DATA_FILE,
    GAOJIAN_ACCOUNTS_FILE: process.env.GAOJIAN_ACCOUNTS_FILE,
    APP_PASSWORD: process.env.APP_PASSWORD,
  };
  process.env.GAOJIAN_DATA_FILE = path.join(dir, "store.json");
  process.env.GAOJIAN_ACCOUNTS_FILE = path.join(dir, "accounts.json");
  process.env.APP_PASSWORD = "owner-secret";
  try {
    await run(dir);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
}

test("uid rules reserve system names and keep the owner id", () => {
  assert.equal(validateNewUid("ab"), null);
  assert.equal(validateNewUid("a"), "账号要以小写字母开头，后面用小写字母、数字、下划线或短横线，一共 2 到 32 个字符。");
  assert.match(validateNewUid("1abc") ?? "", /小写字母开头/);
  for (const name of ["admin", "owner", "canary", "root", "dsh", "local"]) {
    assert.match(validateNewUid(name) ?? "", /留给系统/);
  }
});

test("passwords are stored as salted hashes", async () => {
  const hashed = await hashPassword(friendPassword);
  assert.notEqual(hashed.hash, friendPassword);
  assert.equal(await verifyPassword(friendPassword, hashed.hash, hashed.salt), true);
  assert.equal(await verifyPassword("wrong-horse", hashed.hash, hashed.salt), false);
  assert.equal(await verifyPassword(friendPassword, hashed.hash, "other-salt"), false);
});

test("session tokens remember the credential version", async () => {
  const token = await createSessionToken("ada", Date.now(), 3);
  const session = await verifySessionToken(token);
  assert.equal(session?.uid, "ada");
  assert.equal(session?.credentialVersion, 3);
  const legacy = await verifySessionToken(await createSessionToken("local"));
  assert.equal(legacy?.uid, "local");
  assert.equal(legacy?.credentialVersion, 0);
});

describe("account files", { concurrency: 1 }, () => {
test("owner still logs in with APP_PASSWORD, friends use their own hash", async () => {
  await withAccounts(async (dir) => {
    const blank = await loginWithPassword({ password: "owner-secret" });
    assert.equal(blank.ok, true);
    if (blank.ok) assert.equal(blank.user.uid, "local");

    const owner = await loginWithPassword({ uid: "Local", password: "owner-secret" });
    assert.equal(owner.ok, true);
    if (owner.ok) {
      assert.equal(owner.user.type, "owner");
      assert.equal(owner.user.credentialVersion, 0);
    }
    const wrong = await loginWithPassword({ uid: "local", password: friendPassword });
    assert.equal(wrong.ok, false);
    if (!wrong.ok) assert.equal(wrong.status, 401);

    const created = await createAccount({ uid: "Ada", password: friendPassword, display: "阿达", type: "preset" });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.account.uid, "ada");
    assert.equal(created.account.type, "preset-grok");
    const raw = await readFile(path.join(dir, "accounts.json"), "utf8");
    assert.equal(raw.includes(friendPassword), false);
    assert.equal(raw.includes("owner-secret"), false);

    const friend = await loginWithPassword({ uid: "ada", password: friendPassword });
    assert.equal(friend.ok, true);
    if (friend.ok) assert.equal(friend.user.type, "preset-grok");
    const ownerPasswordOnFriend = await loginWithPassword({ uid: "ada", password: "owner-secret" });
    assert.equal(ownerPasswordOnFriend.ok, false);

    const stopped = await updateAccount("ada", { disabled: true });
    assert.equal(stopped.ok, true);
    const blocked = await loginWithPassword({ uid: "ada", password: friendPassword });
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.status, 403);

    const enabled = await updateAccount("ada", { disabled: false });
    assert.equal(enabled.ok, true);
    const reset = await updateAccount("ada", { password: "brand-new-pass" });
    assert.equal(reset.ok, true);
    const old = await loginWithPassword({ uid: "ada", password: friendPassword });
    assert.equal(old.ok, false);
    const again = await loginWithPassword({ uid: "ada", password: "brand-new-pass" });
    assert.equal(again.ok, true);
    if (!again.ok) return;
    const stale = await resolveSessionAccount("ada", 1);
    assert.equal(stale, null);
    const current = await resolveSessionAccount("ada", again.user.credentialVersion);
    assert.equal(current?.type, "preset-grok");
    assert.equal(current?.disabled, false);

    const listed = await listAccounts();
    assert.equal(JSON.stringify(listed).includes(friendPassword), false);
    assert.equal(JSON.stringify(listed).includes("hash"), false);
    assert.equal(listed[0]?.uid, "local");
    assert.equal(listed.some((account) => account.uid === "ada" && account.display === "阿达"), true);

    const reserved = await createAccount({ uid: "dsh", password: friendPassword, type: "custom" });
    assert.equal(reserved.ok, false);
    const ownerType = await createAccount({ uid: "guest", password: friendPassword, type: "owner" });
    assert.equal(ownerType.ok, false);
    const ownerReset = await updateAccount("local", { password: "another-pass" });
    assert.equal(ownerReset.ok, false);

    const custom = await createAccount({ uid: "bee", password: friendPassword, type: "custom" });
    assert.equal(custom.ok, true);
    const productionFriend = await loginWithPassword({ uid: "bee", password: friendPassword }, { NODE_ENV: "production" });
    assert.equal(productionFriend.ok, true);
    const productionOwner = await loginWithPassword({ uid: "local", password: "owner-secret" }, { NODE_ENV: "production" });
    assert.equal(productionOwner.ok, false);
    if (!productionOwner.ok) assert.equal(productionOwner.status, 503);
  });
});

test("projects, readers, and custom keys stay inside one uid", async () => {
  await withAccounts(async (dir) => {
    const created = await createAccount({ uid: "ada", password: friendPassword, type: "custom" });
    assert.equal(created.ok, true);
    const store = await import("../lib/store");
    await store.updateTextSettings(
      { preferredTextRoute: "custom", customApi: { baseUrl: "https://api.deepseek.com", apiKey: secret, model: "deepseek-flash" } },
      "local",
    );
    await store.updateTextSettings(
      { preferredTextRoute: "custom", customApi: { baseUrl: "https://example.test", apiKey: "friend-key", model: "other" } },
      "ada",
    );
    assert.equal((await store.getSettings("local")).customApi.apiKey, secret);
    assert.equal((await store.getSettings("ada")).customApi.apiKey, "friend-key");
    const friendProject = await store.createProject("ada", { title: "阿达的稿", startFrom: "idea", idea: "两个成年人" });
    const ownerProject = await store.createProject("local", { title: "站长的稿", startFrom: "idea", idea: "两个成年人" });
    assert.equal((await store.listProjects("local")).some((project) => project.id === friendProject.id), false);
    assert.equal((await store.listProjects("ada")).some((project) => project.id === ownerProject.id), false);
    const added = await store.createReader({ name: "阿达的读者", blurb: "", prompt: "只看阿达的稿。" }, "ada");
    assert.equal((await store.listReaders("local")).some((reader) => reader.id === added.id), false);
    assert.equal((await store.listReaders("ada")).some((reader) => reader.id === added.id), true);

    await store.purgeUserData("ada");
    assert.equal(await store.getProject("ada", friendProject.id), null);
    assert.equal((await store.getSettings("ada")).customApi.apiKey, "");
    assert.equal((await store.getProject("local", ownerProject.id))?.title, "站长的稿");
    const removed = await removeAccount("ada");
    assert.equal(removed.ok, true);
    const file = await readFile(path.join(dir, "store.json"), "utf8");
    assert.equal(file.includes("friend-key"), false);
    assert.equal(file.includes(secret), true);
  });
});

test("a version 2 store migrates onto the owner workspace", async () => {
  await withAccounts(async () => {
    const store = await import("../lib/store");
    await writeFile(
      process.env.GAOJIAN_DATA_FILE!,
      JSON.stringify({
        version: 2,
        prompts: { outline: "站长的大纲提示" },
        settings: {
          preferredTextRoute: "cliproxy",
          customApi: { baseUrl: "https://api.deepseek.com", apiKey: secret, model: "deepseek-flash" },
          dshModel: null,
        },
        projects: [],
      }),
    );
    assert.equal((await store.getSettings("local")).preferredTextRoute, "cliproxy");
    assert.equal((await store.getSettings("local")).customApi.apiKey, secret);
    assert.equal((await store.getSettings("ada")).customApi.apiKey, "");
    assert.match((await store.getPromptOverrides("local")).outline ?? "", /站长的大纲提示/);
    assert.equal((await store.getPromptOverrides("ada")).outline, undefined);
  });
});
});

test("preset accounts are forced onto station DSH Grok and custom accounts stay on their key", () => {
  const stored = {
    preferredTextRoute: "custom" as const,
    customApi: { baseUrl: "https://api.deepseek.com", apiKey: secret, model: "deepseek-flash" },
    dshModel: { provider: "deepseek-official", model: "deepseek-flash" },
    purgeEnabled: false,
  };
  assert.throws(() => applyAccountTextPolicy("preset-grok", stored, {}), /预设账号只经 DSH/);
  const preset = applyAccountTextPolicy("preset-grok", stored, dshEnv);
  assert.equal(preset.route, "dsh");
  assert.deepEqual(preset.dshModel, { provider: "xai-oauth", model: "grok-4.7" });
  assert.equal(preset.customApi.apiKey, "");
  assert.equal(JSON.stringify(preset).includes(secret), false);
  const plan = planGeneration(preset.route, preset.customApi, dshEnv);
  assert.equal(plan.transport, "dsh");

  const custom = applyAccountTextPolicy("custom", { ...stored, preferredTextRoute: "dsh" }, dshEnv);
  assert.equal(custom.route, "custom");
  assert.equal(custom.dshModel, null);
  assert.equal(custom.customApi.apiKey, secret);
  assert.equal(planGeneration(custom.route, custom.customApi).transport, "custom");

  const owner = applyAccountTextPolicy(
    "owner",
    { ...stored, preferredTextRoute: "cliproxy" },
    { ...dshEnv, OPENAI_BASE_URL: "http://llm.example/v1", OPENAI_API_KEY: "k" },
  );
  assert.equal(owner.route, "cliproxy");
  assert.equal(owner.dshModel?.model, "deepseek-flash");
});

test("settings visibility and write rules follow the account type", () => {
  assert.deepEqual(settingsSections("hidden"), {
    showSettingsNav: false,
    showRoutePicker: false,
    showDshModel: false,
    showCustomApi: false,
  });
  assert.deepEqual(settingsSections("custom-only"), {
    showSettingsNav: true,
    showRoutePicker: false,
    showDshModel: false,
    showCustomApi: true,
  });
  assert.deepEqual(settingsSections("full"), {
    showSettingsNav: true,
    showRoutePicker: true,
    showDshModel: true,
    showCustomApi: true,
  });

  const presetWrite = settingsWrite("preset-grok", { preferredTextRoute: "cliproxy" });
  assert.equal(presetWrite.ok, false);
  const routeWrite = settingsWrite("custom", { preferredTextRoute: "dsh" });
  assert.equal(routeWrite.ok, false);
  const modelWrite = settingsWrite("custom", { dshModel: { provider: "xai-oauth", model: "grok-4.7" } });
  assert.equal(modelWrite.ok, false);
  const customWrite = settingsWrite("custom", {
    customApi: { baseUrl: "https://api.deepseek.com", apiKey: secret, model: "deepseek-flash" },
  });
  assert.equal(customWrite.ok, true);
  if (customWrite.ok) {
    assert.equal(customWrite.patch.preferredTextRoute, "custom");
    assert.equal(customWrite.patch.dshModel, null);
  }
  const ownerWrite = settingsWrite("owner", { preferredTextRoute: "dsh" });
  assert.equal(ownerWrite.ok, true);
  if (ownerWrite.ok) assert.equal("dshModel" in ownerWrite.patch, false);
});

test("mode banner hides settings for preset accounts and keeps custom accounts off DSH", () => {
  const stored = {
    preferredTextRoute: "custom" as const,
    customApi: { baseUrl: "https://api.deepseek.com", apiKey: secret, model: "deepseek-flash" },
    dshModel: { provider: "deepseek-official", model: "deepseek-flash" },
    purgeEnabled: false,
  };
  const preset = publicConfigForAccount("preset-grok", stored, dshEnv, extras);
  assert.equal(preset.settingsVisibility, "hidden");
  assert.equal(preset.textRoute, "dsh");
  assert.equal(preset.dshModel?.model, "grok-4.7");
  assert.equal(JSON.stringify(preset).includes(secret), false);
  const presetHtml = renderToStaticMarkup(createElement(ModeBanner, { config: preset }));
  assert.equal(presetHtml.includes('href="/settings"'), false);
  assert.match(textOf(presetHtml), /预设 Grok/);
  assert.match(presetHtml, /grok-4\.7/);

  const custom = publicConfigForAccount("custom", stored, dshEnv, extras);
  assert.equal(custom.settingsVisibility, "custom-only");
  assert.equal(custom.preferredTextRoute, "custom");
  assert.equal(custom.dshModel, null);
  assert.equal(JSON.stringify(custom).includes(secret), false);
  const customText = textOf(renderToStaticMarkup(createElement(ModeBanner, { config: custom })));
  assert.match(customText, /只用自己的密钥/);
  assert.equal(customText.includes("要改走"), false);
  assert.match(customText, /不经 purge/);

  const missing = publicConfigForAccount(
    "preset-grok",
    { preferredTextRoute: null, customApi: { ...EMPTY_CUSTOM_API }, dshModel: null, purgeEnabled: false },
    {},
    extras,
  );
  assert.match(missing.textRouteNote, /还没配齐 DSH/);
  assert.equal(missing.textRoute, "dsh");
});
