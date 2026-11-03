import Link from "next/link";
import { byokPurgeActive, isPresetAccount } from "@/lib/account-policy";
import { connectedModelLines, dshFallbackNote } from "@/lib/format";
import type { PublicConfig } from "@/lib/types";

export function ModeBanner({ config }: { config: PublicConfig | null }) {
  if (!config) return null;
  if (isPresetAccount(config.accountType)) {
    const fallback = config.accountType === "preset-ds" ? "deepseek-official / deepseek-flash" : "xai-oauth / grok-4.7";
    const chosen = config.dshModel ? `${config.dshModel.provider} / ${config.dshModel.model}` : fallback;
    const kind = config.accountType === "preset-ds" ? "预设 DeepSeek" : "预设 Grok";
    return (
      <div className="rounded-lg border border-border bg-paper px-4 py-3 text-sm leading-6 text-muted-foreground">
        <p className="font-medium text-foreground">出字经 DSH</p>
        <p>
          {kind}账号固定走站点的 DSH，模型是 {chosen}。合规清洗随这次回复生效。不使用自定义 API，也没有出字设置。
          {config.accountType === "preset-ds" ? "这个模型必须在站点目录里。" : ""}
        </p>
        {config.textRouteNote ? <p>{config.textRouteNote}</p> : null}
      </div>
    );
  }
  if (byokPurgeActive(config)) {
    if (!config.customApi?.configured) {
      return (
        <div className="rounded-lg border border-[#e0c4a4] bg-[#fbf3e4] px-4 py-3 text-sm leading-6">
          <p className="font-medium">自定义 API 还没填全</p>
          <p className="text-muted-foreground">
            {config.textRouteNote || "请到设置里补上接口地址、API Key 和模型。已打开经 DSH purge，也不会改成直连。"}{" "}
            <Link href="/settings" className="text-foreground underline underline-offset-4">
              打开设置
            </Link>
          </p>
        </div>
      );
    }
    const lines = connectedModelLines(config.customApi.model, config.customApi.baseUrl);
    return (
      <div className="rounded-lg border border-border bg-paper px-4 py-3 text-sm leading-6 text-muted-foreground">
        <p className="font-medium text-foreground">出字经 DSH，用你自己的密钥</p>
        <p>
          这把 Key 只在这一轮挂上临时 provider，合规清洗随会话生效。不写进站点的主机设置。要改回直连、不经 purge，去
          <Link href="/settings" className="text-foreground underline underline-offset-4">
            设置
          </Link>
          里关掉「经 DSH purge」。
        </p>
        {config.textRouteNote ? <p>{config.textRouteNote}</p> : null}
        {lines.map((line, index) => (
          <p key={line.text} className={line.mono ? "break-all font-mono text-xs text-foreground/80" : undefined}>
            {index < lines.length - 1 ? `${line.text} ` : line.text}
          </p>
        ))}
      </div>
    );
  }
  if (config.textRoute === "dsh") {
    const chosen = config.dshModel ? `${config.dshModel.provider} / ${config.dshModel.model}` : "";
    return (
      <div className="rounded-lg border border-border bg-paper px-4 py-3 text-sm leading-6 text-muted-foreground">
        <p className="font-medium text-foreground">出字经 DSH</p>
        <p>
          大纲、初稿、润色、读者审、结构质检和按意见改稿都交给已配置的 DSH 会话。
          {chosen ? `这一轮用目录里的 ${chosen}。` : "没另选模型时，新开会话沿用模板会话当前的模型。"}
          合规清洗随该会话生效。这几步不走环境里的 OpenAI 兼容接口，也不走自定义 API 的密钥。要改走那条接口，去
          <Link href="/settings" className="text-foreground underline underline-offset-4">
            设置
          </Link>
          里换。
        </p>
      </div>
    );
  }
  if (config.textRoute === "custom") {
    if (!config.customApi?.configured) {
      return (
        <div className="rounded-lg border border-[#e0c4a4] bg-[#fbf3e4] px-4 py-3 text-sm leading-6">
          <p className="font-medium">自定义 API 还没填全</p>
          <p className="text-muted-foreground">
            {config.textRouteNote || "请到设置里补上接口地址、API Key 和模型。这次不会改用环境里的 OpenAI 兼容接口，也不会换成演示稿。"}{" "}
            <Link href="/settings" className="text-foreground underline underline-offset-4">
              打开设置
            </Link>
          </p>
        </div>
      );
    }
    const lines = connectedModelLines(config.model ?? config.customApi.model, config.baseUrl ?? config.customApi.baseUrl);
    return (
      <div className="rounded-lg border border-border bg-paper px-4 py-3 text-sm leading-6 text-muted-foreground">
        <p className="font-medium text-foreground">出字经自定义 API。</p>
        <p>
          直连设置里保存的接口，例如 DeepSeek。不经 DSH 会话，也不经 purge。
          {config.accountType === "custom" ? (
            "这个账号只用自己的密钥，没有别的出字路由。"
          ) : (
            <>
              要改走经 DSH 或环境里的 OpenAI 兼容接口，去
              <Link href="/settings" className="text-foreground underline underline-offset-4">
                设置
              </Link>
              里换。
            </>
          )}
        </p>
        {lines.map((line, index) => (
          <p key={line.text} className={line.mono ? "break-all font-mono text-xs text-foreground/80" : undefined}>
            {index < lines.length - 1 ? `${line.text} ` : line.text}
          </p>
        ))}
      </div>
    );
  }
  if (config.demoMode || config.textRoute === "demo") {
    const missing = config.missing.length ? config.missing.join("、") : "OPENAI_BASE_URL、OPENAI_API_KEY";
    return (
      <div className="rounded-lg border border-[#e0c4a4] bg-[#fbf3e4] px-4 py-3 text-sm leading-6">
        <p className="font-medium">请先配置 API</p>
        <p className="text-muted-foreground">
          {config.dshConfigured
            ? `你选了环境里的 OpenAI 兼容接口，但还没有 ${missing}。`
            : `${dshFallbackNote(config.dshMissing)}还没有 ${missing}。`}
          页面可以继续用，生成的是可编辑的演示稿，不会因此崩溃。到
          <Link href="/settings" className="text-foreground underline underline-offset-4">
            设置
          </Link>
          里填写接口地址、API Key 和模型，或在 .env 里填写 OPENAI_BASE_URL 和 OPENAI_API_KEY。
          {config.dshConfigured ? "DSH 已配置，也可以改回经 DSH。" : "经 DSH 不是默认路径。"}
        </p>
      </div>
    );
  }
  const lines = connectedModelLines(config.model ?? "", config.baseUrl);
  return (
    <div className="rounded-lg border border-border bg-paper px-4 py-3 text-sm leading-6 text-muted-foreground">
      <p className="font-medium text-foreground">出字经 OpenAI 兼容接口。</p>
      <p>
        {config.dshConfigured ? (
          <>
            你在
            <Link href="/settings" className="text-foreground underline underline-offset-4">
              设置
            </Link>
            里选了环境里的 OpenAI 兼容接口。DSH 已配置，这次不走那条会话，也不经 purge。
          </>
        ) : (
          dshFallbackNote(config.dshMissing)
        )}
      </p>
      {lines.map((line, index) => (
        <p key={line.text} className={line.mono ? "break-all font-mono text-xs text-foreground/80" : undefined}>
          {index < lines.length - 1 ? `${line.text} ` : line.text}
        </p>
      ))}
    </div>
  );
}
