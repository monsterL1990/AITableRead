import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readListenTarget } from "./listen.mjs";

const mode = process.argv[2];
if (mode !== "dev" && mode !== "start") {
  console.error("Usage: node scripts/serve.mjs dev|start");
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let target;
try {
  target = readListenTarget(root);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
console.log(`WeiDu listening on ${target.url}`);
if (target.host === "127.0.0.1") {
  console.log("Bind is loopback only. Set WEIDU_HOST=0.0.0.0 to listen on every interface.");
} else {
  console.log(`Bind override: WEIDU_HOST=${target.host}`);
}

const child = spawn(process.execPath, [nextBin, mode, "--hostname", target.host, "--port", String(target.port)], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

function forward(signal) {
  if (child.exitCode === null && child.signalCode === null) child.kill(signal);
}

process.on("SIGINT", () => forward("SIGINT"));
process.on("SIGTERM", () => forward("SIGTERM"));

child.on("exit", (code, signal) => {
  if (signal) {
    process.exit(1);
    return;
  }
  process.exit(code ?? 1);
});
