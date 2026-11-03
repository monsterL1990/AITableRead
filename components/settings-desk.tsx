"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Shell } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { settingsSections } from "@/lib/account-policy";
import { DEEPSEEK_MODEL_SUGGESTIONS, DEEPSEEK_OPENAI_BASE_URL, DEEPSEEK_PRESET_MODEL } from "@/lib/custom-api";
import { routeMark } from "@/lib/format";
import type { DshCatalogOption, PreferredTextRoute, SettingsResponse, SettingsVisibility } from "@/lib/types";

function dshBlockedCopy(missing: string[]): string {
  if (missing.length > 0 && missing.length < 3) {
    return `未配齐 DSH（缺 ${missing.join("、")}），这条现在不能选。`;
  }
  return "未配齐 DSH，这条现在不能选。";
}

function savedRouteLabel(next: PreferredTextRoute): string {
  if (next === "dsh") return "已改成经 DSH。";
  if (next === "custom") return "已改成自定义 OpenAI 兼容接口。";
  return "已改成环境里的 OpenAI 兼容接口。";
}

export function settingsIntro(visibility: "custom-only" | "full" | "hidden"): string {
  if (visibility === "custom-only") {
    return "这个账号只用自己的 OpenAI 兼容接口出字。密钥存在你的稿库里。默认直连，不经 purge。可以打开「经 DSH purge」，改走站点 DSH。密钥先空着也能打开页面。";
  }
  return "推荐用你自己的 OpenAI 兼容接口出字。写在 .env 的 OPENAI_BASE_URL 和 OPENAI_API_KEY 里，或把接口地址、API Key 和模型保存在下面。密钥先空着也能打开页面，这时会提示你去配置 API，不会崩溃。经 DSH 是可选项，不是默认。";
}

export function purgeSwitchDescription(enabled: boolean, scope: "custom-only" | "full"): string {
  if (enabled) {
    return scope === "custom-only"
      ? "打开后，这把 Key 经 DSH 出字，合规清洗随会话生效。站点要已配齐 DSH。关掉则改回直连，不经 DSH，也不经 purge。"
      : "打开后，若出字走这条自定义 API，这把 Key 经 DSH 出字，合规清洗随会话生效。站点要已配齐 DSH。关掉则这条 API 直连，不经 DSH，也不经 purge。";
  }
  return scope === "custom-only"
    ? "现在直连 OpenAI 兼容接口，不经 DSH，也不经 purge。打开后改经 DSH，用这把 Key，并走 purge。站点要已配齐 DSH。"
    : "现在这条自定义 API 直连，不经 DSH，也不经 purge。打开后，若出字走这条 API，则改经 DSH 并走 purge。站点要已配齐 DSH。";
}

export function CustomPurgeSwitch({
  enabled,
  scope,
  disabled,
  onChange,
}: {
  enabled: boolean;
  scope: "custom-only" | "full";
  disabled?: boolean;
  onChange?: (next: boolean) => void;
}) {
  return (
    <div className="mt-4 rounded-lg border border-border px-3 py-3">
      <div className="flex items-start gap-3">
        <input
          id="custom-api-purge"
          type="checkbox"
          className="mt-1"
          checked={enabled}
          disabled={disabled}
          onChange={(event) => {
            onChange?.(event.target.checked);
          }}
        />
        <div>
          <Label htmlFor="custom-api-purge">经 DSH purge</Label>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{purgeSwitchDescription(enabled, scope)}</p>
        </div>
      </div>
    </div>
  );
}

function modelValue(option: { provider: string; model: string }): string {
  return `${option.provider}\t${option.model}`;
}

function defaultModelLabel(option: DshCatalogOption | null): string {
  if (!option) return "内核默认";
  const name = option.name !== option.model ? `${option.name}，` : "";
  return `内核默认（${name}${option.provider} / ${option.model}）`;
}

