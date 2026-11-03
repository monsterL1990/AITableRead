import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { settingsIntro } from "../components/settings-desk";
import { localUrl, readListenTarget, resolveBindHost, resolveBindPort } from "../scripts/listen.mjs";

test("the dev server binds loopback unless WEIDU_HOST is set", () => {
  assert.equal(resolveBindHost({}), "127.0.0.1");
  assert.equal(resolveBindHost({ WEIDU_HOST: "   " }), "127.0.0.1");
  assert.equal(resolveBindHost({ HOSTNAME: "0.0.0.0", HOST: "0.0.0.0" }), "127.0.0.1");
  assert.equal(resolveBindHost({ WEIDU_HOST: "0.0.0.0" }), "0.0.0.0");
  assert.equal(resolveBindPort({}), 4721);
  assert.equal(resolveBindPort({ PORT: " 4800 " }), 4800);
  assert.equal(localUrl("0.0.0.0", 4721), "http://127.0.0.1:4721");
  assert.equal(localUrl("::", 4721), "http://127.0.0.1:4721");
  assert.equal(localUrl("127.0.0.1", 4721), "http://127.0.0.1:4721");
  assert.throws(() => resolveBindHost({ WEIDU_HOST: "0.0.0.0 extra" }));
  assert.throws(() => resolveBindPort({ PORT: "0" }));
  assert.throws(() => resolveBindPort({ PORT: "4721abc" }));
});

test("listen address reads .env, then .env.local, then the process", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "weidu-listen-"));
  try {
    await writeFile(path.join(dir, ".env"), "WEIDU_HOST=\nPORT=4800\n# ignored\n");
    assert.equal(readListenTarget(dir, {}).host, "127.0.0.1");
    assert.equal(readListenTarget(dir, {}).port, 4800);

    await writeFile(path.join(dir, ".env"), 'WEIDU_HOST="0.0.0.0"\nPORT=4800\n');
    const fromFile = readListenTarget(dir, {});
    assert.equal(fromFile.host, "0.0.0.0");
    assert.equal(fromFile.url, "http://127.0.0.1:4800");

    await writeFile(path.join(dir, ".env.local"), "WEIDU_HOST=192.168.1.20\nPORT=4801\n");
    const fromLocal = readListenTarget(dir, {});
    assert.equal(fromLocal.host, "192.168.1.20");
    assert.equal(fromLocal.port, 4801);
    assert.equal(fromLocal.url, "http://192.168.1.20:4801");

    const fromProcess = readListenTarget(dir, { WEIDU_HOST: "127.0.0.1", PORT: "4721" });
    assert.deepEqual(
      { host: fromProcess.host, port: fromProcess.port, url: fromProcess.url },
      { host: "127.0.0.1", port: 4721, url: "http://127.0.0.1:4721" },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("settings copy recommends the OpenAI-compatible API and an empty key still boots", () => {
  const intro = settingsIntro("full");
  assert.match(intro, /推荐用你自己的 OpenAI 兼容接口/);
  assert.match(intro, /配置 API/);
  assert.match(intro, /不会崩溃/);
  assert.match(intro, /经 DSH 是可选项/);
  const custom = settingsIntro("custom-only");
  assert.match(custom, /OpenAI 兼容接口/);
  assert.match(custom, /密钥先空着也能打开页面/);
});
