"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Shell } from "@/components/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

async function readPrompts(router: { replace: (href: string) => void }) {
  const response = await fetch("/api/prompts");
  if (response.status === 401) {
    router.replace("/login");
    return null;
  }
  if (!response.ok) throw new Error("提示词没有载入。");
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
      setError(loadError instanceof Error ? loadError.message : "提示词没有载入。");
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
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "提示词没有载入。");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
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
        toast.error(data.error || "没能保存提示词。");
        return;
      }
      setItems(data.items);
      setDrafts((current) => {
        const next = { ...current };
        for (const item of data.items ?? []) next[item.key] = item.text;
        return next;
      });
      toast.success(text.trim() ? "已保存这条提示词。" : "已恢复默认。");
    } catch {
      toast.error("没能保存提示词。");
    } finally {
      setSavingKey("");
    }
  }

  return (
    <Shell>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-medium">提示词</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            六条系统提示词可以改。演示模式不会调用它们；接上模型后，生成用的是这里保存的文字。
          </p>
        </div>
        <section className="sheet rounded-lg border border-border px-4 py-4">
          <h2 className="text-sm font-medium">每条提示词末尾都会附上这段，改不掉</h2>
          <pre className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{enforced || "正在读取…"}</pre>
        </section>
        {loading ? <p className="text-sm text-muted-foreground">正在读取提示词…</p> : null}
        {error ? (
          <div className="sheet rounded-lg border border-border px-4 py-5">
            <p className="text-sm">{error}</p>
            <Button type="button" variant="outline" className="mt-3" onClick={() => void load()}>
              再试一次
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
                  <h2 className="text-base font-medium">{item.label}</h2>
                  {item.customized ? <Badge variant="outline">已改过</Badge> : <Badge variant="secondary">默认</Badge>}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
                <Textarea
                  aria-label={item.label}
                  value={draft}
                  onChange={(event) => setDrafts((current) => ({ ...current, [item.key]: event.target.value }))}
                  className="mt-3 min-h-64 font-sans text-sm leading-6"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" disabled={!dirty || savingKey === item.key} onClick={() => void save(item.key, draft)}>
                    {savingKey === item.key ? "正在保存…" : "保存这条"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!item.customized || savingKey === item.key}
                    onClick={() => void save(item.key, "")}
                  >
                    恢复默认
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
