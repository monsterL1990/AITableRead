import { createHash } from "node:crypto";
import { createWriteStream, existsSync, readdirSync } from "node:fs";
import { chmod, copyFile, cp, mkdir, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

// Official Node 22 LTS. CI installs this same patch before `npm ci` / `next build`
// so native addons match the runtime shipped in the package.
export const BUNDLED_NODE_VERSION = "22.23.4";

export const PLATFORMS = ["windows-amd64", "windows-arm64", "linux-amd64", "linux-arm64"];

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Same rules as the old shell matcher: optional leading v, no empty, no "..",
 * no leading dot, and only letters, digits, dot, underscore, plus, hyphen.
 * @param {string} raw
 */
export function validateVersion(raw) {
  const text = String(raw ?? "").trim();
  const version = text.startsWith("v") ? text.slice(1) : text;
  if (!version || version.startsWith(".") || version.includes("..") || !/^[0-9A-Za-z._+-]+$/.test(version)) {
    throw new Error(`Version must look like 0.1.0. Got: ${raw}`);
  }
  return version;
}

/** @param {string} platform */
export function assertPlatform(platform) {
  if (!PLATFORMS.includes(platform)) {
    throw new Error(`Platform must be one of ${PLATFORMS.join(", ")}. Got: ${platform}`);
  }
  return platform;
}

/** @param {string} version @param {string} platform */
export function packageFolderName(version, platform) {
  return `WeiDu-${validateVersion(version)}-${assertPlatform(platform)}`;
}

/** @param {string} platform */
export function launcherFileName(platform) {
  return assertPlatform(platform).startsWith("windows-") ? "WeiDu.exe" : "weidu";
}

/** @param {string} platform */
export function nodeRuntimeName(platform) {
  return assertPlatform(platform).startsWith("windows-") ? "node.exe" : "node";
}

/** @param {string} platform */
export function requiredPackageEntries(platform) {
  return [
    launcherFileName(platform),
    `runtime/${nodeRuntimeName(platform)}`,
    "START-HERE.txt",
    "desk.mjs",
    "desk-env.mjs",
    "listen.mjs",
    ".env.example",
    "app/server.js",
    "app/.next/static",
    "app/public",
    "app/content",
    "app/node_modules",
  ];
}

/**
 * Junk relative to a Next standalone directory, before it is copied under app/.
 * A dependency folder named data is kept. The project's own data/ and env files are not.
 * @param {string} rel
 */
export function isCopiedJunk(rel) {
  const parts = rel.split(/[/\\]/).filter(Boolean);
  if (parts.length === 0) return false;
  if (parts[0] === "data" || parts.includes(".git")) return true;
  if (parts[0] === ".next" && parts[1] === "cache") return true;
  return isEnvFile(parts[parts.length - 1] ?? "");
}

/**
 * Junk relative to the finished package folder.
 * @param {string} rel
 */
export function isShipJunk(rel) {
  const parts = rel.split(/[/\\]/).filter(Boolean);
  if (parts.length === 0) return false;
  if (parts.includes(".git")) return true;
  const base = parts[parts.length - 1] ?? "";
  if (isEnvFile(base)) return true;
  if (parts[0] === "data") return true;
  if (parts[0] === "app" && parts[1] === "data") return true;
  return false;
}

/** @param {string} base */
function isEnvFile(base) {
  if (base === ".env.example") return false;
  return base === ".env" || base.startsWith(".env.");
}

/**
 * @param {string} version
 * @param {string} platform
 */
export function nodeDist(version, platform) {
  const token = {
    "linux-amd64": "linux-x64",
    "linux-arm64": "linux-arm64",
    "windows-amd64": "win-x64",
    "windows-arm64": "win-arm64",
  }[assertPlatform(platform)];
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Node version must look like 22.23.4. Got: ${version}`);
  }
  const folder = `node-v${version}-${token}`;
  const file = platform.startsWith("windows-") ? `${folder}.zip` : `${folder}.tar.xz`;
  return {
    file,
    url: `https://nodejs.org/dist/v${version}/${file}`,
    sumsUrl: `https://nodejs.org/dist/v${version}/SHASUMS256.txt`,
    binaryParts: platform.startsWith("windows-") ? [folder, "node.exe"] : [folder, "bin", "node"],
    licenseParts: [folder, "LICENSE"],
  };
}

