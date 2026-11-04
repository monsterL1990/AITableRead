"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { LanguageSwitch } from "@/components/language-switch";
import { useI18n } from "@/components/locale-provider";
import { settingsSections } from "@/lib/account-policy";
import { Button } from "@/components/ui/button";
import type { AccountType, SettingsVisibility } from "@/lib/types";

type Me = {
  uid: string;
  display: string;
  type: AccountType;
  settingsVisibility: SettingsVisibility;
  authEnabled?: boolean;
};

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useI18n();
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
  const accountsOn = me?.authEnabled === true;
  const who = me ? (me.display === "站长" ? t("admin.owner") : me.display) : t("shell.tagline");
  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-30 border-b border-border/80 bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 text-base font-medium">
            <span className="seal">围</span>
            {t("shell.brand")}
          </Link>
          <p className="hidden text-sm text-muted-foreground sm:block">{who}</p>
          <nav className="ml-auto flex flex-wrap items-center justify-end gap-1">
            <LanguageSwitch />
            <Button variant={pathname === "/readers" ? "secondary" : "ghost"} asChild>
              <Link href="/readers">{t("shell.readers")}</Link>
            </Button>
            <Button variant={pathname === "/prompts" ? "secondary" : "ghost"} asChild>
              <Link href="/prompts">{t("shell.prompts")}</Link>
            </Button>
            {accountsOn && me?.type === "owner" ? (
              <Button variant={pathname === "/admin" ? "secondary" : "ghost"} asChild>
                <Link href="/admin">{t("shell.accounts")}</Link>
              </Button>
            ) : null}
            {sections.showSettingsNav ? (
              <Button variant={pathname === "/settings" ? "secondary" : "ghost"} asChild>
                <Link href="/settings">{t("shell.settings")}</Link>
              </Button>
            ) : null}
            <Button variant="ghost" asChild>
              <Link href="/docs">{t("shell.docs")}</Link>
            </Button>
            {accountsOn ? (
              <Button
                variant="ghost"
                onClick={() => {
                  void fetch("/api/auth/logout", { method: "POST" }).finally(() => {
                    router.replace("/login");
                    router.refresh();
                  });
                }}
              >
                {t("shell.signOut")}
              </Button>
            ) : null}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
