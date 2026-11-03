import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminDesk } from "@/components/admin-desk";
import { isResponse, requireOwner } from "@/lib/api";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "账号" };

export default async function AdminPage() {
  const user = await requireOwner();
  if (isResponse(user)) redirect(user.status === 403 ? "/" : "/login");
  return <AdminDesk />;
}