export function startHereText() {
  return `围读（WeiDu）

这个压缩包已经带好运行所需的程序。不用安装 Node.js，不用 npm install，也不用 npm run dev。

1. 把压缩包解压到一个文件夹。请保留整个文件夹，不要只拿出里面的程序。
2. Windows：双击 WeiDu.exe。Linux：在终端里运行 ./weidu。
3. 窗口会保持打开，浏览器会打开 http://127.0.0.1:4721。
4. 不填 API Key 也能把三个步骤点完，看到的是占位文字。
5. 要用真正的模型出字，到设置里填上你的 API。
6. 稿子写在程序旁边的 data/store.json。删掉 data 文件夹可以清空这台机器上的稿房。
7. 要停止，关掉窗口，或在窗口里按 Ctrl+C。

不想自动打开浏览器时，设置 WEIDU_NO_BROWSER=1。
默认只监听这台机器。要给别的机器连，再把 .env.example 复制成 .env，写上 WEIDU_HOST=0.0.0.0。

English

This package already includes everything it needs to run. Do not install Node.js. Do not run npm install or npm run dev.

1. Unpack the archive into a folder. Keep the whole folder.
2. Windows: double-click WeiDu.exe. Linux: run ./weidu in a terminal.
3. The window stays open, and the browser opens at http://127.0.0.1:4721.
4. An empty API key still walks the three steps. You get placeholder text.
5. Put a real API in Settings when you want the model to write.
6. Manuscripts are stored in data/store.json next to the program. Delete the data folder to reset this machine.
7. Stop WeiDu by closing the window, or by pressing Ctrl+C in that window.

Set WEIDU_NO_BROWSER=1 to skip opening a browser.
The desk listens only on this machine. Copy .env.example to .env and set WEIDU_HOST=0.0.0.0 only if you mean to accept other machines.
`;
}

/** @param {string} version */
export function releaseNotes(version) {
  const clean = validateVersion(version);
  const windowsAmd = `WeiDu-${clean}-windows-amd64.zip`;
  const windowsArm = `WeiDu-${clean}-windows-arm64.zip`;
  const linuxAmd = `WeiDu-${clean}-linux-amd64.tar.gz`;
  const linuxArm = `WeiDu-${clean}-linux-arm64.tar.gz`;
  const source = `WeiDu-${clean}.zip`;
  return `WeiDu ${clean}

Download the package for your machine, unpack it, and run the program inside. Node.js is already included. Do not run npm install or npm run dev. The desk listens on http://127.0.0.1:4721 and opens your browser. Leave the window open until you stop it. An empty API key still walks the three steps with placeholder text. Put a real API in Settings when you want the model to write. Manuscripts are stored in data/store.json next to the program.

- Windows 64-bit (Intel/AMD): ${windowsAmd} — double-click WeiDu.exe
- Windows 64-bit (ARM): ${windowsArm} — double-click WeiDu.exe
- Linux x86_64: ${linuxAmd} — run ./weidu
- Linux ARM64: ${linuxArm} — run ./weidu

${source} is the source tree for developers. That zip still needs Node.js LTS and start.bat / start.sh.

围读 ${clean}

下载和你的电脑匹配的压缩包，解压后运行里面的程序。已经带好 Node.js，不用自己装，也不用 npm install 或 npm run dev。稿房监听 http://127.0.0.1:4721，并会打开浏览器。窗口留到你停止为止。Key 空着也能把三个步骤点完，看到的是占位文字。要用模型出字，到设置里填 API。稿子在程序旁边的 data/store.json。

- Windows 64 位（Intel/AMD）：${windowsAmd}，双击 WeiDu.exe
- Windows 64 位（ARM）：${windowsArm}，双击 WeiDu.exe
- Linux x86_64：${linuxAmd}，运行 ./weidu
- Linux ARM64：${linuxArm}，运行 ./weidu

${source} 是给开发者的源码包，仍需要 Node.js LTS 和 start.bat / start.sh。
`;
}

