import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SettingsDesk } from "@/components/settings-desk";
import { settingsVisibility } from "@/lib/account-policy";
import { isResponse, requireUser } from "@/lib/api";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "设置" };

export default async function SettingsPage() {
  const user = await requireUser();
  if (isResponse(user)) redirect("/login");
  const visibility = settingsVisibility(user.type);
  if (visibility === "hidden") redirect("/");
  return <SettingsDesk visibility={visibility} />;
}
