"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { settingsSections } from "@/lib/account-policy";
import { Button } from "@/components/ui/button";
import type { AccountType, SettingsVisibility } from "@/lib/types";

type Me = {
  uid: string;
  display: string;
  type: AccountType;
  settingsVisibility: SettingsVisibility;
};

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/me")
      .then(async (response) => {
        if (response.status === 401) {
          router.replace("/login");
          return null;
        }
        if (!response.ok) return null;
        return (await response.json()) as Me;
      })
      .then((body) => {
        if (!cancelled && body) setMe(body);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [router]);

  const sections = settingsSections(me?.settingsVisibility ?? "hidden");
  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-30 border-b border-border/80 bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 text-base font-medium">
            <span className="seal">围</span>
            围读
          </Link>
          <p className="hidden text-sm text-muted-foreground sm:block">{me ? me.display : "分步写作"}</p>
          <nav className="ml-auto flex items-center gap-1">
            <Button variant={pathname === "/readers" ? "secondary" : "ghost"} asChild>
              <Link href="/readers">读者</Link>
            </Button>
            <Button variant={pathname === "/prompts" ? "secondary" : "ghost"} asChild>
              <Link href="/prompts">提示词</Link>
            </Button>
            {me?.type === "owner" ? (
              <Button variant={pathname === "/admin" ? "secondary" : "ghost"} asChild>
                <Link href="/admin">账号</Link>
              </Button>
            ) : null}
            {sections.showSettingsNav ? (
              <Button variant={pathname === "/settings" ? "secondary" : "ghost"} asChild>
                <Link href="/settings">设置</Link>
              </Button>
            ) : null}
            <Button variant="ghost" asChild>
              <Link href="/docs">说明</Link>
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                void fetch("/api/auth/logout", { method: "POST" }).finally(() => {
                  router.replace("/login");
                  router.refresh();
                });
              }}
            >
              退出
            </Button>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
