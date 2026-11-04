"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LanguageSwitch } from "@/components/language-switch";
import { useI18n } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PublicConfig } from "@/lib/types";

export function LoginForm() {
  const router = useRouter();
  const { t, show } = useI18n();
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
        setError(data.error ? show(data.error) : t("login.failed"));
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError(t("login.failed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-full items-center justify-center px-4 py-16">
      <form onSubmit={submit} className="sheet w-full max-w-md rounded-lg border border-border px-6 py-7">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="seal">围</span>
            <h1 className="text-2xl font-medium">{t("login.brand")}</h1>
          </div>
          <LanguageSwitch />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{t("login.tagline")}</p>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("login.body")}</p>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("login.api")}</p>
        <div className="mt-6 space-y-2">
          <Label htmlFor="uid">{t("login.username")}</Label>
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
          <Label htmlFor="password">{t("login.password")}</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {config?.devPasswordHint ? (
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("login.devHint")}</p>
        ) : null}
        {config && !config.authConfigured ? (
          <p className="mt-3 text-sm leading-6 text-destructive">{t("login.prodHint")}</p>
        ) : null}
        {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
        <Button type="submit" size="lg" className="mt-5 w-full" disabled={pending || !uid.trim() || !password}>
          {pending ? t("login.submitting") : t("login.submit")}
        </Button>
        <p className="mt-4 text-center text-sm">
          <Link href="/docs" className="text-primary underline-offset-4 hover:underline">
            {t("login.docs")}
          </Link>
        </p>
        <p className="mt-5 text-xs leading-5 text-muted-foreground">{t("login.adults")}</p>
      </form>
    </main>
  );
}
