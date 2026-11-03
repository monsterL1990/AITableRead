import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const DEFAULT_BIND_HOST = "127.0.0.1";
export const DEFAULT_PORT = 4721;

function readEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const values = {};
  const text = readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function pick(name, env, localFile, envFile) {
  const fromProcess = typeof env[name] === "string" ? env[name].trim() : "";
  if (fromProcess) return fromProcess;
  const fromLocal = typeof localFile[name] === "string" ? localFile[name].trim() : "";
  if (fromLocal) return fromLocal;
  const fromFile = typeof envFile[name] === "string" ? envFile[name].trim() : "";
  return fromFile;
}

/**
 * Bind address for `npm run dev` and `npm run start`.
 * Loopback unless WEIDU_HOST is set in the environment, .env.local, or .env.
 * HOSTNAME is ignored: Docker sets it to the container id, and a machine hostname is not a listen address.
 * @param {Record<string, string | undefined>} [env]
 */
export function resolveBindHost(env = process.env) {
  const explicit = typeof env.WEIDU_HOST === "string" ? env.WEIDU_HOST.trim() : "";
  if (!explicit) return DEFAULT_BIND_HOST;
  if (/[\s/\\]/.test(explicit)) {
    throw new Error(`WEIDU_HOST must be a hostname or IP address, without spaces. Got: ${JSON.stringify(explicit)}`);
  }
  return explicit;
}

/** @param {Record<string, string | undefined>} [env] */
export function resolveBindPort(env = process.env) {
  const raw = typeof env.PORT === "string" ? env.PORT.trim() : "";
  if (!raw) return DEFAULT_PORT;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`PORT must be a whole number from 1 to 65535. Got: ${JSON.stringify(raw)}`);
  }
  const port = Number(raw);
  if (port < 1 || port > 65535) {
    throw new Error(`PORT must be a whole number from 1 to 65535. Got: ${raw}`);
  }
  return port;
}

export function localUrl(host, port) {
  const openHost = host === "0.0.0.0" || host === "::" || host === "[::]" ? "127.0.0.1" : host;
  const bracket = openHost.includes(":") && !openHost.startsWith("[") ? `[${openHost}]` : openHost;
  return `http://${bracket}:${port}`;
}

/**
 * Process environment wins, then .env.local, then .env.
 * @param {string} root
 * @param {Record<string, string | undefined>} [env]
 */
export function readListenTarget(root, env = process.env) {
  const envFile = readEnvFile(path.join(root, ".env"));
  const localFile = readEnvFile(path.join(root, ".env.local"));
  const listenEnv = {
    WEIDU_HOST: pick("WEIDU_HOST", env, localFile, envFile),
    PORT: pick("PORT", env, localFile, envFile),
  };
  const host = resolveBindHost(listenEnv);
  const port = resolveBindPort(listenEnv);
  return { host, port, url: localUrl(host, port) };
}
