import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { authEnabled } from "../lib/auth-mode";
import { prepareDeskEnv } from "../scripts/desk-env.mjs";
import {
  BUNDLED_NODE_VERSION,
  PLATFORMS,
  archivePathFor,
  assemblePackage,
  createArchive,
  findStandaloneRoot,
  isCopiedJunk,
  isShipJunk,
  nodeDist,
  packageFolderName,
  releaseNotes,
  startHereText,
  validateVersion,
} from "../scripts/release-pack.mjs";

test("version strings match the release tag rules", () => {
  assert.equal(validateVersion("0.1.0"), "0.1.0");
  assert.equal(validateVersion("v0.1.0"), "0.1.0");
  assert.equal(validateVersion(" 0.1.0 "), "0.1.0");
  assert.equal(validateVersion("1.2.3-beta.1"), "1.2.3-beta.1");
  assert.equal(validateVersion("1.2.3+build"), "1.2.3+build");
  for (const bad of ["", "v", ".", "..", "0..1", ".1", "0.1.0/evil", "0.1.0 extra", "v.1", "../0.1.0"]) {
    assert.throws(() => validateVersion(bad), /Version must look like 0.1.0/);
  }
});

test("node archives are the official builds for each platform", () => {
  const version = BUNDLED_NODE_VERSION;
  assert.equal(nodeDist(version, "linux-amd64").url, `https://nodejs.org/dist/v${version}/node-v${version}-linux-x64.tar.xz`);
  assert.equal(nodeDist(version, "linux-arm64").url, `https://nodejs.org/dist/v${version}/node-v${version}-linux-arm64.tar.xz`);
  assert.equal(nodeDist(version, "windows-amd64").url, `https://nodejs.org/dist/v${version}/node-v${version}-win-x64.zip`);
  assert.equal(nodeDist(version, "windows-arm64").url, `https://nodejs.org/dist/v${version}/node-v${version}-win-arm64.zip`);
  assert.deepEqual(nodeDist(version, "linux-amd64").binaryParts, [`node-v${version}-linux-x64`, "bin", "node"]);
  assert.deepEqual(nodeDist(version, "windows-arm64").binaryParts, [`node-v${version}-win-arm64`, "node.exe"]);
  assert.throws(() => nodeDist(version, "darwin-arm64"));
});

test("developer data and env files are junk, traced package data is not", () => {
  assert.equal(isCopiedJunk("data/store.json"), true);
  assert.equal(isCopiedJunk(".env"), true);
  assert.equal(isCopiedJunk(".env.local"), true);
  assert.equal(isCopiedJunk(".env.example"), false);
  assert.equal(isCopiedJunk(".next/cache/webpack/x"), true);
  assert.equal(isCopiedJunk("node_modules/example/data/ok.txt"), false);
  assert.equal(isShipJunk("data"), true);
  assert.equal(isShipJunk("app/data"), true);
  assert.equal(isShipJunk("app/data/store.json"), true);
  assert.equal(isShipJunk("app/.env"), true);
  assert.equal(isShipJunk(".env.example"), false);
  assert.equal(isShipJunk("app/node_modules/example/data"), false);
  assert.equal(isShipJunk(".git/config"), true);
});

