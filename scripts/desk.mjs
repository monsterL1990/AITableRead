import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareDeskEnv } from "./desk-env.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
process.chdir(root);

let prepared;
try {
  prepared = prepareDeskEnv(root, process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

try {
  await mkdir(path.dirname(prepared.env.GAOJIAN_DATA_FILE), { recursive: true });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const appDir = path.join(root, "app");
const serverJs = path.join(appDir, "server.js");
console.log(`WeiDu listening on ${prepared.url}`);
if (prepared.host === "127.0.0.1") {
  console.log("Bind is loopback only. Set WEIDU_HOST=0.0.0.0 to listen on every interface.");
} else {
  console.log(`Bind override: WEIDU_HOST=${prepared.host}`);
}
console.log("Leave this window open. Press Ctrl+C to stop WeiDu.");

const child = spawn(process.execPath, [serverJs], {
  cwd: appDir,
  env: prepared.env,
  stdio: "inherit",
});

function stopChild(signal) {
  if (child.exitCode === null && child.signalCode === null) child.kill(signal);
}

process.on("SIGINT", () => stopChild("SIGINT"));
process.on("SIGTERM", () => stopChild("SIGTERM"));

child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});

if (prepared.openBrowser) {
  void waitAndOpen(prepared.url, child);
}

child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canConnect(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

function openBrowser(url) {
  const hint = () => console.log(`Open ${url} in your browser.`);
  if (process.platform === "win32") {
    const opener = spawn("rundll32", ["url.dll,FileProtocolHandler", url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    opener.on("error", hint);
    opener.unref();
    return;
  }
  const command = process.platform === "darwin" ? "open" : "xdg-open";
  const opener = spawn(command, [url], { detached: true, stdio: "ignore" });
  opener.on("error", hint);
  opener.unref();
}

async function waitAndOpen(url, server) {
  const browser = new URL(url);
  const host = browser.hostname;
  const port = Number(browser.port);
  for (let attempt = 0; attempt < 180; attempt += 1) {
    if (server.exitCode !== null || server.signalCode !== null) return;
    if (await canConnect(host, port)) {
      openBrowser(url);
      return;
    }
    await delay(1000);
  }
  if (server.exitCode === null) console.error(`WeiDu did not open ${url}. Check the log above.`);
}
