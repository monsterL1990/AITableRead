import { cookies } from "next/headers";
import { authEnabled } from "./auth-mode";
import { COOKIE_NAME, createSessionToken, SESSION_MAX_AGE, verifySessionToken, type Session } from "./session";
import { LOCAL_USER_ID } from "./types";

export async function getSession(): Promise<Session | null> {
  if (!authEnabled()) return { uid: LOCAL_USER_ID, credentialVersion: 0 };
  const jar = await cookies();
  return verifySessionToken(jar.get(COOKIE_NAME)?.value);
}

export async function writeSessionCookie(uid: string, credentialVersion = 0): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE_NAME, await createSessionToken(uid, Date.now(), credentialVersion), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}