test("standalone root can sit one directory down", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "weidu-standalone-"));
  try {
    const nested = path.join(dir, "out", "pkg");
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(nested, "server.js"), "/* server */\n");
    assert.equal(findStandaloneRoot(path.join(dir, "out")), nested);
    assert.equal(findStandaloneRoot(nested), nested);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("assembled packages keep the runtime and drop developer junk", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "weidu-pack-"));
  try {
    const standalone = path.join(dir, "standalone");
    const outside = path.join(dir, "outside");
    await mkdir(path.join(standalone, "node_modules", "example", "data"), { recursive: true });
    await mkdir(path.join(standalone, "data"), { recursive: true });
    await mkdir(path.join(standalone, ".next", "cache", "webpack"), { recursive: true });
    await mkdir(path.join(standalone, ".git"), { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(standalone, "server.js"), "/* standalone */\n");
    await writeFile(path.join(standalone, "node_modules", "example", "data", "ok.txt"), "ok\n");
    await writeFile(path.join(standalone, "data", "store.json"), '{"secret":true}\n');
    await writeFile(path.join(standalone, ".env"), "OPENAI_API_KEY=secret-key\n");
    await writeFile(path.join(standalone, ".next", "cache", "webpack", "x"), "cache\n");
    await writeFile(path.join(standalone, ".git", "config"), "git\n");
    await writeFile(path.join(outside, "hello.txt"), "hello\n");
    if (process.platform !== "win32") {
      await symlink(outside, path.join(standalone, "node_modules", "outside"), "dir");
    }

    await mkdir(path.join(dir, "static"), { recursive: true });
    await writeFile(path.join(dir, "static", "chunk.js"), "/* static */\n");
    await mkdir(path.join(dir, "public", "docs-assets"), { recursive: true });
    await writeFile(path.join(dir, "public", "docs-assets", "fig.txt"), "fig\n");
    await mkdir(path.join(dir, "content", "en"), { recursive: true });
    await writeFile(path.join(dir, "content", "overview.md"), "# 围读\n");
    await writeFile(path.join(dir, "content", "en", "overview.md"), "# WeiDu\n");
    await writeFile(path.join(dir, ".env.example"), "WEIDU_HOST=127.0.0.1\n");
    await writeFile(path.join(dir, "launcher"), "launcher\n");
    await writeFile(path.join(dir, "nodebin"), "node\n");

    for (const platform of ["linux-amd64", "windows-amd64"] as const) {
      const packed = await assemblePackage({
        version: "v0.1.2",
        platform,
        standaloneDir: standalone,
        staticDir: path.join(dir, "static"),
        publicDir: path.join(dir, "public"),
        contentDir: path.join(dir, "content"),
        nodeBinary: path.join(dir, "nodebin"),
        launcherBinary: path.join(dir, "launcher"),
        envExample: path.join(dir, ".env.example"),
        destParent: path.join(dir, "dist"),
      });
      assert.equal(path.basename(packed), packageFolderName("0.1.2", platform));
      const launcher = platform.startsWith("windows-") ? "WeiDu.exe" : "weidu";
      const nodeName = platform.startsWith("windows-") ? "node.exe" : "node";
      assert.equal(await readFile(path.join(packed, "app", "server.js"), "utf8"), "/* standalone */\n");
      assert.equal(await readFile(path.join(packed, "app", "node_modules", "example", "data", "ok.txt"), "utf8"), "ok\n");
      assert.equal(await readFile(path.join(packed, "app", ".next", "static", "chunk.js"), "utf8"), "/* static */\n");
      assert.equal(await readFile(path.join(packed, "app", "public", "docs-assets", "fig.txt"), "utf8"), "fig\n");
      assert.match(await readFile(path.join(packed, "app", "content", "en", "overview.md"), "utf8"), /WeiDu/);
      assert.match(await readFile(path.join(packed, "START-HERE.txt"), "utf8"), /127\.0\.0\.1:4721/);
      assert.match(await readFile(path.join(packed, "START-HERE.txt"), "utf8"), /WeiDu\.exe/);
      assert.match(await readFile(path.join(packed, "START-HERE.txt"), "utf8"), /\.\/weidu/);
      assert.match(await readFile(path.join(packed, "START-HERE.txt"), "utf8"), /不用安装 Node\.js|Do not install Node\.js/);
      assert.equal(await readFile(path.join(packed, launcher), "utf8"), "launcher\n");
      assert.equal(await readFile(path.join(packed, "runtime", nodeName), "utf8"), "node\n");
      await assert.rejects(readFile(path.join(packed, "app", "data", "store.json"), "utf8"));
      await assert.rejects(readFile(path.join(packed, "app", ".env"), "utf8"));
      await assert.rejects(readFile(path.join(packed, "data", "store.json"), "utf8"));
      await assert.rejects(readFile(path.join(packed, "start.bat"), "utf8"));
      await assert.rejects(statExists(path.join(packed, "app", ".next", "cache")));
      await assert.rejects(statExists(path.join(packed, "app", ".git")));
      if (process.platform !== "win32") {
        const linked = await readFile(path.join(packed, "app", "node_modules", "outside", "hello.txt"), "utf8");
        assert.equal(linked, "hello\n");
        const info = await lstat(path.join(packed, "app", "node_modules", "outside"));
        assert.equal(info.isSymbolicLink(), false);
      }
    }

    const linuxDir = path.join(dir, "dist", packageFolderName("0.1.2", "linux-amd64"));
    const linuxArchive = await createArchive(linuxDir, "linux-amd64");
    assert.equal(linuxArchive, archivePathFor(linuxDir, "linux-amd64"));
    assertArchiveEntries(linuxArchive, packageFolderName("0.1.2", "linux-amd64"));

    const windowsDir = path.join(dir, "dist", packageFolderName("0.1.2", "windows-amd64"));
    const windowsArchive = await createArchive(windowsDir, "windows-amd64");
    assertArchiveEntries(windowsArchive, packageFolderName("0.1.2", "windows-amd64"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the packaged desk matches the local listen and login rules", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "weidu-desk-"));
  try {
    const prepared = prepareDeskEnv(dir, { HOSTNAME: "machine-name", HOST: "0.0.0.0" });
    assert.equal(prepared.host, "127.0.0.1");
    assert.equal(prepared.port, 4721);
    assert.equal(prepared.url, "http://127.0.0.1:4721");
    assert.equal(prepared.env.HOSTNAME, "127.0.0.1");
    assert.equal(prepared.env.PORT, "4721");
    assert.equal(prepared.env.NODE_ENV, "production");
    assert.equal(prepared.env.WEIDU_AUTH, "off");
    assert.equal(prepared.env.GAOJIAN_DATA_FILE, path.join(dir, "data", "store.json"));
    assert.equal(authEnabled(prepared.env), false);
    assert.equal(prepared.openBrowser, true);

    await writeFile(path.join(dir, ".env"), 'WEIDU_HOST=0.0.0.0\nPORT=4800\nWEIDU_AUTH=on\nGAOJIAN_DATA_FILE=elsewhere/store.json\n');
    const fromFile = prepareDeskEnv(dir, {});
    assert.equal(fromFile.host, "0.0.0.0");
    assert.equal(fromFile.port, 4800);
    assert.equal(fromFile.url, "http://127.0.0.1:4800");
    assert.equal(fromFile.env.HOSTNAME, "0.0.0.0");
    assert.equal(fromFile.env.PORT, "4800");
    assert.equal(fromFile.env.WEIDU_AUTH, "on");
    assert.equal(authEnabled(fromFile.env), true);
    assert.equal(fromFile.env.GAOJIAN_DATA_FILE, path.resolve(dir, "elsewhere/store.json"));

    await writeFile(path.join(dir, ".env.local"), "WEIDU_NO_BROWSER=1\nPORT=4801\n");
    const fromLocal = prepareDeskEnv(dir, { WEIDU_HOST: "127.0.0.1", PORT: "4721", GAOJIAN_DATA_FILE: "/var/weidu/store.json" });
    assert.equal(fromLocal.host, "127.0.0.1");
    assert.equal(fromLocal.port, 4721);
    assert.equal(fromLocal.openBrowser, false);
    assert.equal(fromLocal.env.GAOJIAN_DATA_FILE, path.resolve(dir, "/var/weidu/store.json"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("release notes and the workflow ship four binaries plus the source zip", () => {
  const notes = releaseNotes("0.1.0");
  assert.match(notes, /WeiDu-0\.1\.0-windows-amd64\.zip/);
  assert.match(notes, /WeiDu-0\.1\.0-windows-arm64\.zip/);
  assert.match(notes, /WeiDu-0\.1\.0-linux-amd64\.tar\.gz/);
  assert.match(notes, /WeiDu-0\.1\.0-linux-arm64\.tar\.gz/);
  assert.match(notes, /WeiDu-0\.1\.0\.zip/);
  assert.match(notes, /WeiDu\.exe/);
  assert.match(notes, /\.\/weidu/);
  assert.match(notes, /127\.0\.0\.1:4721/);
  assert.match(startHereText(), /Do not install Node\.js/);

  const workflow = readFileSync(".github/workflows/release.yml", "utf8");
  assert.match(workflow, new RegExp(`node-version:\\s*${BUNDLED_NODE_VERSION.replaceAll(".", "\\.")}`));
  for (const image of ["ubuntu-latest", "ubuntu-24.04-arm", "windows-latest", "windows-11-arm"]) {
    assert.match(workflow, new RegExp(`image:\\s*${image}`));
  }
  for (const platform of PLATFORMS) {
    assert.match(workflow, new RegExp(`platform:\\s*${platform}`));
  }
  assert.match(workflow, /contents:\s*write/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /gh release upload/);
  assert.match(workflow, /--clobber/);
  assert.match(workflow, /--target/);
  assert.match(workflow, /v0\.1\.0 is already published/);
  assert.doesNotMatch(workflow, /\$\{\{\s*runner[.\s]/);
  assert.doesNotMatch(workflow, /macos/i);
});

function assertArchiveEntries(archive: string, folder: string) {
  for (const entry of listArchive(archive)) {
    const norm = entry.replace(/\\/g, "/").replace(/\/+$/, "");
    if (!norm) continue;
    const prefix = `${folder}/`;
    assert.ok(norm === folder || norm.startsWith(prefix), `archive entry escaped the folder: ${norm}`);
    const rel = norm.startsWith(prefix) ? norm.slice(prefix.length) : "";
    if (rel) assert.equal(isShipJunk(rel), false, rel);
  }
  const names = listArchive(archive).map((entry) => entry.replace(/\\/g, "/"));
  assert.ok(names.some((entry) => entry.includes("app/server.js")));
  assert.ok(names.some((entry) => entry.includes("START-HERE.txt")));
  assert.equal(names.some((entry) => entry.endsWith("/.env") || entry.endsWith("/data/store.json")), false);
}

function listArchive(archive: string) {
  if (archive.endsWith(".zip") && process.platform !== "win32") {
    return execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
  }
  return execFileSync("tar", ["-tf", archive], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
}

function statExists(file: string) {
  return lstat(file);
}
