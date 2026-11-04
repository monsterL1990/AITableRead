/**
 * Local one-person desk: login is off unless WEIDU_AUTH=on.
 * NODE_ENV=production (npm run start, Docker) keeps login on when the switch
 * is unset, so a published process does not silently drop the password.
 * WEIDU_AUTH=off is the explicit opt-out. Do not use it on a public host.
 */
export type AuthEnv = {
  WEIDU_AUTH?: string;
  NODE_ENV?: string;
};

export type AuthGate = "allow" | "login" | "home";

export function authEnabled(env: AuthEnv = process.env): boolean {
  const flag = (env.WEIDU_AUTH ?? "").trim().toLowerCase();
  if (flag === "on" || flag === "1" || flag === "true") return true;
  if (flag === "off" || flag === "0" || flag === "false") return false;
  return env.NODE_ENV === "production";
}

/** Page gate. Docs are decided by the caller before this. */
export function authGate(pathname: string, hasSession: boolean, enabled: boolean): AuthGate {
  if (!enabled) return pathname === "/login" ? "home" : "allow";
  if (pathname === "/login") return hasSession ? "home" : "allow";
  return hasSession ? "allow" : "login";
}
