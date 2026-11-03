import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { canonicalAccountType } from "./account-policy";
import { getPassword, passwordsMatch, type PasswordEnv } from "./session";
import { LOCAL_USER_ID, type AccountType } from "./types";

const scrypt = promisify(scryptCb);
const KEYLEN = 32;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;
const MAX_DISPLAY = 40;

/** 好友账号。站长 local 另算，不走这条。 */
export const UID_PATTERN = /^[a-z][a-z0-9_-]{1,31}$/;
/** 朋友站留下的保留名，再加上围读站长 local。 */
export const RESERVED_UIDS = new Set(["admin", "owner", "canary", "root", "dsh", LOCAL_USER_ID]);

export type AuthUser = {
  uid: string;
  type: AccountType;
  display: string;
  credentialVersion: number;
};

export type PublicAccount = {
  uid: string;
  display: string;
  type: AccountType;
  disabled: boolean;
  createdAt: string;
};

type StoredAccount = {
  type: AccountType;
  display: string;
  disabled: boolean;
  createdAt: string;
  hash: string;
  salt: string;
  credentialVersion: number;
};

type AccountsFile = {
  version: 1;
  users: Record<string, StoredAccount>;
};

function accountsFile(): string {
  const override = process.env.GAOJIAN_ACCOUNTS_FILE?.trim();
  if (override) return override;
  const storeFile = process.env.GAOJIAN_DATA_FILE || path.join(process.cwd(), "data", "store.json");
  return path.join(path.dirname(storeFile), "accounts.json");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function cleanDisplay(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.replace(/[\r\n]/g, " ").trim() : "";
  return (text || fallback).slice(0, MAX_DISPLAY);
}

function normalizeAccount(uid: string, value: unknown): StoredAccount | null {
  if (uid === LOCAL_USER_ID) {
    const raw = asRecord(value) ?? {};
    return {
      type: "owner",
      display: cleanDisplay(raw.display, "站长"),
      disabled: false,
      createdAt: typeof raw.createdAt === "string" && raw.createdAt ? raw.createdAt : new Date(0).toISOString(),
      hash: "",
      salt: "",
      credentialVersion: 0,
    };
  }
  if (!UID_PATTERN.test(uid) || RESERVED_UIDS.has(uid)) return null;
  const raw = asRecord(value);
  if (!raw) return null;
  const type = canonicalAccountType(raw.type);
  if (!type || type === "owner") return null;
  const version = raw.credentialVersion;
  return {
    type,
    display: cleanDisplay(raw.display, uid),
    disabled: raw.disabled === true,
    createdAt: typeof raw.createdAt === "string" && raw.createdAt ? raw.createdAt : new Date(0).toISOString(),
    hash: typeof raw.hash === "string" ? raw.hash : "",
    salt: typeof raw.salt === "string" ? raw.salt : "",
    credentialVersion: typeof version === "number" && version > 0 ? Math.floor(version) : 1,
  };
}

function emptyFile(): AccountsFile {
  return { version: 1, users: {} };
}

function normalize(value: unknown): AccountsFile {
  const raw = asRecord(value);
  const users: Record<string, StoredAccount> = {};
  const source = asRecord(raw?.users) ?? {};
  for (const [uid, item] of Object.entries(source)) {
    const account = normalizeAccount(uid, item);
    if (account) users[uid] = account;
  }
  return { version: 1, users };
}

let queue: Promise<unknown> = Promise.resolve();

function locked<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function read(): Promise<AccountsFile> {
  try {
    const raw = await readFile(accountsFile(), "utf8");
    if (!raw.trim()) return emptyFile();
    return normalize(JSON.parse(raw));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return emptyFile();
    throw error;
  }
}

async function write(file: AccountsFile): Promise<void> {
  const target = accountsFile();
  await mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(file, null, 2));
  await rename(tmp, target);
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16).toString("base64url");
  const derived = (await scrypt(password, salt, KEYLEN)) as Buffer;
  return { hash: derived.toString("base64url"), salt };
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  if (!password || !hash || !salt) return false;
  const derived = (await scrypt(password, salt, KEYLEN)) as Buffer;
  const expected = Buffer.from(hash, "base64url");
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(derived, expected);
}