/**
 * @param {string} standaloneDir
 */
export function findStandaloneRoot(standaloneDir) {
  if (existsSync(path.join(standaloneDir, "server.js"))) return standaloneDir;
  const stack = [standaloneDir];
  while (stack.length > 0) {
    const dir = stack.shift();
    if (!dir) break;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === "node_modules" || entry.name === ".git") continue;
      const next = path.join(dir, entry.name);
      if (existsSync(path.join(next, "server.js"))) return next;
      const depth = path.relative(standaloneDir, next).split(path.sep).filter(Boolean).length;
      if (depth < 4) stack.push(next);
    }
  }
  throw new Error(`No server.js under ${standaloneDir}. Run npm run build with output: "standalone" first.`);
}

/**
 * @param {object} options
 * @param {string} options.version
 * @param {string} options.platform
 * @param {string} options.standaloneDir
 * @param {string} options.staticDir
 * @param {string} options.publicDir
 * @param {string} options.contentDir
 * @param {string} options.nodeBinary
 * @param {string} [options.nodeLicense]
 * @param {string} options.launcherBinary
 * @param {string} options.envExample
 * @param {string} options.destParent
 */
export async function assemblePackage(options) {
  const platform = assertPlatform(options.platform);
  const folder = packageFolderName(options.version, platform);
  const root = path.join(options.destParent, folder);
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });

  const standaloneRoot = findStandaloneRoot(options.standaloneDir);
  requireDir(options.staticDir, "Next static directory");
  requireDir(options.publicDir, "public directory");
  requireDir(options.contentDir, "content directory");
  requireFile(options.nodeBinary, "Node binary");
  requireFile(options.launcherBinary, "launcher");
  requireFile(options.envExample, ".env.example");

  const appDir = path.join(root, "app");
  await cp(standaloneRoot, appDir, {
    recursive: true,
    filter: (source) => {
      const rel = path.relative(standaloneRoot, source);
      return !isCopiedJunk(rel);
    },
  });
  await cp(options.staticDir, path.join(appDir, ".next", "static"), { recursive: true });
  await cp(options.publicDir, path.join(appDir, "public"), { recursive: true });
  await cp(options.contentDir, path.join(appDir, "content"), { recursive: true });

  const runtimeDir = path.join(root, "runtime");
  await mkdir(runtimeDir, { recursive: true });
  const nodeDest = path.join(runtimeDir, nodeRuntimeName(platform));
  await copyFile(options.nodeBinary, nodeDest);
  if (options.nodeLicense && existsSync(options.nodeLicense)) {
    await copyFile(options.nodeLicense, path.join(runtimeDir, "LICENSE"));
  }

  const launcherDest = path.join(root, launcherFileName(platform));
  await copyFile(options.launcherBinary, launcherDest);

  for (const file of ["desk.mjs", "desk-env.mjs", "listen.mjs"]) {
    await copyFile(path.join(scriptDir, file), path.join(root, file));
  }
  await copyFile(options.envExample, path.join(root, ".env.example"));
  await writeFile(path.join(root, "START-HERE.txt"), startHereText(), "utf8");

  await materializeExternalLinks(root);
  await makeExecutable(launcherDest);
  await makeExecutable(nodeDest);

  const junk = await findShipJunk(root);
  if (junk.length > 0) {
    throw new Error(`Refusing to pack developer junk:\n${junk.join("\n")}`);
  }
  const missing = await missingPackageEntries(root, platform);
  if (missing.length > 0) {
    throw new Error(`Package is missing:\n${missing.join("\n")}`);
  }
  return root;
}

