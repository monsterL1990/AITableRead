import { redirect } from "next/navigation";
import { SettingsDesk } from "@/components/settings-desk";
import { settingsVisibility } from "@/lib/account-policy";
import { isResponse, requireUser } from "@/lib/api";
import { pageMetadata } from "@/lib/i18n/request";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return pageMetadata("meta.settings");
}

export default async function SettingsPage() {
  const user = await requireUser();
  if (isResponse(user)) redirect("/login");
  const visibility = settingsVisibility(user.type);
  if (visibility === "hidden") redirect("/");
  return <SettingsDesk visibility={visibility} />;
}
