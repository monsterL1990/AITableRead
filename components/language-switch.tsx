"use client";

import { useI18n } from "@/components/locale-provider";
import type { Locale } from "@/lib/i18n/locale";

const choices: { id: Locale; label: string }[] = [
  { id: "zh", label: "中文" },
  { id: "en", label: "English" },
];

export function LanguageSwitch({ className = "" }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <div
      role="group"
      aria-label={t("shell.language")}
      className={`inline-flex shrink-0 items-center rounded-md border border-border bg-paper p-0.5 ${className}`}
    >
      {choices.map((choice) => {
        const on = locale === choice.id;
        return (
          <button
            key={choice.id}
            type="button"
            aria-pressed={on}
            className={`rounded px-2 py-1 text-sm leading-5 ${on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
            onClick={() => void setLocale(choice.id)}
          >
            {choice.label}
          </button>
        );
      })}
    </div>
  );
}
