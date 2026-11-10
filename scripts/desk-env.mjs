import path from "node:path";
import { readListenTarget, readScopedEnv } from "./listen.mjs";

/**
 * Environment for the packaged desk.
 * Next's standalone server.js listens on HOSTNAME and PORT, and forces
 * NODE_ENV=production. The local desk does not: login stays off unless
 * WEIDU_AUTH=on, and the bind comes from WEIDU_HOST / PORT (HOSTNAME is not
 * a listen address). This maps those rules onto the variables Next reads.
 * @param {string} root Directory that contains the launcher and desk.mjs.
 * @param {Record<string, string | undefined>} [baseEnv]
 */
export function prepareDeskEnv(root, baseEnv = process.env) {
  const target = readListenTarget(root, baseEnv);
  const scoped = readScopedEnv(root, baseEnv, ["WEIDU_AUTH", "GAOJIAN_DATA_FILE", "WEIDU_NO_BROWSER"]);
  const env = { ...baseEnv };
  env.NODE_ENV = "production";
  env.HOSTNAME = target.host;
  env.PORT = String(target.port);
  if (!env.NEXT_TELEMETRY_DISABLED) env.NEXT_TELEMETRY_DISABLED = "1";

  const dataFile = scoped.GAOJIAN_DATA_FILE.trim();
  env.GAOJIAN_DATA_FILE = dataFile
    ? path.resolve(root, dataFile)
    : path.join(root, "data", "store.json");

  const auth = scoped.WEIDU_AUTH.trim();
  env.WEIDU_AUTH = auth || "off";

  return {
    env,
    host: target.host,
    port: target.port,
    url: target.url,
    openBrowser: scoped.WEIDU_NO_BROWSER.trim() !== "1",
  };
}
