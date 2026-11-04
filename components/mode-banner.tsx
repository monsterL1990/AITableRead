"use client";

import Link from "next/link";
import { useI18n } from "@/components/locale-provider";
import { isPresetAccount } from "@/lib/account-policy";
import { connectedModelLines, dshFallbackNote } from "@/lib/format";
import type { PublicConfig } from "@/lib/types";

export function ModeBanner({ config }: { config: PublicConfig | null }) {
  const { t, show, join } = useI18n();
  if (!config) return null;
  if (isPresetAccount(config.accountType)) {
    const fallback = config.accountType === "preset-ds" ? "deepseek-official / deepseek-flash" : "xai-oauth / grok-4.7";
    const chosen = config.dshModel ? `${config.dshModel.provider} / ${config.dshModel.model}` : fallback;
    const kind = config.accountType === "preset-ds" ? t("banner.presetKindDs") : t("banner.presetKindGrok");
    return (
      <div className="rounded-lg border border-border bg-paper px-4 py-3 text-sm leading-6 text-muted-foreground">
        <p className="font-medium text-foreground">{t("banner.presetTitle")}</p>
        <p>
          {t("banner.presetBody", { kind, model: chosen })}
          {config.accountType === "preset-ds" ? t("banner.presetDsCatalog") : ""}
        </p>
        {config.textRouteNote ? <p>{show(config.textRouteNote)}</p> : null}
      </div>
    );
  }
  if (config.textRoute === "dsh") {
    const chosen = config.dshModel ? `${config.dshModel.provider} / ${config.dshModel.model}` : "";
    return (
      <div className="rounded-lg border border-border bg-paper px-4 py-3 text-sm leading-6 text-muted-foreground">
        <p className="font-medium text-foreground">{t("banner.dshTitle")}</p>
        <p>
          {t("banner.dshBody")}
          {chosen ? t("banner.dshChosen", { model: chosen }) : t("banner.dshDefault")}
          {t("banner.dshRest")}
          <Link href="/settings" className="text-foreground underline underline-offset-4">
            {t("common.settings")}
          </Link>
          {t("banner.dshRestTail")}
        </p>
      </div>
    );
  }
  if (config.textRoute === "custom") {
    if (!config.customApi?.configured) {
      return (
        <div className="rounded-lg border border-[#e0c4a4] bg-[#fbf3e4] px-4 py-3 text-sm leading-6">
          <p className="font-medium">{t("banner.customMissingTitle")}</p>
          <p className="text-muted-foreground">
            {config.textRouteNote ? show(config.textRouteNote) : t("banner.customMissingFallback")}{" "}
            <Link href="/settings" className="text-foreground underline underline-offset-4">
              {t("banner.openSettings")}
            </Link>
          </p>
        </div>
      );
    }
    const lines = connectedModelLines(config.model ?? config.customApi.model, config.baseUrl ?? config.customApi.baseUrl);
    return (
      <div className="rounded-lg border border-border bg-paper px-4 py-3 text-sm leading-6 text-muted-foreground">
        <p className="font-medium text-foreground">{t("banner.customTitle")}</p>
        <p>
          {t("banner.customBody")}
          {config.accountType === "custom" ? (
            t("banner.customOnly")
          ) : (
            <>
              {t("banner.customSwitch")}
              <Link href="/settings" className="text-foreground underline underline-offset-4">
                {t("common.settings")}
              </Link>
              {t("banner.customSwitchTail")}
            </>
          )}
        </p>
        {lines.map((line, index) => (
          <p key={line.text} className={line.mono ? "break-all font-mono text-xs text-foreground/80" : undefined}>
            {index < lines.length - 1 ? `${line.mono ? line.text : show(line.text)} ` : line.mono ? line.text : show(line.text)}
          </p>
        ))}
      </div>
    );
  }
  if (config.demoMode || config.textRoute === "demo") {
    const shownMissing = join(config.missing.length ? config.missing : ["OPENAI_BASE_URL", "OPENAI_API_KEY"]);
    return (
      <div className="rounded-lg border border-[#e0c4a4] bg-[#fbf3e4] px-4 py-3 text-sm leading-6">
        <p className="font-medium">{t("banner.demoTitle")}</p>
        <p className="text-muted-foreground">
          {config.dshConfigured
            ? t("banner.demoChosen", { missing: shownMissing })
            : `${show(dshFallbackNote(config.dshMissing))}${t("banner.demoAlsoMissing", { missing: shownMissing })}`}
          {t("banner.demoRest")}
          <Link href="/settings" className="text-foreground underline underline-offset-4">
            {t("common.settings")}
          </Link>
          {t("banner.demoRestTail")}
          {config.dshConfigured ? t("banner.demoDshReady") : t("banner.demoDshNotDefault")}
        </p>
      </div>
    );
  }
  const lines = connectedModelLines(config.model ?? "", config.baseUrl);
  return (
    <div className="rounded-lg border border-border bg-paper px-4 py-3 text-sm leading-6 text-muted-foreground">
      <p className="font-medium text-foreground">{t("banner.cliproxyTitle")}</p>
      <p>
        {config.dshConfigured ? (
          <>
            {t("banner.cliproxyChosen")}
            <Link href="/settings" className="text-foreground underline underline-offset-4">
              {t("common.settings")}
            </Link>
            {t("banner.cliproxyChosenTail")}
          </>
        ) : (
          show(dshFallbackNote(config.dshMissing))
        )}
      </p>
      {lines.map((line, index) => (
        <p key={line.text} className={line.mono ? "break-all font-mono text-xs text-foreground/80" : undefined}>
          {index < lines.length - 1 ? `${line.mono ? line.text : show(line.text)} ` : line.mono ? line.text : show(line.text)}
        </p>
      ))}
    </div>
  );
}
