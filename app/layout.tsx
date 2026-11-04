import type { Metadata } from "next";
import type { ReactNode } from "react";
import { LocaleProvider } from "@/components/locale-provider";
import { Toaster } from "@/components/ui/sonner";
import { htmlLang } from "@/lib/i18n/locale";
import { resolveRequestLocale } from "@/lib/i18n/request";
import { translate } from "@/lib/i18n/translate";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await resolveRequestLocale();
  return {
    title: {
      default: translate(locale, "meta.title"),
      template: translate(locale, "meta.titleTemplate"),
    },
    description: translate(locale, "meta.description"),
    robots: { index: false, follow: false },
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await resolveRequestLocale();
  return (
    <html lang={htmlLang(locale)} className="h-full antialiased">
      <body className="min-h-full text-foreground">
        <LocaleProvider initialLocale={locale}>{children}</LocaleProvider>
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