function toPublic(uid: string, account: StoredAccount): PublicAccount {
  return {
    uid,
    display: account.display,
    type: account.type,
    disabled: account.disabled,
    createdAt: account.createdAt,
  };
}

export function validateNewPassword(password: string): string | null {
  if (password.length < MIN_PASSWORD) return `口令至少 ${MIN_PASSWORD} 个字符。`;
  if (password.length > MAX_PASSWORD) return "口令太长。";
  return null;
}

export function validateNewUid(uid: string): string | null {
  if (!UID_PATTERN.test(uid)) return "账号要以小写字母开头，后面用小写字母、数字、下划线或短横线，一共 2 到 32 个字符。";
  if (RESERVED_UIDS.has(uid)) return "这个账号名留给系统，不能用。";
  return null;
}

/** 站长记录只记显示名。口令始终是 APP_PASSWORD，不写进口令库。 */
export async function ensureOwnerRecord(): Promise<PublicAccount> {
  return locked(async () => {
    const file = await read();
    const existing = file.users[LOCAL_USER_ID];
    if (existing) return toPublic(LOCAL_USER_ID, existing);
    const created: StoredAccount = {
      type: "owner",
      display: "站长",
      disabled: false,
      createdAt: new Date().toISOString(),
      hash: "",
      salt: "",
      credentialVersion: 0,
    };
    file.users[LOCAL_USER_ID] = created;
    await write(file);
    return toPublic(LOCAL_USER_ID, created);
  });
}

export async function listAccounts(): Promise<PublicAccount[]> {
  const owner = await ensureOwnerRecord();
  const file = await read();
  const accounts = Object.entries(file.users).map(([uid, account]) => toPublic(uid, account));
  if (!accounts.some((account) => account.uid === LOCAL_USER_ID)) accounts.push(owner);
  return accounts.sort((a, b) => {
    if (a.type === "owner") return -1;
    if (b.type === "owner") return 1;
    return a.createdAt < b.createdAt ? -1 : 1;
  });
}

export async function createAccount(input: {
  uid: string;
  password: string;
  display?: string;
  type: AccountType | "preset";
}): Promise<{ ok: true; account: PublicAccount } | { ok: false; status: number; error: string }> {
  const uid = input.uid.trim().toLowerCase();
  const uidError = validateNewUid(uid);
  if (uidError) return { ok: false, status: 400, error: uidError };
  const type = canonicalAccountType(input.type);
  if (!type || type === "owner") {
    return { ok: false, status: 400, error: "账号类型只能是预设 Grok、预设 DeepSeek，或非预设模型。" };
  }
  const passwordError = validateNewPassword(input.password);
  if (passwordError) return { ok: false, status: 400, error: passwordError };
  const { hash, salt } = await hashPassword(input.password);
  return locked(async () => {
    const file = await read();
    if (file.users[uid]) return { ok: false, status: 409, error: "这个账号已经有了。" };
    const account: StoredAccount = {
      type,
      display: cleanDisplay(input.display, uid),
      disabled: false,
      createdAt: new Date().toISOString(),
      hash,
      salt,
      credentialVersion: 1,
    };
    file.users[uid] = account;
    await write(file);
    return { ok: true, account: toPublic(uid, account) };
  });
}

