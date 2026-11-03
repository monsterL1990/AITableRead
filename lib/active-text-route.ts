import { applyAccountTextPolicy, type AccountTextRoute } from "./account-policy";
import { getSettings } from "./store";
import { LOCAL_USER_ID, type AccountType, type TextRoute } from "./types";

export type ActiveTextRoute = AccountTextRoute;

/** 读这个账号的稿库偏好，再按账号类型收成这一次出字实际走的路。 */
export async function loadActiveTextRoute(user?: { uid?: string; type?: AccountType }): Promise<ActiveTextRoute> {
  const uid = user?.uid ?? LOCAL_USER_ID;
  const type = user?.type ?? "owner";
  try {
    const settings = await getSettings(uid);
    return applyAccountTextPolicy(type, settings);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("预设账号")) throw error;
    throw new Error("稿库读不出来，请检查 data/store.json。");
  }
}

export async function resolveActiveTextRoute(user?: { uid?: string; type?: AccountType }): Promise<TextRoute> {
  return (await loadActiveTextRoute(user)).route;
}
