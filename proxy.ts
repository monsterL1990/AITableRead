import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authEnabled, authGate } from "@/lib/auth-mode";
import { isDocsPath } from "@/lib/docs-nav";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isDocsPath(pathname)) return NextResponse.next();

  const enabled = authEnabled();
  const token = enabled ? request.cookies.get(COOKIE_NAME)?.value : undefined;
  const session = enabled ? await verifySessionToken(token) : null;
  const decision = authGate(pathname, Boolean(session), enabled);

  if (decision === "home") return NextResponse.redirect(new URL("/", request.url));
  if (decision === "login") {
    const response = NextResponse.redirect(new URL("/login", request.url));
    if (token) response.cookies.delete(COOKIE_NAME);
    return response;
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
