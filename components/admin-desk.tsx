"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Shell } from "@/components/shell";
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

export function typeLabel(type: AccountType): string {
  if (type === "owner") return "站长";
  if (type === "preset-grok") return "预设 Grok";
  if (type === "preset-ds") return "预设 DeepSeek";
  return "非预设";
}

export function NewAccountTypeField({
  type,
  onChange,
}: {
  type: NewAccountType;
  onChange?: (next: NewAccountType) => void;
}) {
  const choices: { id: NewAccountType; title: string; detail: string }[] = [
    {
      id: "preset-grok",
      title: "预设 Grok",
      detail: "没有设置。出字固定经 DSH，模型是站点的 Grok。围读不要求 purge。",
    },
    {
      id: "preset-ds",
      title: "预设 DeepSeek",
      detail: "没有设置。出字固定经 DSH，模型是站点目录里的 DeepSeek。围读不要求 purge。",
    },
    {
      id: "custom",
      title: "非预设",
      detail: "设置里留自定义 API。默认直连。围读不要求 purge。",
    },
  ];
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">类型</legend>
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

export function AdminDesk() {
  const router = useRouter();
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
    if (!response.ok) throw new Error("账号名单没有载入。");
    const body = (await response.json()) as { accounts: PublicAccount[] };
    setAccounts(body.accounts);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await load();
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "账号名单没有载入。");
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
        toast.error(data.error || "账号没能建起来。");
        return;
      }
      setUid("");
      setPassword("");
      setDisplay("");
      toast.success("账号已建好。");
      await load();
    } catch {
      toast.error("账号没能建起来。");
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
        toast.error(data.error || "没能改这个账号。");
        return;
      }
      toast.success(success);
      await load();
    } catch {
      toast.error("没能改这个账号。");
    } finally {
      setBusyUid("");
    }
  }

  async function removeAccount(name: string) {
    if (!window.confirm(`删除账号 ${name}？这个人的稿子、读者和设置会一起删掉。`)) return;
    setBusyUid(name);
    try {
      const response = await fetch(`/api/admin/accounts/${encodeURIComponent(name)}`, { method: "DELETE" });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        toast.error(data.error || "没能删除。");
        return;
      }
      toast.success("账号已删除。");
      await load();
    } catch {
      toast.error("没能删除。");
    } finally {
      setBusyUid("");
    }
  }

  return (
    <Shell>
      <div className="mx-auto max-w-2xl space-y-5">
        <div>
          <h1 className="text-2xl font-medium">账号</h1>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            站长在这里开好友账号。预设 Grok 和预设 DeepSeek 都固定经 DSH，看不到设置。围读不要求 purge。非预设只用自己的 API Key，默认直连。新建的稿库都带 R18读者、怪物Z、中年男。没有邀请码。
          </p>
        </div>
        <section className="sheet rounded-lg border border-border px-4 py-4">
          <h2 className="text-base font-medium">新建账号</h2>
          <div className="mt-4 space-y-3">
            <div className="space-y-2">
              <Label htmlFor="new-uid">账号</Label>
              <Input id="new-uid" value={uid} onChange={(event) => setUid(event.target.value)} autoComplete="off" spellCheck={false} />
              <p className="text-sm leading-6 text-muted-foreground">小写字母开头，可用数字、下划线和短横线。</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">口令</Label>
              <Input
                id="new-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-display">显示名</Label>
              <Input id="new-display" value={display} onChange={(event) => setDisplay(event.target.value)} autoComplete="off" />
            </div>
            <NewAccountTypeField type={type} onChange={setType} />
            <Button type="button" disabled={creating || !uid.trim() || !password} onClick={() => void createAccount()}>
              {creating ? "正在建立…" : "建立账号"}
            </Button>
          </div>
        </section>
        {loading ? <p className="text-sm text-muted-foreground">正在读取账号…</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="space-y-3">
          {accounts.map((account) => {
            const busy = busyUid === account.uid;
            return (
              <section key={account.uid} className="sheet rounded-lg border border-border px-4 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-medium">{account.uid}</h2>
                  <Badge variant="secondary">{typeLabel(account.type)}</Badge>
                  {account.disabled ? <Badge variant="destructive">已停用</Badge> : null}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {account.display}
                  {account.createdAt ? ` · ${account.createdAt.slice(0, 10)}` : ""}
                </p>
                {account.type === "owner" ? (
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">站长口令是环境变量 APP_PASSWORD，不在这里改。</p>
                ) : (
                  <div className="mt-3 space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void patchAccount(account.uid, { disabled: !account.disabled }, account.disabled ? "已启用。" : "已停用。")}
                      >
                        {account.disabled ? "启用" : "停用"}
                      </Button>
                      <Button type="button" variant="outline" disabled={busy} onClick={() => void removeAccount(account.uid)}>
                        删除
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="space-y-2">
                        <Label htmlFor={`reset-${account.uid}`}>重设口令</Label>
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
                          void patchAccount(account.uid, { password: next }, "口令已重设。").then(() => {
                            setNextPassword((current) => ({ ...current, [account.uid]: "" }));
                          });
                        }}
                      >
                        保存新口令
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