/**
 * @param {object} options
 * @param {string} options.version
 * @param {string} options.platform
 * @param {string} options.standaloneDir
 * @param {string} options.staticDir
 * @param {string} options.publicDir
 * @param {string} options.contentDir
 * @param {string} [options.nodeBinary]
 * @param {string} [options.nodeLicense]
 * @param {string} [options.nodeVersion]
 * @param {string} options.launcherBinary
 * @param {string} options.envExample
 * @param {string} options.destParent
 */
export async function packRelease(options) {
  let nodeBinary = options.nodeBinary;
  let nodeLicense = options.nodeLicense;
  if (!nodeBinary) {
    const fetched = await fetchNodeBinary({
      version: options.nodeVersion || BUNDLED_NODE_VERSION,
      platform: options.platform,
      cacheDir: path.join(options.destParent, ".cache", options.platform),
    });
    nodeBinary = fetched.binary;
    nodeLicense = fetched.license;
  }
  const root = await assemblePackage({ ...options, nodeBinary, nodeLicense });
  const archive = await createArchive(root, options.platform);
  return { root, archive };
}

/** @param {string} packageDir @param {string} platform */
export function archivePathFor(packageDir, platform) {
  return assertPlatform(platform).startsWith("windows-") ? `${packageDir}.zip` : `${packageDir}.tar.gz`;
}

/** @param {string} packageDir @param {string} platform */
export async function createArchive(packageDir, platform) {
  const archive = archivePathFor(packageDir, platform);
  await rm(archive, { force: true });
  const parent = path.dirname(packageDir);
  const base = path.basename(packageDir);
  if (platform.startsWith("windows-")) {
    if (process.platform === "win32") {
      await run("tar", ["-a", "-c", "-f", archive, base], parent);
    } else {
      await run("zip", ["-r", "-X", "-q", archive, base], parent);
    }
  } else {
    await run("tar", ["-czf", archive, base], parent);
  }
  return archive;
}

/**
 * @param {object} options
 * @param {string} options.version
 * @param {string} options.platform
 * @param {string} options.cacheDir
 */
export async function fetchNodeBinary(options) {
  const dist = nodeDist(options.version, options.platform);
  await mkdir(options.cacheDir, { recursive: true });
  const sumsText = await fetchText(dist.sumsUrl);
  const expected = checksumFor(sumsText, dist.file);
  const archive = path.join(options.cacheDir, dist.file);
  console.error(`Downloading ${dist.url}`);
  const actual = await downloadFile(dist.url, archive);
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    await rm(archive, { force: true });
    throw new Error(`Checksum mismatch for ${dist.file}. Expected ${expected}, got ${actual}.`);
  }
  const extractDir = path.join(options.cacheDir, "extract");
  await rm(extractDir, { recursive: true, force: true });
  await mkdir(extractDir, { recursive: true });
  if (dist.file.endsWith(".zip")) {
    await run("tar", ["-xf", archive, "-C", extractDir]);
  } else {
    await run("tar", ["-xJf", archive, "-C", extractDir]);
  }
  const binary = path.join(extractDir, ...dist.binaryParts);
  const license = path.join(extractDir, ...dist.licenseParts);
  if (!existsSync(binary)) {
    throw new Error(`Node archive did not contain ${dist.binaryParts.join("/")}.`);
  }
  return { binary, license: existsSync(license) ? license : "" };
}

/** @param {string} root */
export async function findShipJunk(root) {
  /** @type {string[]} */
  const found = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).split(path.sep).join("/");
      if (isShipJunk(rel)) found.push(rel);
      if (entry.isDirectory() && !entry.isSymbolicLink()) await walk(full);
    }
  }
  await walk(root);
  return found;
}

