"use client";

import { LanguageSwitch } from "@/components/language-switch";
import { useI18n } from "@/components/locale-provider";
import Link from "next/link";
import type { MessageId } from "@/lib/i18n/catalog";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { DOCS_NAV } from "@/lib/docs-nav";
import { cn } from "@/lib/utils";

function DocsNav({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const { t } = useI18n();
  return (
    <nav className="flex flex-1 flex-col gap-1 px-3" aria-label={t("docs.navLabel")}>
      {DOCS_NAV.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            onClick={onNavigate}
            className={cn(
              "rounded-md px-3 py-2 text-sm leading-6 transition-colors",
              active ? "bg-primary font-medium text-primary-foreground" : "text-foreground hover:bg-accent",
            )}
          >
            {t(`docs.nav.${item.slug}` as MessageId)}
          </Link>
        );
      })}
    </nav>
  );
}

export function DocsPager({
  previous,
  next,
}: {
  previous?: (typeof DOCS_NAV)[number];
  next?: (typeof DOCS_NAV)[number];
}) {
  const { t } = useI18n();
  return (
    <nav className="mt-12 flex items-stretch justify-between gap-3 border-t border-border pt-5 text-sm" aria-label={t("docs.pager")}>
      {previous ? (
        <Link href={previous.href} className="min-w-0 text-primary hover:underline">
          {t("docs.prev", { label: t(`docs.nav.${previous.slug}` as MessageId) })}
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link href={next.href} className="min-w-0 text-primary hover:underline">
          {t("docs.next", { label: t(`docs.nav.${next.slug}` as MessageId) })}
        </Link>
      ) : null}
    </nav>
  );
}

export function DocsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = openPath === pathname;
  const current = DOCS_NAV.find((item) => item.href === pathname);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenPath(null);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="min-h-full">
      <aside
        id="docs-nav"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-border bg-[#f7f1e6] transition-transform md:z-30 md:w-60 md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-6 pb-4">
          <Link href="/docs" className="flex items-center gap-2" onClick={() => setOpenPath(null)}>
            <span className="seal">围</span>
            <span>
              <span className="block text-base font-medium leading-none">{t("docs.brand")}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{t("docs.subtitle")}</span>
            </span>
          </Link>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
            onClick={() => setOpenPath(null)}
          >
            {t("docs.close")}
          </button>
        </div>
        <DocsNav pathname={pathname} onNavigate={() => setOpenPath(null)} />
        <div className="border-t border-border px-5 py-4">
          <LanguageSwitch className="mb-3" />
          <Link href="/" className="text-sm text-muted-foreground hover:text-primary">
            {t("docs.enter")}
          </Link>
        </div>
      </aside>

      {open ? (
        <button
          type="button"
          aria-label={t("docs.closeNav")}
          className="fixed inset-0 z-40 bg-[#1c1712]/40 md:hidden"
          onClick={() => setOpenPath(null)}
        />
      ) : null}

      <div className="md:pl-60">
        <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-border bg-[#f7f1e6]/95 px-4 py-3 backdrop-blur md:hidden">
          <button
            type="button"
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm"
            aria-expanded={open}
            aria-controls="docs-nav"
            onClick={() => setOpenPath(pathname)}
          >
            {t("docs.contents")}
          </button>
          <p className="min-w-0 flex-1 truncate text-sm font-medium">{current ? t(`docs.nav.${current.slug}` as MessageId) : t("docs.fallback")}</p>
          <LanguageSwitch />
        </header>
        <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-8 sm:py-10">{children}</div>
      </div>
    </div>
  );
}
