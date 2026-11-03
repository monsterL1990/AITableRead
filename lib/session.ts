export const COOKIE_NAME = "gj_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 14;
const DEV_PASSWORD = "changeme";

export type Session = { uid: string; credentialVersion: number };

type TokenPayload = { uid: string; exp: number; cv?: number };

export type PasswordEnv = {
  APP_PASSWORD?: string;
  AUTH_PASSWORD?: string;
  NODE_ENV?: string;
};

function passwordEnv(env?: PasswordEnv): PasswordEnv {
  return env ?? process.env;
}

/** APP_PASSWORD wins when both are set. Empty strings count as unset. */
export function configuredPassword(env?: PasswordEnv): string {
  const source = passwordEnv(env);
  return source.APP_PASSWORD?.trim() || source.AUTH_PASSWORD?.trim() || "";
}

export function usingDevPassword(env?: PasswordEnv): boolean {
  const source = passwordEnv(env);
  return !configuredPassword(source) && source.NODE_ENV !== "production";
}

export function getPassword(env?: PasswordEnv): string | null {
  const source = passwordEnv(env);
  const fromEnv = configuredPassword(source);
  if (fromEnv) return fromEnv;
  if (source.NODE_ENV === "production") return null;
  return DEV_PASSWORD;
}

export function sessionSecret(): string {
  const explicit = process.env.APP_SESSION_SECRET?.trim();
  if (explicit) return explicit;
  return `gaojian-v1:${getPassword() ?? "unconfigured"}`;
}

export function passwordsMatch(input: string, expected: string): boolean {
  const left = new TextEncoder().encode(input);
  const right = new TextEncoder().encode(expected);
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < length; i += 1) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function createSessionToken(uid: string, now = Date.now(), credentialVersion = 0): Promise<string> {
  const payload: TokenPayload = { uid, exp: now + SESSION_MAX_AGE * 1000, cv: credentialVersion };
  const body = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await hmacKey(sessionSecret());
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
  );
  return `${body}.${bytesToBase64Url(signature)}`;
}

export async function verifySessionToken(token: string | undefined | null): Promise<Session | null> {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  try {
    const key = await hmacKey(sessionSecret());
    const ok = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlToBytes(signature) as BufferSource,
      new TextEncoder().encode(body),
    );
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(body))) as TokenPayload;
    if (!payload?.uid || typeof payload.exp !== "number") return null;
    if (payload.exp < Date.now()) return null;
    const credentialVersion = typeof payload.cv === "number" && payload.cv >= 0 ? payload.cv : 0;
    return { uid: payload.uid, credentialVersion };
  } catch {
    return null;
  }
}
