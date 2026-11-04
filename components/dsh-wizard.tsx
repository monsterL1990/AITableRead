"use client";

import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DSH_PLUGIN_NOTE, DEFAULT_DSH_PROBE_PORTS, parseDshBrowserUrl } from "@/lib/dsh-setup";
import type { DshCatalogView, DshSessionChoice, PublicDshConnection, SettingsResponse } from "@/lib/types";

type ProbeRow = { port: number; url: string; ok: boolean; status?: number; error?: string };

type Step = 1 | 2 | 3 | 4;

function modelValue(option: { provider: string; model: string }): string {
  return `${option.provider}\t${option.model}`;
}

export function DshWizard({
  initial = null,
  onCancel,
  onSaved,
  onUseCustom,
}: {
  initial?: PublicDshConnection | null;
  onCancel: () => void;
  onSaved: (view: SettingsResponse) => void;
  onUseCustom: () => void;
}) {
  const [step, setStep] = useState<Step>(1);
  const [browserUrl, setBrowserUrl] = useState(initial?.baseUrl ?? "");
  const [portsText, setPortsText] = useState(DEFAULT_DSH_PROBE_PORTS.join(", "));
  const [probeRows, setProbeRows] = useState<ProbeRow[] | null>(null);
  const [probing, setProbing] = useState(false);
  const [token, setToken] = useState("");
  const [basicUser, setBasicUser] = useState(initial?.basicUser ?? "");
  const [basicPassword, setBasicPassword] = useState("");
  const [testing, setTesting] = useState(false);
  const [sessions, setSessions] = useState<DshSessionChoice[]>([]);
  const [catalog, setCatalog] = useState<DshCatalogView | null>(null);
  const [testedKey, setTestedKey] = useState("");
  const [sessionId, setSessionId] = useState(initial?.sessionId ?? "");
  const [modelKey, setModelKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const parsed = useMemo(() => parseDshBrowserUrl(browserUrl), [browserUrl]);
  const baseUrl = parsed.ok ? parsed.baseUrl : "";
  const credentialKey = `${baseUrl}\n${token}\n${basicUser}\n${basicPassword}`;
  const tested = testedKey !== "" && testedKey === credentialKey;
  const busy = probing || testing || saving;

  async function probe() {
    setProbing(true);
    setError("");
    setProbeRows(null);
    const ports = portsText
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch("/api/settings/dsh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "probe", ports }),
        signal: controller.signal,
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; results?: ProbeRow[] };
      if (!response.ok || !Array.isArray(data.results)) {
        setError(data.error || "探测没有完成。");
        setProbeRows([]);
        return;
      }
      setProbeRows(data.results);
    } catch {
      setError(controller.signal.aborted ? "探测超时，没有一直等下去。" : "探测没有完成。");
      setProbeRows([]);
    } finally {
      clearTimeout(timer);
      setProbing(false);
    }
  }

  async function testConnection() {
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    if (!token.trim()) {
      setError("要填写 DSH 令牌。");
      return;
    }
    setTesting(true);
    setError("");
    setTestedKey("");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch("/api/settings/dsh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "test",
          baseUrl: parsed.baseUrl,
          token,
          basicUser,
          basicPassword,
        }),
        signal: controller.signal,
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        sessions?: DshSessionChoice[];
        catalog?: DshCatalogView;
      };
      if (!response.ok || !Array.isArray(data.sessions)) {
        setError(data.error || "连接测试没有通过。");
        return;
      }
      setSessions(data.sessions);
      setCatalog(data.catalog ?? null);
      setTestedKey(credentialKey);
      if (!data.sessions.some((item) => item.sessionId === sessionId)) {
        setSessionId(data.sessions[0]?.sessionId ?? "");
      }
      setStep(4);
    } catch {
      setError(controller.signal.aborted ? "连接测试超时，没有一直等下去。" : "连接测试没有通过。");
    } finally {
      clearTimeout(timer);
      setTesting(false);
    }
  }

  async function save() {
    if (!parsed.ok || !tested || !sessionId) return;
    setSaving(true);
    setError("");
    try {
      const picked = modelKey
        ? (() => {
            const [provider, model] = modelKey.split("\t");
            return provider && model ? { provider, model } : null;
          })()
        : null;
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dsh: {
            baseUrl: parsed.baseUrl,
            token,
            sessionId,
            basicUser,
            basicPassword,
          },
          dshModel: picked,
          preferredTextRoute: "dsh",
        }),
      });
      const data = (await response.json().catch(() => ({}))) as SettingsResponse & { error?: string };
      if (!response.ok || !data.textRoute || !data.dshConnection) {
        setError(data.error || "没能保存 DSH 连接。");
        return;
      }
      setSaved(true);
      onSaved(data);
      toast.success("已保存 DSH 连接。");
    } catch {
      setError("没能保存 DSH 连接。");
    } finally {
      setSaving(false);
    }
  }

  if (saved) {
    return (
      <section className="sheet rounded-lg border border-border px-4 py-4" aria-labelledby="dsh-wizard-done">
        <h2 id="dsh-wizard-done" className="text-base font-medium">
          已连上你的 DSH
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{DSH_PLUGIN_NOTE}</p>
        <div className="mt-4">
          <Button type="button" onClick={onCancel}>
            完成
          </Button>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-3" aria-label="连接 DSH">
      <StepCard
        n={1}
        title="你有自己的 DSH 吗？"
        active={step === 1}
        done={step > 1}
        onEdit={() => setStep(1)}
      >
        <p className="text-sm leading-6 text-muted-foreground">
          围读默认走自定义 OpenAI 兼容接口。DSH 是可选项，要你自己在本机或自建主机上跑着。没有的话，不用装。
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setError("");
              onUseCustom();
            }}
          >
            没有，去用自定义接口
          </Button>
          <Button
            type="button"
            onClick={() => {
              setError("");
              setStep(2);
            }}
          >
            有，继续
          </Button>
        </div>
      </StepCard>

      <StepCard n={2} title="粘贴浏览器里的 DSH 地址" active={step === 2} done={step > 2} onEdit={() => setStep(2)}>
        <p className="text-sm leading-6 text-muted-foreground">
          粘贴你打开 DSH 时地址栏里的那一段。围读只留下协议、主机和端口。
        </p>
        <div className="mt-3 space-y-2">
          <Label htmlFor="dsh-browser-url">浏览器地址</Label>
          <Input
            id="dsh-browser-url"
            value={browserUrl}
            onChange={(event) => {
              setBrowserUrl(event.target.value);
              setTestedKey("");
            }}
            placeholder="http://127.0.0.1:3099"
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
          />
          {browserUrl.trim() && parsed.ok ? (
            <p className="text-sm leading-6 text-muted-foreground">
              Base URL：<span className="font-mono text-xs text-foreground">{parsed.baseUrl}</span>
              {parsed.basicUser ? "。地址里的用户名会带到下一步的 Basic Auth，不会写进 Base URL。" : ""}
            </p>
          ) : null}
          {browserUrl.trim() && !parsed.ok ? <p className="text-sm leading-6 text-destructive">{parsed.error}</p> : null}
        </div>
        <div className="mt-4 space-y-2">
          <Label htmlFor="dsh-probe-ports">本机端口</Label>
          <Input
            id="dsh-probe-ports"
            value={portsText}
            onChange={(event) => setPortsText(event.target.value)}
            placeholder={DEFAULT_DSH_PROBE_PORTS.join(", ")}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
          />
          <p className="text-sm leading-6 text-muted-foreground">可选。只探测这台机器的 127.0.0.1，失败会停下来，不会一直转。</p>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void probe()}>
            {probing ? "正在探测…" : "探测常见本机端口"}
          </Button>
          {probeRows ? (
            <ul className="space-y-1 text-sm leading-6">
              {probeRows.length === 0 ? <li className="text-muted-foreground">没有端口可探。</li> : null}
              {probeRows.map((row) => (
                <li key={row.port}>
                  {row.ok ? (
                    <button
                      type="button"
                      className="underline underline-offset-4"
                      onClick={() => {
                        setBrowserUrl(row.url);
                        setTestedKey("");
                      }}
                    >
                      {row.url} 有应答{typeof row.status === "number" ? `（${row.status}）` : ""}，用这个地址
                    </button>
                  ) : (
                    <span className="text-muted-foreground">
                      {row.port} {row.error || "没有应答"}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => setStep(1)}>
            上一步
          </Button>
          <Button
            type="button"
            disabled={busy || !parsed.ok}
            onClick={() => {
              if (!parsed.ok) return;
              if (parsed.basicUser) setBasicUser(parsed.basicUser);
              if (parsed.basicPassword) setBasicPassword(parsed.basicPassword);
              setError("");
              setStep(3);
            }}
          >
            下一步
          </Button>
        </div>
      </StepCard>

      <StepCard n={3} title="令牌和可选的 Basic Auth" active={step === 3} done={step > 3 && tested} onEdit={() => setStep(3)}>
        <p className="text-sm leading-6 text-muted-foreground">
          填这套 DSH web 的启动令牌。如果前面还有 Basic Auth，用户名和密码分开填，没有就留空。然后测试连接：列出会话，能拉到模型目录也会一并带上。
        </p>
        <div className="mt-3 space-y-3">
          <div className="space-y-2">
            <Label htmlFor="dsh-token">Token</Label>
            <Input
              id="dsh-token"
              type="password"
              value={token}
              onChange={(event) => {
                setToken(event.target.value);
                setTestedKey("");
              }}
              placeholder={initial?.tokenMask ? `已保存 ${initial.tokenMask}，重连请再贴一次` : "粘贴启动令牌"}
              autoComplete="off"
              disabled={busy}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dsh-basic-user">Basic Auth 用户名（可选）</Label>
            <Input
              id="dsh-basic-user"
              value={basicUser}
              onChange={(event) => {
                setBasicUser(event.target.value);
                setTestedKey("");
              }}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dsh-basic-password">Basic Auth 密码（可选）</Label>
            <Input
              id="dsh-basic-password"
              type="password"
              value={basicPassword}
              onChange={(event) => {
                setBasicPassword(event.target.value);
                setTestedKey("");
              }}
              placeholder={initial?.hasBasicPassword ? "已保存过密码。测试连接请再填一次" : ""}
              autoComplete="off"
              disabled={busy}
            />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => setStep(2)}>
            上一步
          </Button>
          <Button type="button" disabled={busy || !parsed.ok} onClick={() => void testConnection()}>
            {testing ? "正在测试…" : "测试连接"}
          </Button>
        </div>
      </StepCard>

      <StepCard n={4} title="选择会话和模型" active={step === 4} done={false} onEdit={() => tested && setStep(4)}>
        {tested ? (
          <>
            <p className="text-sm leading-6 text-muted-foreground">
              找到 {sessions.length} 个会话
              {catalog?.loaded ? `，${catalog.options.length} 个模型` : "。模型目录这次没拉下来，可以先沿用会话当前的模型"}。
              保存后出字走这条。{DSH_PLUGIN_NOTE}
            </p>
            <div className="mt-3 space-y-3">
              <div className="space-y-2">
                <Label htmlFor="dsh-session">会话</Label>
                <select
                  id="dsh-session"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  value={sessionId}
                  disabled={busy}
                  onChange={(event) => setSessionId(event.target.value)}
                >
                  {sessions.map((item) => (
                    <option key={item.sessionId} value={item.sessionId}>
                      {item.title === item.sessionId ? item.sessionId : `${item.title} · ${item.sessionId}`}
                      {item.running ? "（正在写）" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="dsh-wizard-model">模型（可选）</Label>
                {catalog?.loaded ? (
                  <select
                    id="dsh-wizard-model"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                    value={modelKey}
                    disabled={busy}
                    onChange={(event) => setModelKey(event.target.value)}
                  >
                    <option value="">沿用会话当前的模型</option>
                    {catalog.options.map((option) => (
                      <option key={modelValue(option)} value={modelValue(option)}>
                        {option.name === option.model ? "" : `${option.name} · `}
                        {option.provider} / {option.model}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p id="dsh-wizard-model" className="text-sm leading-6 text-muted-foreground">
                    {catalog?.error || "模型目录没拉下来。"} 保存后仍可选「沿用会话当前的模型」。
                  </p>
                )}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => setStep(3)}>
                上一步
              </Button>
              <Button type="button" disabled={busy || !sessionId} onClick={() => void save()}>
                {saving ? "正在保存…" : "保存并用于出字"}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm leading-6 text-muted-foreground">先在上一步通过连接测试，再选会话。</p>
        )}
      </StepCard>

      {error ? <p className="text-sm leading-6 text-destructive">{error}</p> : null}
      <div>
        <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
          取消
        </Button>
      </div>
    </div>
  );
}

function StepCard({
  n,
  title,
  active,
  done,
  onEdit,
  children,
}: {
  n: Step;
  title: string;
  active: boolean;
  done: boolean;
  onEdit: () => void;
  children: ReactNode;
}) {
  return (
    <section
      className={`sheet rounded-lg border px-4 py-4 ${active ? "border-primary" : "border-border"} ${active ? "" : "opacity-80"}`}
      aria-current={active ? "step" : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-medium">
          {n}. {title}
        </h3>
        {done && !active ? (
          <Button type="button" variant="outline" onClick={onEdit}>
            修改
          </Button>
        ) : null}
      </div>
      {active ? <div className="mt-2">{children}</div> : null}
      {!active && done ? <p className="mt-1 text-sm text-muted-foreground">已完成</p> : null}
    </section>
  );
}
