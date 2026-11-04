import { publicConfigForAccount } from "@/lib/account-policy";
import { errorJson, isResponse, requireUser } from "@/lib/api";
import { authEnabled } from "@/lib/auth-mode";
import { getSession } from "@/lib/auth";
import { getPassword, usingDevPassword } from "@/lib/session";
import { getSettings } from "@/lib/store";
import { publicConfigRouteFields } from "@/lib/text-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const enabled = authEnabled();
  const extras = {
    devPasswordHint: enabled && usingDevPassword(),
    authConfigured: !enabled || getPassword() !== null,
  };
  const session = await getSession();
  if (!session) return Response.json({ ...publicConfigRouteFields(undefined, null, extras), authEnabled: enabled });
  const user = await requireUser();
  if (isResponse(user)) return user;
  try {
    const stored = await getSettings(user.uid);
    return Response.json({ ...publicConfigForAccount(user.type, stored, undefined, extras), authEnabled: enabled });
  } catch {
    return errorJson("稿库读不出来，请检查 data/store.json。", 500);
  }
}
