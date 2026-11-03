import { publicConfigForAccount } from "@/lib/account-policy";
import { errorJson, isResponse, requireUser } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { getPassword, usingDevPassword } from "@/lib/session";
import { getSettings } from "@/lib/store";
import { publicConfigRouteFields } from "@/lib/text-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const extras = { devPasswordHint: usingDevPassword(), authConfigured: getPassword() !== null };
  const session = await getSession();
  if (!session) return Response.json(publicConfigRouteFields(undefined, null, extras));
  const user = await requireUser();
  if (isResponse(user)) return user;
  try {
    const stored = await getSettings(user.uid);
    return Response.json(publicConfigForAccount(user.type, stored, undefined, extras));
  } catch {
    return errorJson("稿库读不出来，请检查 data/store.json。", 500);
  }
}
