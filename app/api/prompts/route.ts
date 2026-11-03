import { errorJson, isResponse, readJson, requireUser } from "@/lib/api";
import { DEFAULT_PROMPTS, HARD_RULE, PROMPT_LIST } from "@/lib/prompts";
import { getPromptOverrides, setPromptOverrides } from "@/lib/store";
import { LIMITS, type PromptKey } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const KEYS = new Set(PROMPT_LIST.map((item) => item.key));

export async function GET() {
  const user = await requireUser();
  if (isResponse(user)) return user;
  try {
    const overrides = await getPromptOverrides(user.uid);
    return Response.json({
      enforced: HARD_RULE,
      items: PROMPT_LIST.map((item) => ({
        ...item,
        text: overrides[item.key]?.trim() ? overrides[item.key] : DEFAULT_PROMPTS[item.key],
        customized: Boolean(overrides[item.key]?.trim()),
        defaultText: DEFAULT_PROMPTS[item.key],
      })),
    });
  } catch {
    return errorJson("稿库读不出来，请检查 data/store.json。", 500);
  }
}

export async function PUT(request: Request) {
  const user = await requireUser();
  if (isResponse(user)) return user;
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const raw = (body as { prompts?: unknown }).prompts;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return errorJson("缺少 prompts。", 400);
  }
  const prompts: Partial<Record<PromptKey, string>> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!KEYS.has(key as PromptKey)) return errorJson("有无法识别的提示词。", 400);
    if (typeof value !== "string") return errorJson("提示词必须是文本。", 400);
    if (value.length > LIMITS.prompt) return errorJson("提示词太长。", 400);
    prompts[key as PromptKey] = value;
  }
  try {
    await setPromptOverrides(prompts, user.uid);
    const overrides = await getPromptOverrides(user.uid);
    return Response.json({
      items: PROMPT_LIST.map((item) => ({
        ...item,
        text: overrides[item.key]?.trim() ? overrides[item.key] : DEFAULT_PROMPTS[item.key],
        customized: Boolean(overrides[item.key]?.trim()),
        defaultText: DEFAULT_PROMPTS[item.key],
      })),
    });
  } catch {
    return errorJson("提示词没能保存。", 500);
  }
}
