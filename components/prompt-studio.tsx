"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/components/locale-provider";
import { Shell } from "@/components/shell";
import type { MessageId } from "@/lib/i18n/catalog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

async function readPrompts(router: { replace: (href: string) => void }) {
  const response = await fetch("/api/prompts");
  if (response.status === 401) {
    router.replace("/login");
    return null;
  }
  if (!response.ok) throw new Error("prompt.loadFailed");
  return (await response.json()) as { enforced: string; items: PromptItem[] };
}

type PromptItem = {
  key: string;
  label: string;
  description: string;
  text: string;
  customized: boolean;
  defaultText: string;
};

export function PromptStudio() {
  const router = useRouter();
  const { t, show } = useI18n();
  const [enforced, setEnforced] = useState("");
  const [items, setItems] = useState<PromptItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingKey, setSavingKey] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const body = await readPrompts(router);
      if (!body) return;
      setEnforced(body.enforced);
      setItems(body.items);
      setDrafts(Object.fromEntries(body.items.map((item) => [item.key, item.text])));
    } catch (loadError) {
      setError(loadError instanceof Error ? show(loadError.message) : t("prompt.loadFailed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const body = await readPrompts(router);
        if (!body || cancelled) return;
        setEnforced(body.enforced);
        setItems(body.items);
        setDrafts(Object.fromEntries(body.items.map((item) => [item.key, item.text])));
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? show(loadError.message) : t("prompt.loadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Language helpers are closed over for this load only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function save(key: string, text: string) {
    setSavingKey(key);
    try {
      const response = await fetch("/api/prompts", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompts: { [key]: text } }),
      });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      const data = (await response.json().catch(() => ({}))) as { error?: string; items?: PromptItem[] };
      if (!response.ok || !data.items) {
        toast.error(data.error ? show(data.error) : t("prompt.saveFailed"));
        return;
      }
      setItems(data.items);
      setDrafts((current) => {
        const next = { ...current };
        for (const item of data.items ?? []) next[item.key] = item.text;
        return next;
      });
      toast.success(text.trim() ? t("prompt.saved") : t("prompt.restored"));
    } catch {
      toast.error(t("prompt.saveFailed"));
    } finally {
      setSavingKey("");
    }
  }

  return (
    <Shell>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-medium">{t("prompt.title")}</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            {t("prompt.intro")}
          </p>
        </div>
        <section className="sheet rounded-lg border border-border px-4 py-4">
          <h2 className="text-sm font-medium">{t("prompt.hardRule")}</h2>
          <pre className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{enforced || t("prompt.loadingRule")}</pre>
        </section>
        {loading ? <p className="text-sm text-muted-foreground">{t("prompt.loading")}</p> : null}
        {error ? (
          <div className="sheet rounded-lg border border-border px-4 py-5">
            <p className="text-sm">{error}</p>
            <Button type="button" variant="outline" className="mt-3" onClick={() => void load()}>
              {t("common.retry")}
            </Button>
          </div>
        ) : null}
        <div className="space-y-4">
          {items.map((item) => {
            const draft = drafts[item.key] ?? "";
            const dirty = draft !== item.text;
            return (
              <section key={item.key} className="sheet rounded-lg border border-border px-4 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-medium">{t(`prompt.${item.key}.label` as MessageId)}</h2>
                  {item.customized ? <Badge variant="outline">{t("prompt.customized")}</Badge> : <Badge variant="secondary">{t("prompt.default")}</Badge>}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{t(`prompt.${item.key}.description` as MessageId)}</p>
                <Textarea
                  aria-label={t(`prompt.${item.key}.label` as MessageId)}
                  value={draft}
                  onChange={(event) => setDrafts((current) => ({ ...current, [item.key]: event.target.value }))}
                  className="mt-3 min-h-64 font-sans text-sm leading-6"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" disabled={!dirty || savingKey === item.key} onClick={() => void save(item.key, draft)}>
                    {savingKey === item.key ? t("prompt.saving") : t("prompt.save")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!item.customized || savingKey === item.key}
                    onClick={() => void save(item.key, "")}
                  >
                    {t("prompt.restore")}
                  </Button>
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </Shell>
  );
}
