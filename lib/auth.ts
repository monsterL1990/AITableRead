import { cookies } from "next/headers";
import { COOKIE_NAME, createSessionToken, SESSION_MAX_AGE, verifySessionToken, type Session } from "./session";

export async function getSession(): Promise<Session | null> {
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