export async function updateAccount(
  uid: string,
  patch: { disabled?: boolean; password?: string },
): Promise<{ ok: true; account: PublicAccount } | { ok: false; status: number; error: string }> {
  const name = uid.trim().toLowerCase();
  if (name === LOCAL_USER_ID) {
    return { ok: false, status: 403, error: "站长口令是 APP_PASSWORD，不能在这里停用或重设。" };
  }
  if (patch.password !== undefined) {
    const passwordError = validateNewPassword(patch.password);
    if (passwordError) return { ok: false, status: 400, error: passwordError };
  }
  if (patch.disabled === undefined && patch.password === undefined) {
    return { ok: false, status: 400, error: "没有要改的内容。" };
  }
  const nextHash = patch.password !== undefined ? await hashPassword(patch.password) : null;
  return locked(async () => {
    const file = await read();
    const account = file.users[name];
    if (!account || account.type === "owner") return { ok: false, status: 404, error: "没有这个账号。" };
    if (patch.disabled !== undefined) {
      account.disabled = patch.disabled;
      if (patch.disabled) account.credentialVersion += 1;
    }
    if (nextHash) {
      account.hash = nextHash.hash;
      account.salt = nextHash.salt;
      account.credentialVersion += 1;
    }
    await write(file);
    return { ok: true, account: toPublic(name, account) };
  });
}

export async function removeAccount(uid: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const name = uid.trim().toLowerCase();
  if (name === LOCAL_USER_ID) return { ok: false, status: 403, error: "不能删除站长。" };
  return locked(async () => {
    const file = await read();
    if (!file.users[name] || file.users[name].type === "owner") return { ok: false, status: 404, error: "没有这个账号。" };
    delete file.users[name];
    await write(file);
    return { ok: true };
  });
}

export async function resolveSessionAccount(uid: string, credentialVersion: number): Promise<(AuthUser & { disabled: boolean }) | null> {
  if (uid === LOCAL_USER_ID) {
    if (!getPassword()) return null;
    if (credentialVersion !== 0) return null;
    const file = await read();
    const owner = file.users[LOCAL_USER_ID];
    return {
      uid: LOCAL_USER_ID,
      type: "owner",
      display: owner?.display || "站长",
      credentialVersion: 0,
      disabled: false,
    };
  }
  const file = await read();
  const account = file.users[uid];
  if (!account || account.type === "owner") return null;
  if (account.credentialVersion !== credentialVersion) return null;
  return {
    uid,
    type: account.type,
    display: account.display,
    credentialVersion: account.credentialVersion,
    disabled: account.disabled,
  };
}

/**
 * 站长用 uid local（或旧客户端不带 uid）加上 APP_PASSWORD。
 * 好友用自己的 uid 和口令库里的哈希。口令不对时不说明账号在不在。
 */
export async function loginWithPassword(
  input: { uid?: string; password: string },
  env?: PasswordEnv,
): Promise<{ ok: true; user: AuthUser } | { ok: false; status: number; error: string }> {
  const password = input.password ?? "";
  const uid = (input.uid ?? "").trim().toLowerCase();
  if (!password) return { ok: false, status: 401, error: "账号或口令不对。" };

  if (!uid || uid === LOCAL_USER_ID) {
    const expected = getPassword(env);
    if (!expected) return { ok: false, status: 503, error: "生产环境必须设置 APP_PASSWORD 或 AUTH_PASSWORD。" };
    if (!passwordsMatch(password, expected)) return { ok: false, status: 401, error: "账号或口令不对。" };
    const owner = await ensureOwnerRecord();
    return { ok: true, user: { uid: LOCAL_USER_ID, type: "owner", display: owner.display, credentialVersion: 0 } };
  }

  if (!UID_PATTERN.test(uid) || RESERVED_UIDS.has(uid)) return { ok: false, status: 401, error: "账号或口令不对。" };
  const file = await read();
  const account = file.users[uid];
  if (!account || account.type === "owner" || !(await verifyPassword(password, account.hash, account.salt))) {
    return { ok: false, status: 401, error: "账号或口令不对。" };
  }
  if (account.disabled) return { ok: false, status: 403, error: "这个账号已停用。" };
  return {
    ok: true,
    user: { uid, type: account.type, display: account.display, credentialVersion: account.credentialVersion },
  };
}