/** @param {string} root @param {string} platform */
export async function missingPackageEntries(root, platform) {
  /** @type {string[]} */
  const missing = [];
  for (const rel of requiredPackageEntries(platform)) {
    const full = path.join(root, ...rel.split("/"));
    if (!existsSync(full)) missing.push(rel);
  }
  return missing;
}

/** @param {string} root */
async function materializeExternalLinks(root) {
  const realRoot = await realpath(root);
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) break;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        let targetReal;
        try {
          targetReal = await realpath(full);
        } catch {
          throw new Error(`Broken symlink in the package: ${path.relative(root, full)}`);
        }
        if (!isInside(realRoot, targetReal)) {
          await rm(full, { recursive: true, force: true });
          await cp(targetReal, full, { recursive: true, dereference: true });
        }
        continue;
      }
      if (entry.isDirectory()) stack.push(full);
    }
  }
}

/** @param {string} root @param {string} target */
function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

/** @param {string} file */
async function makeExecutable(file) {
  const info = await stat(file);
  await chmod(file, info.mode | 0o755);
}

/** @param {string} dir @param {string} label */
function requireDir(dir, label) {
  if (!existsSync(dir)) throw new Error(`Missing ${label}: ${dir}`);
}

/** @param {string} file @param {string} label */
function requireFile(file, label) {
  if (!existsSync(file)) throw new Error(`Missing ${label}: ${file}`);
}

/** @param {string} sumsText @param {string} fileName */
function checksumFor(sumsText, fileName) {
  for (const line of sumsText.split(/\r?\n/)) {
    const match = /^([a-fA-F0-9]{64})\s+\*?(\S+)$/.exec(line.trim());
    if (match && match[2] === fileName) return match[1];
  }
  throw new Error(`No checksum for ${fileName}`);
}

/** @param {string} url */
async function fetchText(url) {
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Download failed for ${url}: ${message}`);
  }
  if (!response.ok) throw new Error(`Download failed (${response.status}) ${url}`);
  return response.text();
}

/** @param {string} url @param {string} dest */
async function downloadFile(url, dest) {
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Download failed for ${url}: ${message}`);
  }
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}) ${url}`);
  const hash = createHash("sha256");
  const tap = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), tap, createWriteStream(dest));
  return hash.digest("hex");
}

/** @param {string} command @param {string[]} args @param {string} [cwd] */
function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", (error) => reject(new Error(`${command} failed: ${error.message}`)));
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}`));
    });
  });
}

function findBuiltLauncher() {
  const dir = path.join(process.cwd(), "scripts", "launcher");
  for (const name of ["launcher", "launcher.exe"]) {
    const full = path.join(dir, name);
    if (existsSync(full)) return full;
  }
  throw new Error("Launcher binary is missing. From scripts/launcher run: go build -o launcher .");
}

async function assembleCi() {
  const version = process.env.RAW_VERSION ?? "";
  const platform = process.env.WEIDU_PLATFORM ?? "";
  const cwd = process.cwd();
  const { archive } = await packRelease({
    version,
    platform,
    standaloneDir: path.join(cwd, ".next", "standalone"),
    staticDir: path.join(cwd, ".next", "static"),
    publicDir: path.join(cwd, "public"),
    contentDir: path.join(cwd, "content"),
    launcherBinary: findBuiltLauncher(),
    envExample: path.join(cwd, ".env.example"),
    destParent: path.join(cwd, "dist"),
  });
  console.log(archive);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "validate-version") {
    process.stdout.write(`${validateVersion(args[0] ?? "")}\n`);
    return;
  }
  if (command === "notes") {
    process.stdout.write(releaseNotes(args[0] ?? ""));
    return;
  }
  if (command === "assemble-ci") {
    await assembleCi();
    return;
  }
  console.error("Usage: node scripts/release-pack.mjs validate-version <version> | notes <version> | assemble-ci");
  process.exit(1);
}

const entry = process.argv[1];
if (entry && path.resolve(entry) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
