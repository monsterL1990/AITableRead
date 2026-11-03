import { settingsVisibility } from "@/lib/account-policy";
import { isResponse, requireUser } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  return Response.json({
    uid: user.uid,
    display: user.display,
    type: user.type,
    settingsVisibility: settingsVisibility(user.type),
  });
}
