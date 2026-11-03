import { errorJson, isResponse, requireUser } from "@/lib/api";
import { cancelHostedGeneration } from "@/lib/hosted-generation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Params) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const { id } = await context.params;
  const result = await cancelHostedGeneration(user.uid, id);
  if (!result.ok) return errorJson(result.error, result.status);
  return Response.json({ project: result.project });
}
