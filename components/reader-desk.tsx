"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Shell } from "@/components/shell";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ReaderProfile } from "@/lib/types";

export function ReaderDesk() {
  const router = useRouter();
  const [readers, setReaders] = useState<ReaderProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [blurb, setBlurb] = useState("");
  const [prompt, setPrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const [requirement, setRequirement] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [fileKey, setFileKey] = useState(0);
  const [drafting, setDrafting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ReaderProfile | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { name: string; blurb: string; prompt: string }>>({});

  function apply(list: ReaderProfile[]) {
    setReaders(list);
    setDrafts(Object.fromEntries(list.map((reader) => [reader.id, { name: reader.name, blurb: reader.blurb, prompt: reader.prompt }])));
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/readers");
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (!response.ok) throw new Error("读者名单没有载入。");
      const body = (await response.json()) as { readers: ReaderProfile[] };
      apply(body.readers);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读者名单没有载入。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/readers");
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (!response.ok) throw new Error("读者名单没有载入。");
        const body = (await response.json()) as { readers: ReaderProfile[] };
        if (cancelled) return;
        apply(body.readers);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "读者名单没有载入。");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function createReader() {
    if (!name.trim() || !prompt.trim()) {
      toast.error("读者要有名字和提示词。");
      return;
    }
    setCreating(true);
    try {
      const response = await fetch("/api/readers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, blurb, prompt }),
      });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      const data = (await response.json().catch(() => ({}))) as { error?: string; reader?: ReaderProfile };
      if (!response.ok || !data.reader) {
        toast.error(data.error || "没能加上。");
        return;
      }
      apply([...readers, data.reader]);
      setName("");
      setBlurb("");
      setPrompt("");
      toast.success("已加上这位读者。");
    } catch {
      toast.error("没能加上。");
    } finally {
      setCreating(false);
    }
  }

  async function save(reader: ReaderProfile) {
    const draft = drafts[reader.id];
    if (!draft) return;
    const response = await fetch(`/api/readers/${reader.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
    });
    if (response.status === 401) {
      router.replace("/login");
      return;
    }
    const data = (await response.json().catch(() => ({}))) as { error?: string; reader?: ReaderProfile };
    if (!response.ok || !data.reader) {
      toast.error(data.error || "没能保存。");
      return;
    }
    apply(readers.map((item) => (item.id === reader.id ? data.reader! : item)));
    toast.success("读者已保存。");
  }

  async function toggle(reader: ReaderProfile) {
    const response = await fetch(`/api/readers/${reader.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ blocked: !reader.blocked }),
    });
    if (response.status === 401) {
      router.replace("/login");
      return;
    }
    const data = (await response.json().catch(() => ({}))) as { error?: string; reader?: ReaderProfile };
    if (!response.ok || !data.reader) {
      toast.error(data.error || "没能改屏蔽。");
      return;
    }
    apply(readers.map((item) => (item.id === reader.id ? data.reader! : item)));
  }

  async function draftFromSpec() {
    if (!requirement.trim()) {
      toast.error("先用一句话写清这位读者要看什么。");
      return;
    }
    setDrafting(true);
    try {
      const body = new FormData();
      body.set("requirement", requirement);
      for (const file of files) body.append("files", file);
      const response = await fetch("/api/readers/from-spec", { method: "POST", body });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      const data = (await response.json().catch(() => ({}))) as { error?: string; reader?: ReaderProfile };
      if (!response.ok || !data.reader) {
        toast.error(data.error || "读者没能生成。");
        return;
      }
      apply([...readers, data.reader]);
      setRequirement("");
      setFiles([]);
      setFileKey((key) => key + 1);
      toast.success("已生成读者。提示词仍可改。");
    } catch {
      toast.error("读者没能生成。");
    } finally {
      setDrafting(false);
    }
  }

  async function remove(reader: ReaderProfile) {
    const response = await fetch(`/api/readers/${reader.id}`, { method: "DELETE" });
    if (response.status === 401) {
      router.replace("/login");
      return;
    }
    if (!response.ok) {
      toast.error("没能删除。");
      return;
    }
    apply(readers.filter((item) => item.id !== reader.id));
    setPendingDelete(null);
    toast.success("已删除这位读者。");
  }

  return (
    <Shell>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-medium">读者</h1>
          <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
            确认某一版时，读者可请可不请。屏蔽后不出现在稿里，也不会被一起叫去看。提示词可以改。也可以只凭一句话需求生成一位读者，文档可选。另接别的模型接口，这一版还没有。
          </p>
        </div>
        {loading ? <p className="text-sm text-muted-foreground">正在读读者名单…</p> : null}
        {error ? (
          <div className="sheet rounded-lg border border-border px-4 py-5">
            <p className="text-sm">{error}</p>
            <Button type="button" variant="outline" className="mt-3" onClick={() => void load()}>
              再试一次
            </Button>
          </div>
        ) : null}
        {!loading && !error && readers.length === 0 ? (
          <div className="sheet rounded-lg border border-dashed border-border px-6 py-8">
            <h2 className="text-lg font-medium">名单是空的</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">可以不请读者，只靠你自己的修改意见确认。要请人看，就在下面加一位。</p>
          </div>
        ) : null}
        <ul className="space-y-4">
          {readers.map((reader) => {
            const draft = drafts[reader.id] ?? { name: reader.name, blurb: reader.blurb, prompt: reader.prompt };
            return (
              <li key={reader.id} className="sheet space-y-3 rounded-lg border border-border px-4 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={reader.blocked ? "outline" : "secondary"}>{reader.blocked ? "已屏蔽" : "会参与"}</Badge>
                  <Badge variant="outline">{reader.origin === "builtin" ? "预置" : reader.origin === "from-spec" ? "按需求生成" : "手加"}</Badge>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor={`name-${reader.id}`}>名字</Label>
                    <Input id={`name-${reader.id}`} value={draft.name} onChange={(event) => setDrafts({ ...drafts, [reader.id]: { ...draft, name: event.target.value } })} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`blurb-${reader.id}`}>简介</Label>
                    <Input id={`blurb-${reader.id}`} value={draft.blurb} onChange={(event) => setDrafts({ ...drafts, [reader.id]: { ...draft, blurb: event.target.value } })} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`prompt-${reader.id}`}>提示词</Label>
                  <Textarea id={`prompt-${reader.id}`} value={draft.prompt} onChange={(event) => setDrafts({ ...drafts, [reader.id]: { ...draft, prompt: event.target.value } })} className="min-h-36" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={() => void save(reader)}>保存</Button>
                  <Button type="button" variant="outline" onClick={() => void toggle(reader)}>
                    {reader.blocked ? "取消屏蔽" : "屏蔽"}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setPendingDelete(reader)}>删除</Button>
                </div>
              </li>
            );
          })}
        </ul>
        <section className="sheet space-y-3 rounded-lg border border-border px-4 py-4">
          <h2 className="text-base font-medium">用一句话生成</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            一句话需求必填，文档可选。写清这位读者看什么。要附口味或参照，再上传 txt、md，或带文字层的 pdf。一次最多 4 份，单份 4MB。扫描件读不了。生成后仍可改提示词、屏蔽或删除。未配置模型时不会假装读过文档。
          </p>
          <div className="space-y-1">
            <Label htmlFor="reader-requirement">一句话需求（必填）</Label>
            <Textarea id="reader-requirement" value={requirement} onChange={(event) => setRequirement(event.target.value)} className="min-h-24" placeholder="例如：看连载追读，专挑节拍被跳过和人物动机接不上的地方。" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="reader-files">文档（可选）</Label>
            <Input
              key={fileKey}
              id="reader-files"
              type="file"
              multiple
              accept=".txt,.md,.markdown,.pdf,text/plain,text/markdown,application/pdf"
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            />
            {files.length ? <p className="text-xs text-muted-foreground">{files.map((file) => file.name).join("、")}</p> : null}
          </div>
          <Button type="button" disabled={drafting} onClick={() => void draftFromSpec()}>
            {drafting ? "正在生成读者…" : "生成读者"}
          </Button>
        </section>
        <section className="sheet space-y-3 rounded-lg border border-border px-4 py-4">
          <h2 className="text-base font-medium">加一位读者</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="new-reader-name">名字</Label>
              <Input id="new-reader-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：连载编辑" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-reader-blurb">简介</Label>
              <Input id="new-reader-blurb" value={blurb} onChange={(event) => setBlurb(event.target.value)} placeholder="这位看什么" />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-reader-prompt">提示词</Label>
            <Textarea id="new-reader-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} className="min-h-32" placeholder="只写审阅要求。成年角色的硬性规则会在调用时另附。" />
          </div>
          <Button type="button" disabled={creating} onClick={() => void createReader()}>
            {creating ? "正在加上…" : "加上"}
          </Button>
        </section>
      </div>
      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除「{pendingDelete?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>之后的审阅不会再叫这位。已经写在稿子里的旧意见还在。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>留下</AlertDialogCancel>
            <AlertDialogAction onClick={() => pendingDelete && void remove(pendingDelete)}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Shell>
  );
}
