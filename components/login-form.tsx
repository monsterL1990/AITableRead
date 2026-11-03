"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PublicConfig } from "@/lib/types";

export function LoginForm() {
  const router = useRouter();
  const [uid, setUid] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [config, setConfig] = useState<PublicConfig | null>(null);

  useEffect(() => {
    void fetch("/api/config")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: PublicConfig | null) => setConfig(body))
      .catch(() => setConfig(null));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uid, password }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(data.error || "进不去。");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("进不去。");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-full items-center justify-center px-4 py-16">
      <form onSubmit={submit} className="sheet w-full max-w-md rounded-lg border border-border px-6 py-7">
        <div className="flex items-center gap-2">
          <span className="seal">围</span>
          <h1 className="text-2xl font-medium">围读</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">围读·AI写作围读工作流</p>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          登录后只看自己的稿。可以从想法、大纲或一份完整稿件开始。每一步改到认可再确认，读者可请可不请。没有公开注册。
        </p>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          本机用你自己的 OpenAI 兼容接口。密钥可以先空着：进入之后如果还没接上，页面会提示你去设置里配置 API，不会因此打不开。
        </p>
        <div className="mt-6 space-y-2">
          <Label htmlFor="uid">账号</Label>
          <Input
            id="uid"
            autoComplete="username"
            value={uid}
            onChange={(event) => setUid(event.target.value)}
            autoFocus
            spellCheck={false}
          />
        </div>
        <div className="mt-4 space-y-2">
          <Label htmlFor="password">口令</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {config?.devPasswordHint ? (
          <p className="mt-3 text-sm leading-6 text-muted-foreground">开发环境未设置 APP_PASSWORD 或 AUTH_PASSWORD，口令是 changeme。</p>
        ) : null}
        {config && !config.authConfigured ? (
          <p className="mt-3 text-sm leading-6 text-destructive">生产环境必须设置 APP_PASSWORD 或 AUTH_PASSWORD。</p>
        ) : null}
        {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
        <Button type="submit" size="lg" className="mt-5 w-full" disabled={pending || !uid.trim() || !password}>
          {pending ? "正在进入…" : "进入稿房"}
        </Button>
        <p className="mt-4 text-center text-sm">
          <Link href="/docs" className="text-primary underline-offset-4 hover:underline">
            说明文档
          </Link>
        </p>
        <p className="mt-5 text-xs leading-5 text-muted-foreground">只写作成年角色。未成年或年龄含糊的性内容会在生成时被拒绝。</p>
      </form>
    </main>
  );
}
