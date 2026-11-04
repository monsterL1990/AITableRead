import { lockPresetDsModel } from "@/lib/account-policy";
import { loadActiveTextRoute } from "@/lib/active-text-route";
import { errorJson, isResponse, requireUser } from "@/lib/api";
import { draftReaderFromSpec } from "@/lib/reader-spec";
import { resolveRequestLocale } from "@/lib/i18n/request";
import { createReader } from "@/lib/store";
import { routeClientStatus } from "@/lib/text-route";
import type { TextRoute } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorJson("表单没有解析成功。", 400);
  }
  const requirement = typeof form.get("requirement") === "string" ? String(form.get("requirement")) : "";
  const files = form.getAll("files").filter((item): item is File => item instanceof File && item.size > 0);
  const named = await Promise.all(
    files.map(async (file) => ({
      name: file.name || "未命名",
      bytes: new Uint8Array(await file.arrayBuffer()),
    })),
  );
  let route: TextRoute;
  let customApi;
  let dshModel;
  let ephemeralProvider = false;
  try {
    const active = await lockPresetDsModel(await loadActiveTextRoute(user));
    route = active.route;
    customApi = active.customApi;
    dshModel = active.dshModel;
    ephemeralProvider = active.ephemeralProvider;
  } catch (error) {
    const message = error instanceof Error ? error.message : "稿库读不出来，请检查 data/store.json。";
    return errorJson(message, routeClientStatus(message));
  }
  try {
    const draft = await draftReaderFromSpec({ requirement, files: named }, { route, customApi, dshModel, ephemeralProvider });
    const reader = await createReader({ ...draft, origin: "from-spec" }, user.uid, await resolveRequestLocale(request));
    return Response.json({ reader }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读者没能生成。";
    return errorJson(message, 400);
  }
}
