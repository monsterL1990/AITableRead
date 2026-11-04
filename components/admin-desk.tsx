"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/components/locale-provider";
import { Shell } from "@/components/shell";
import { translate } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locale";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AccountType } from "@/lib/types";

type PublicAccount = {
  uid: string;
  display: string;
  type: AccountType;
  disabled: boolean;
  createdAt: string;
};

export type NewAccountType = "preset-grok" | "preset-ds" | "custom";

export function typeLabel(type: AccountType, locale: Locale = "zh"): string {
  if (type === "owner") return translate(locale, "admin.owner");
  if (type === "preset-grok") return translate(locale, "admin.presetGrok");
  if (type === "preset-ds") return translate(locale, "admin.presetDs");
  return translate(locale, "admin.custom");
}

export function NewAccountTypeField({
  type,
  onChange,
}: {
  type: NewAccountType;
  onChange?: (next: NewAccountType) => void;
}) {
  const { t } = useI18n();
  const choices: { id: NewAccountType; title: string; detail: string }[] = [
    { id: "preset-grok", title: t("admin.presetGrok"), detail: t("admin.grokDetail") },
    { id: "preset-ds", title: t("admin.presetDs"), detail: t("admin.dsDetail") },
    { id: "custom", title: t("admin.custom"), detail: t("admin.customDetail") },
  ];
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{t("admin.type")}</legend>
      {choices.map((choice) => (
        <label key={choice.id} className="flex cursor-pointer gap-3 rounded-lg border border-border px-3 py-3">
          <input
            type="radio"
            name="account-type"
            checked={type === choice.id}
            onChange={() => onChange?.(choice.id)}
          />
          <span>
            <span className="font-medium">{choice.title}</span>
            <span className="mt-1 block text-sm leading-6 text-muted-foreground">{choice.detail}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function AdminClosed() {
  const { t } = useI18n();
  return (
    <Shell>
      <div className="mx-auto max-w-2xl space-y-3">
        <h1 className="text-2xl font-medium">{t("admin.title")}</h1>
        <p className="text-sm leading-6 text-muted-foreground">{t("admin.closed1")}</p>
        <p className="text-sm leading-6 text-muted-foreground">{t("admin.closed2")}</p>
      </div>
    </Shell>
  );
}

export function AdminDesk() {
  const router = useRouter();
  const { t, show, locale } = useI18n();
  const [accounts, setAccounts] = useState<PublicAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uid, setUid] = useState("");
  const [password, setPassword] = useState("");
  const [display, setDisplay] = useState("");
  const [type, setType] = useState<NewAccountType>("preset-grok");
  const [creating, setCreating] = useState(false);
  const [busyUid, setBusyUid] = useState("");
  const [nextPassword, setNextPassword] = useState<Record<string, string>>({});

  async function load() {
    const response = await fetch("/api/admin/accounts");
    if (response.status === 401) {
      router.replace("/login");
      return;
    }
    if (response.status === 403) {
      router.replace("/");
      return;
    }
    if (!response.ok) throw new Error("admin.loadFailed");
    const body = (await response.json()) as { accounts: PublicAccount[] };
    setAccounts(body.accounts);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await load();
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? show(loadError.message) : t("admin.loadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // 只在打开页面时拉一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createAccount() {
    setCreating(true);
    try {
      const response = await fetch("/api/admin/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uid, password, display, type }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        toast.error(data.error ? show(data.error) : t("admin.createFailed"));
        return;
      }
      setUid("");
      setPassword("");
      setDisplay("");
      toast.success(t("admin.created"));
      await load();
    } catch {
      toast.error(t("admin.createFailed"));
    } finally {
      setCreating(false);
    }
  }

  async function patchAccount(name: string, body: { disabled?: boolean; password?: string }, success: string) {
    setBusyUid(name);
    try {
      const response = await fetch(`/api/admin/accounts/${encodeURIComponent(name)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        toast.error(data.error ? show(data.error) : t("admin.updateFailed"));
        return;
      }
      toast.success(success);
      await load();
    } catch {
      toast.error(t("admin.updateFailed"));
    } finally {
      setBusyUid("");
    }
  }

  async function removeAccount(name: string) {
    if (!window.confirm(t("admin.deleteAsk", { name }))) return;
    setBusyUid(name);
    try {
      const response = await fetch(`/api/admin/accounts/${encodeURIComponent(name)}`, { method: "DELETE" });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        toast.error(data.error ? show(data.error) : t("admin.deleteFailed"));
        return;
      }
      toast.success(t("admin.deleted"));
      await load();
    } catch {
      toast.error(t("admin.deleteFailed"));
    } finally {
      setBusyUid("");
    }
  }

  return (
    <Shell>
      <div className="mx-auto max-w-2xl space-y-5">
        <div>
          <h1 className="text-2xl font-medium">{t("admin.title")}</h1>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{t("admin.intro")}</p>
        </div>
        <section className="sheet rounded-lg border border-border px-4 py-4">
          <h2 className="text-base font-medium">{t("admin.newTitle")}</h2>
          <div className="mt-4 space-y-3">
            <div className="space-y-2">
              <Label htmlFor="new-uid">{t("admin.username")}</Label>
              <Input id="new-uid" value={uid} onChange={(event) => setUid(event.target.value)} autoComplete="off" spellCheck={false} />
              <p className="text-sm leading-6 text-muted-foreground">{t("admin.usernameHint")}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">{t("admin.password")}</Label>
              <Input
                id="new-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-display">{t("admin.display")}</Label>
              <Input id="new-display" value={display} onChange={(event) => setDisplay(event.target.value)} autoComplete="off" />
            </div>
            <NewAccountTypeField type={type} onChange={setType} />
            <Button type="button" disabled={creating || !uid.trim() || !password} onClick={() => void createAccount()}>
              {creating ? t("admin.creating") : t("admin.create")}
            </Button>
          </div>
        </section>
        {loading ? <p className="text-sm text-muted-foreground">{t("admin.loading")}</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="space-y-3">
          {accounts.map((account) => {
            const busy = busyUid === account.uid;
            return (
              <section key={account.uid} className="sheet rounded-lg border border-border px-4 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-medium">{account.uid}</h2>
                  <Badge variant="secondary">{typeLabel(account.type, locale)}</Badge>
                  {account.disabled ? <Badge variant="destructive">{t("admin.disabled")}</Badge> : null}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {account.display === "站长" ? t("admin.owner") : account.display}
                  {account.createdAt ? ` · ${account.createdAt.slice(0, 10)}` : ""}
                </p>
                {account.type === "owner" ? (
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("admin.ownerPassword")}</p>
                ) : (
                  <div className="mt-3 space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void patchAccount(account.uid, { disabled: !account.disabled }, account.disabled ? t("admin.enabled") : t("admin.disabledDone"))}
                      >
                        {account.disabled ? t("admin.enable") : t("admin.disable")}
                      </Button>
                      <Button type="button" variant="outline" disabled={busy} onClick={() => void removeAccount(account.uid)}>
                        {t("common.delete")}
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="space-y-2">
                        <Label htmlFor={`reset-${account.uid}`}>{t("admin.reset")}</Label>
                        <Input
                          id={`reset-${account.uid}`}
                          type="password"
                          value={nextPassword[account.uid] ?? ""}
                          onChange={(event) => setNextPassword((current) => ({ ...current, [account.uid]: event.target.value }))}
                          autoComplete="new-password"
                        />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy || !(nextPassword[account.uid] ?? "").trim()}
                        onClick={() => {
                          const next = nextPassword[account.uid] ?? "";
                          void patchAccount(account.uid, { password: next }, t("admin.passwordReset")).then(() => {
                            setNextPassword((current) => ({ ...current, [account.uid]: "" }));
                          });
                        }}
                      >
                        {t("admin.savePassword")}
                      </Button>
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </Shell>
  );
}
