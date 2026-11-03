import { isResponse, requireUser } from "@/lib/api";
import { handleGenerateRequest } from "@/lib/hosted-generation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Params) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await context.params;
  return handleGenerateRequest(request, id, user.uid, { accountType: user.type });
}
