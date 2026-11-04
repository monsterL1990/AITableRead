import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminDesk } from "@/components/admin-desk";
import { Shell } from "@/components/shell";
import { isResponse, requireOwner } from "@/lib/api";
import { authEnabled } from "@/lib/auth-mode";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "账号" };

export default async function AdminPage() {
  if (!authEnabled()) {
    return (
      <Shell>
        <div className="mx-auto max-w-2xl space-y-3">
          <h1 className="text-2xl font-medium">账号</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            这台围读默认只有你一个人，不登录，也不能在这里开别的账号。预设账号同样关着。
          </p>
          <p className="text-sm leading-6 text-muted-foreground">
            要放到别人能打开的机器上，设置 WEIDU_AUTH=on，并用 APP_PASSWORD 登录。WEIDU_AUTH=off 再配上别人能访问的地址，稿子就暴露了。本机默认只听 127.0.0.1。
          </p>
        </div>
      </Shell>
    );
  }
  const user = await requireOwner();
  if (isResponse(user)) redirect(user.status === 403 ? "/" : "/login");
  return <AdminDesk />;
}
