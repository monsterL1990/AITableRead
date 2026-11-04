"use client";

import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useI18n } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DSH_DEDICATED_SESSION_NOTE, DSH_PLUGIN_NOTE, DSH_TOKEN_HELP, DEFAULT_DSH_PROBE_PORTS, dshAdvancedSummary, parseDshBrowserUrl, readDshTokenInput } from "@/lib/dsh-setup";
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
  const { t, show } = useI18n();
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
  const [dedicatedSessionId, setDedicatedSessionId] = useState("");
  const [advancedSessionId, setAdvancedSessionId] = useState("");
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
        setError(data.error || "wizard.probeFailed");
        setProbeRows([]);
        return;
      }
      setProbeRows(data.results);
    } catch {
      setError(controller.signal.aborted ? "wizard.probeTimeout" : "wizard.probeFailed");
      setProbeRows([]);
    } finally {
      clearTimeout(timer);
      setProbing(false);
    }
  }

  async function testConnection() {
    const read = readDshTokenInput(token);
    const urlInput = read.baseUrl || browserUrl;
    const nextParsed = parseDshBrowserUrl(urlInput);
    if (!nextParsed.ok) {
      setError(nextParsed.error);
      return;
    }
    if (!read.token.trim()) {
      setError("wizard.needToken");
      return;
    }
    if (read.baseUrl) setBrowserUrl(read.baseUrl);
    if (read.token !== token) setToken(read.token);
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
          baseUrl: nextParsed.baseUrl,
          token: read.token,
          basicUser,
          basicPassword,
        }),
        signal: controller.signal,
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        sessions?: DshSessionChoice[];
        catalog?: DshCatalogView;
        dedicatedSession?: DshSessionChoice;
      };
      if (!response.ok || !data.dedicatedSession?.sessionId) {
        setError(data.error || "wizard.sessionFailed");
        return;
      }
      setSessions(data.sessions ?? []);
      setCatalog(data.catalog ?? null);
      setDedicatedSessionId(data.dedicatedSession.sessionId);
      setAdvancedSessionId("");
      setTestedKey(`${nextParsed.baseUrl}\n${read.token}\n${basicUser}\n${basicPassword}`);
      setStep(4);
    } catch {
      setError(controller.signal.aborted ? "wizard.testTimeout" : "wizard.testFailed");
    } finally {
      clearTimeout(timer);
      setTesting(false);
    }
  }

  async function save() {
    const sessionId = advancedSessionId.trim() || dedicatedSessionId;
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
        setError(data.error || "wizard.saveFailed");
        return;
      }
      setSaved(true);
      onSaved(data);
      toast.success(t("wizard.saved"));
    } catch {
      setError("wizard.saveFailed");
    } finally {
      setSaving(false);
    }
  }

  if (saved) {
    return (
      <section className="sheet rounded-lg border border-border px-4 py-4" aria-labelledby="dsh-wizard-done">
        <h2 id="dsh-wizard-done" className="text-base font-medium">
          {t("wizard.doneTitle")}
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{show(DSH_DEDICATED_SESSION_NOTE)}</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{show(DSH_PLUGIN_NOTE)}</p>
        <div className="mt-4">
          <Button type="button" onClick={onCancel}>
            {t("wizard.done")}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-3" aria-label={t("wizard.group")}>
      <StepCard
        n={1}
        title={t("wizard.askTitle")}
        active={step === 1}
        done={step > 1}
        onEdit={() => setStep(1)}
      >
        <p className="text-sm leading-6 text-muted-foreground">
          {t("wizard.askBody")}
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
            {t("wizard.noDsh")}
          </Button>
          <Button
            type="button"
            onClick={() => {
              setError("");
              setStep(2);
            }}
          >
            {t("wizard.yesDsh")}
          </Button>
        </div>
      </StepCard>

      <StepCard n={2} title={t("wizard.urlTitle")} active={step === 2} done={step > 2} onEdit={() => setStep(2)}>
        <p className="text-sm leading-6 text-muted-foreground">
          {t("wizard.urlBody")}
        </p>
        <div className="mt-3 space-y-2">
          <Label htmlFor="dsh-browser-url">{t("wizard.urlLabel")}</Label>
          <Input
            id="dsh-browser-url"
            value={browserUrl}
            onChange={(event) => {
              setBrowserUrl(event.target.value);
              setTestedKey("");
            }}
            placeholder="http://127.0.0.1:3080"
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
          />
          {browserUrl.trim() && parsed.ok ? (
            <p className="text-sm leading-6 text-muted-foreground">
              Base URL：<span className="font-mono text-xs text-foreground">{parsed.baseUrl}</span>
              {parsed.basicUser ? t("wizard.urlBasic") : ""}
            </p>
          ) : null}
          {browserUrl.trim() && !parsed.ok ? <p className="text-sm leading-6 text-destructive">{parsed.error}</p> : null}
        </div>
        <div className="mt-4 space-y-2">
          <Label htmlFor="dsh-probe-ports">{t("wizard.ports")}</Label>
          <Input
            id="dsh-probe-ports"
            value={portsText}
            onChange={(event) => setPortsText(event.target.value)}
            placeholder={DEFAULT_DSH_PROBE_PORTS.join(", ")}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
          />
          <p className="text-sm leading-6 text-muted-foreground">{t("wizard.portsHelp")}</p>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void probe()}>
            {probing ? t("wizard.probing") : t("wizard.probe")}
          </Button>
          {probeRows ? (
            <ul className="space-y-1 text-sm leading-6">
              {probeRows.length === 0 ? <li className="text-muted-foreground">{t("wizard.noPorts")}</li> : null}
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
                      {t("wizard.probeHit", { url: row.url, status: typeof row.status === "number" ? t("wizard.probeStatus", { status: row.status }) : "" })}
                    </button>
                  ) : (
                    <span className="text-muted-foreground">
                      {t("wizard.probeMiss", { port: row.port, error: row.error ? show(row.error) : t("wizard.noAnswer") })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => setStep(1)}>
            {t("common.back")}
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
            {t("common.next")}
          </Button>
        </div>
      </StepCard>

      <StepCard n={3} title={t("wizard.tokenTitle")} active={step === 3} done={step > 3 && tested} onEdit={() => setStep(3)}>
        <p className="text-sm leading-6 text-muted-foreground">
          {t("wizard.tokenBody")}
        </p>
        <div className="mt-3 space-y-3">
          <div className="space-y-2">
            <Label htmlFor="dsh-token">Token</Label>
            <Input
              id="dsh-token"
              type="password"
              value={token}
              onChange={(event) => {
                const read = readDshTokenInput(event.target.value);
                if (read.baseUrl) {
                  setBrowserUrl(read.baseUrl);
                  setToken(read.token);
                } else {
                  setToken(event.target.value);
                }
                setTestedKey("");
              }}
              placeholder={initial?.tokenMask ? t("wizard.tokenKept", { mask: initial.tokenMask }) : t("wizard.tokenPlaceholder")}
              autoComplete="off"
              disabled={busy}
            />
            <p className="text-sm leading-6 text-muted-foreground">{show(DSH_TOKEN_HELP)}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="dsh-basic-user">{t("wizard.basicUser")}</Label>
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
            <Label htmlFor="dsh-basic-password">{t("wizard.basicPassword")}</Label>
            <Input
              id="dsh-basic-password"
              type="password"
              value={basicPassword}
              onChange={(event) => {
                setBasicPassword(event.target.value);
                setTestedKey("");
              }}
              placeholder={initial?.hasBasicPassword ? t("wizard.basicKept") : ""}
              autoComplete="off"
              disabled={busy}
            />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => setStep(2)}>
            {t("common.back")}
          </Button>
          <Button type="button" disabled={busy || !parsed.ok} onClick={() => void testConnection()}>
            {testing ? t("wizard.testing") : t("wizard.test")}
          </Button>
        </div>
      </StepCard>

      <StepCard n={4} title={t("wizard.modelTitle")} active={step === 4} done={false} onEdit={() => tested && setStep(4)}>
        {tested && dedicatedSessionId ? (
          <>
            <p className="text-sm leading-6 text-muted-foreground">{show(DSH_DEDICATED_SESSION_NOTE)}</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{show(DSH_PLUGIN_NOTE)}</p>
            <div className="mt-3 space-y-3">
              <div className="space-y-2">
                <Label htmlFor="dsh-wizard-model">{t("wizard.modelLabel")}</Label>
                {catalog?.loaded && catalog.options.length > 0 ? (
                  <select
                    id="dsh-wizard-model"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                    value={modelKey}
                    disabled={busy}
                    onChange={(event) => setModelKey(event.target.value)}
                  >
                    <option value="">{t("wizard.useDefault")}</option>
                    {catalog.options.map((option) => (
                      <option key={modelValue(option)} value={modelValue(option)}>
                        {option.name === option.model ? "" : `${option.name} · `}
                        {option.provider} / {option.model}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p id="dsh-wizard-model" className="text-sm leading-6 text-muted-foreground">
                    {catalog?.loaded ? t("wizard.noModels") : show(catalog?.error || "wizard.catalogDown")}
                    {t("wizard.catalogOk")}
                  </p>
                )}
              </div>
              <details className="rounded-lg border border-border px-3 py-2">
                <summary className="cursor-pointer text-sm font-medium">{show(dshAdvancedSummary(Boolean(advancedSessionId.trim())))}</summary>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {t("wizard.advancedHelp")}
                </p>
                <div className="mt-2 space-y-2">
                  <Label htmlFor="dsh-advanced-session">{t("wizard.templateId")}</Label>
                  <Input
                    id="dsh-advanced-session"
                    value={advancedSessionId}
                    onChange={(event) => setAdvancedSessionId(event.target.value)}
                    placeholder={t("wizard.templatePlaceholder")}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={busy}
                  />
                  {sessions.length > 0 ? (
                    <select
                      aria-label={t("wizard.fillSession")}
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                      value={sessions.some((item) => item.sessionId === advancedSessionId) ? advancedSessionId : ""}
                      disabled={busy}
                      onChange={(event) => setAdvancedSessionId(event.target.value)}
                    >
                      <option value="">{t("wizard.noTemplate")}</option>
                      {sessions.map((item) => (
                        <option key={item.sessionId} value={item.sessionId}>
                          {item.title === item.sessionId ? item.sessionId : item.title}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </div>
              </details>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => setStep(3)}>
                {t("common.back")}
              </Button>
              <Button type="button" disabled={busy || !(advancedSessionId.trim() || dedicatedSessionId)} onClick={() => void save()}>
                {saving ? t("wizard.saving") : t("wizard.saveUse")}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm leading-6 text-muted-foreground">{t("wizard.needTest")}</p>
        )}
      </StepCard>

      {error ? <p className="text-sm leading-6 text-destructive">{show(error)}</p> : null}
      <div>
        <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
          {t("wizard.cancel")}
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
  const { t } = useI18n();
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
            {t("wizard.edit")}
          </Button>
        ) : null}
      </div>
      {active ? <div className="mt-2">{children}</div> : null}
      {!active && done ? <p className="mt-1 text-sm text-muted-foreground">{t("wizard.stepDone")}</p> : null}
    </section>
  );
}
