import { redirect } from "next/navigation";
import { AdminClosed, AdminDesk } from "@/components/admin-desk";
import { isResponse, requireOwner } from "@/lib/api";
import { authEnabled } from "@/lib/auth-mode";
import { pageMetadata } from "@/lib/i18n/request";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return pageMetadata("meta.admin");
}

export default async function AdminPage() {
  if (!authEnabled()) return <AdminClosed />;
  const user = await requireOwner();
  if (isResponse(user)) redirect(user.status === 403 ? "/" : "/login");
  return <AdminDesk />;
}