export function SettingsDesk({
  visibility,
  initialView = null,
}: {
  visibility: SettingsVisibility;
  /** 测试可传入已载入的设置。页面不传，仍从 /api/settings 读。 */
  initialView?: SettingsResponse | null;
}) {
  const sections = settingsSections(visibility);
  const router = useRouter();
  const [view, setView] = useState<SettingsResponse | null>(initialView);
  const [pending, setPending] = useState<PreferredTextRoute | null>(null);
  const [loading, setLoading] = useState(initialView == null);
  const [saving, setSaving] = useState(false);
  const [savingApi, setSavingApi] = useState(false);
  const [error, setError] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/settings");
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (!response.ok) throw new Error("设置没有载入。");
        const body = (await response.json()) as SettingsResponse;
        if (!cancelled) {
          setView(body);
          setBaseUrl(body.customApi.baseUrl);
          setModel(body.customApi.model);
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "设置没有载入。");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function sendPatch(body: Record<string, unknown>, success: string) {
    const response = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status === 401) {
      router.replace("/login");
      return false;
    }
    const data = (await response.json().catch(() => ({}))) as SettingsResponse & { error?: string };
    if (!response.ok || !data.textRoute || !data.preferredTextRoute || !data.customApi || !data.dshCatalog) {
      toast.error(data.error || "没能保存出字路由。");
      return false;
    }
    if ("customApi" in body) {
      setApiKey("");
      setBaseUrl(data.customApi.baseUrl);
      setModel(data.customApi.model);
    }
    setView(data);
    toast.success(success);
    return true;
  }

  async function chooseDshModel(value: string) {
    if (!view || saving || savingApi) return;
    const next = value
      ? (() => {
          const [provider, model] = value.split("\t");
          return provider && model ? { provider, model } : null;
        })()
      : null;
    if ((view.dshModel?.provider ?? "") === (next?.provider ?? "") && (view.dshModel?.model ?? "") === (next?.model ?? "")) return;
    setSaving(true);
    try {
      await sendPatch({ dshModel: next }, next ? `经 DSH 时改用 ${next.provider} / ${next.model}。` : "经 DSH 时改回内核默认。");
    } catch {
      toast.error("DSH 模型没能保存。");
    } finally {
      setSaving(false);
    }
  }
  async function choose(next: PreferredTextRoute) {
    if (!view || saving || savingApi || next === view.preferredTextRoute) return;
    if (next === "dsh" && !view.dshConfigured) return;
    setSaving(true);
    setPending(next);
    try {
      await sendPatch({ preferredTextRoute: next }, savedRouteLabel(next));
    } catch {
      toast.error("没能保存出字路由。");
    } finally {
      setPending(null);
      setSaving(false);
    }
  }

  async function setPurge(next: boolean) {
    if (!view || saving || savingApi || next === view.purgeEnabled) return;
    setSaving(true);
    try {
      await sendPatch({ purgeEnabled: next }, next ? "已打开经 DSH purge。" : "已关掉经 DSH purge，出字改回直连。");
    } catch {
      toast.error("「经 DSH purge」没能保存。");
    } finally {
      setSaving(false);
    }
  }

  async function saveCustom(useForRoute: boolean) {
    if (!view || saving || savingApi) return;
    setSavingApi(true);
    try {
      const body: Record<string, unknown> = {
        customApi: { baseUrl, model, apiKey },
      };
      if (useForRoute) body.preferredTextRoute = "custom";
      const success = useForRoute ? "已保存自定义 API，出字改走这条。" : "已保存自定义 API。";
      await sendPatch(body, success);
    } catch {
      toast.error("自定义 API 没能保存。");
    } finally {
      setSavingApi(false);
    }
  }

  async function clearKey() {
    if (!view || saving || savingApi || !view.customApi.apiKeyMask) return;
    setSavingApi(true);
    try {
      await sendPatch(
        { customApi: { baseUrl, model, apiKey: "", clearApiKey: true } },
        "已清除自定义 API 的密钥。",
      );
    } catch {
      toast.error("密钥没能清除。");
    } finally {
      setSavingApi(false);
    }
  }

  function applyDeepSeekPreset() {
    setBaseUrl(DEEPSEEK_OPENAI_BASE_URL);
    setModel(DEEPSEEK_PRESET_MODEL);
  }

  const selected = pending ?? view?.preferredTextRoute;
  const busy = saving || savingApi;

  return (
    <Shell>
      <div className="mx-auto max-w-2xl space-y-5">
        <div>
          <h1 className="text-2xl font-medium">设置</h1>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{settingsIntro(visibility)}</p>
        </div>
        {loading ? <p className="text-sm text-muted-foreground">正在读取设置…</p> : null}
        {error ? (
          <div className="sheet rounded-lg border border-border px-4 py-5">
            <p className="text-sm">{error}</p>
          </div>
        ) : null}
        {view && sections.showRoutePicker ? (
          <section className="sheet rounded-lg border border-border px-4 py-4">
            <h2 className="text-base font-medium">出字路由</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              默认走 OpenAI 兼容接口：.env 里的地址和密钥，或下面保存的自定义接口。自定义接口默认直连，不经 purge；同一区可以打开「经 DSH purge」。经 DSH 更慢，只有你自己配齐了才选。这条选择管大纲、初稿、润色、读者审、结构质检、按意见改稿，以及按需求生成读者。没在这里选过、并且 DSH 三项都已填写时，出字仍会先走 DSH。
            </p>
            <fieldset className="mt-4 space-y-2" disabled={busy}>
              <legend className="sr-only">出字路由</legend>
              <label
                className={`flex cursor-pointer gap-3 rounded-lg border px-3 py-3 ${selected === "cliproxy" ? "border-primary bg-accent/60" : "border-border"}`}
              >
                <input
                  type="radio"
                  name="preferredTextRoute"
                  value="cliproxy"
                  className="mt-1 accent-[#8f2d2a]"
                  checked={selected === "cliproxy"}
                  disabled={busy}
                  onChange={() => void choose("cliproxy")}
                />
                <span>
                  <span className="font-medium">OpenAI 兼容接口（.env，推荐）</span>
                  <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                    读取 OPENAI_BASE_URL、OPENAI_API_KEY 和 OPENAI_MODEL。不经 DSH，也不经 purge。以前这条显示成 CLIProxy，它不是要另外安装的代理。
                  </span>
                </span>
              </label>
              <label
                className={`flex gap-3 rounded-lg border px-3 py-3 ${selected === "custom" ? "border-primary bg-accent/60" : "border-border"} ${view.customApi.configured ? "cursor-pointer" : "cursor-not-allowed opacity-70"}`}
              >
                <input
                  type="radio"
                  name="preferredTextRoute"
                  value="custom"
                  className="mt-1 accent-[#8f2d2a]"
                  checked={selected === "custom"}
                  disabled={!view.customApi.configured || busy}
                  onChange={() => void choose("custom")}
                />
                <span>
                  <span className="font-medium">自定义 OpenAI 兼容接口</span>
                  {view.customApi.configured ? (
                    <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                      直连你保存在稿库里的接口，例如 DeepSeek。不经 DSH，也不经 purge。
                    </span>
                  ) : (
                    <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                      还没填全（缺 {view.customApi.missing.join("、")}）。先在下面保存三项再选。空着也不会让页面崩溃。
                    </span>
                  )}
                </span>
              </label>
              <label
                className={`flex gap-3 rounded-lg border px-3 py-3 ${selected === "dsh" ? "border-primary bg-accent/60" : "border-border"} ${view.dshConfigured ? "cursor-pointer" : "cursor-not-allowed opacity-70"}`}
              >
                <input
                  type="radio"
                  name="preferredTextRoute"
                  value="dsh"
                  className="mt-1 accent-[#8f2d2a]"
                  checked={selected === "dsh"}
                  disabled={!view.dshConfigured || busy}
                  onChange={() => void choose("dsh")}
                />
                <span>
                  <span className="font-medium">经 DSH（可选）</span>
                  {view.dshConfigured ? (
                    <span className="mt-1 block text-sm leading-6 text-muted-foreground">更慢。轮询会话，purge 随这次回复生效。不是本机的默认路径。</span>
                  ) : (
                    <span className="mt-1 block text-sm leading-6 text-muted-foreground">{dshBlockedCopy(view.dshMissing)}</span>
                  )}
                </span>
              </label>
            </fieldset>
            <div className="mt-4 space-y-2">
              <Label htmlFor="dsh-model">经 DSH 时的模型</Label>
              <p className="text-sm leading-6 text-muted-foreground">
                下拉是向当前内核的 session/modelCatalog 实拉的，只列出这次能路由的模型。目录里已经有的 DeepSeek 不用再登记。不选则新开会话沿用模板会话当前的模型。目录没拉下来也不挡出字。选了之后仍经 DSH，purge 还在，不会把自定义 API 的密钥塞进会话。
              </p>
              {!view.dshConfigured ? <p className="text-sm leading-6 text-muted-foreground">未配齐 DSH，不能拉模型目录。</p> : null}
              {view.dshConfigured && !view.dshCatalog.loaded ? (
                <p className="rounded-lg border border-[#e0c4a4] bg-[#fbf3e4] px-3 py-2 text-sm leading-6">
                  {view.dshCatalog.error} 目录没拉下来，不挡出字：经 DSH 时沿用模板会话当前模型。
                </p>
              ) : null}
              {view.dshConfigured && view.dshCatalog.loaded ? (
                <select
                  id="dsh-model"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  value={view.dshModel ? modelValue(view.dshModel) : ""}
                  disabled={busy}
                  onChange={(event) => void chooseDshModel(event.target.value)}
                >
                  <option value="">{defaultModelLabel(view.dshCatalog.defaultModel)}</option>
                  {view.dshModel &&
                  !view.dshCatalog.options.some((item) => item.provider === view.dshModel?.provider && item.model === view.dshModel?.model) ? (
                    <option value={modelValue(view.dshModel)}>
                      {view.dshModel.provider} / {view.dshModel.model}（这次目录里没有）
                    </option>
                  ) : null}
                  {view.dshCatalog.options.map((option) => (
                    <option key={modelValue(option)} value={modelValue(option)}>
                      {option.name === option.model ? "" : `${option.name} · `}
                      {option.provider} / {option.model}
                    </option>
                  ))}
                </select>
              ) : null}
              {view.dshCatalog.failures.length > 0 ? (
                <p className="text-sm leading-6 text-muted-foreground">
                  有的提供方这次没列出来：
                  {view.dshCatalog.failures.map((item) => `${item.name}${item.message ? `（${item.message}）` : ""}`).join("、")}
                </p>
              ) : null}
            </div>
            <p className="mt-4 text-sm">
              当前实际出字：
              {view.purgeEnabled && view.preferredTextRoute === "custom"
                ? "经 DSH，用这把自备 Key，并走 purge"
                : routeMark(view.textRoute)}
              。
            </p>
            {view.textRouteNote ? (
              <p className="mt-3 rounded-lg border border-[#e0c4a4] bg-[#fbf3e4] px-3 py-2 text-sm leading-6">{view.textRouteNote}</p>
            ) : null}
          </section>
        ) : null}
        {view && sections.showCustomApi ? (
          <section aria-labelledby="custom-api-title" className="sheet rounded-lg border border-border px-4 py-4">
            <h2 id="custom-api-title" className="text-base font-medium">
              自定义 OpenAI 兼容接口（推荐）
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              这是本机推荐的出字方式：任意 OpenAI Chat Completions 兼容接口，例如 DeepSeek。官方根地址是 {DEEPSEEK_OPENAI_BASE_URL}，也可以写成 https://api.deepseek.com/v1。建议模型 deepseek-flash 或 deepseek-v4-pro，也可以改成 deepseek-chat、deepseek-reasoner。三项都空着时页面照常打开，并提示你来这里配置，不会崩溃。思考过程不会写入稿子。
            </p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              密钥只存在这台围读的稿库里。页面上只显示末尾四位。密钥框留空表示不修改已保存的密钥。
            </p>
            <div className="mt-4 space-y-3">
              <div className="space-y-2">
                <Label htmlFor="custom-api-base">接口地址</Label>
                <Input
                  id="custom-api-base"
                  value={baseUrl}
                  onChange={(event) => {
                    setBaseUrl(event.target.value);
                  }}
                  placeholder={DEEPSEEK_OPENAI_BASE_URL}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={busy}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="custom-api-key">API Key</Label>
                <Input
                  id="custom-api-key"
                  type="password"
                  value={apiKey}
                  onChange={(event) => {
                    setApiKey(event.target.value);
                  }}
                  placeholder={view.customApi.apiKeyMask ? `已保存 ${view.customApi.apiKeyMask}，留空则不修改` : "粘贴 API Key"}
                  autoComplete="off"
                  disabled={busy}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="custom-api-model">模型</Label>
                <Input
                  id="custom-api-model"
                  value={model}
                  onChange={(event) => {
                    setModel(event.target.value);
                  }}
                  placeholder={DEEPSEEK_PRESET_MODEL}
                  list="custom-api-models"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={busy}
                />
                <datalist id="custom-api-models">
                  {DEEPSEEK_MODEL_SUGGESTIONS.map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
              </div>
            </div>
            <CustomPurgeSwitch
              enabled={view.purgeEnabled === true}
              scope={visibility === "custom-only" ? "custom-only" : "full"}
              disabled={busy}
              onChange={(next) => {
                void setPurge(next);
              }}
            />
            {!sections.showRoutePicker ? (
              <p className="mt-4 text-sm">
                当前实际出字：{view.purgeEnabled ? "经 DSH，用这把自备 Key，并走 purge" : routeMark(view.textRoute)}。
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={applyDeepSeekPreset}>
                填入 DeepSeek
              </Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => void saveCustom(false)}>
                保存接口
              </Button>
              <Button type="button" disabled={busy} onClick={() => void saveCustom(true)}>
                保存并用于出字
              </Button>
              {view.customApi.apiKeyMask ? (
                <Button type="button" variant="outline" disabled={busy} onClick={() => void clearKey()}>
                  清除已存密钥
                </Button>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </Shell>
  );
}
