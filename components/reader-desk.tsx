"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/components/locale-provider";
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
  const { t, show } = useI18n();
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
      if (!response.ok) throw new Error("desk.loadFailed");
      const body = (await response.json()) as { readers: ReaderProfile[] };
      apply(body.readers);
    } catch (loadError) {
      setError(loadError instanceof Error ? show(loadError.message) : t("desk.loadFailed"));
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
        if (!response.ok) throw new Error("desk.loadFailed");
        const body = (await response.json()) as { readers: ReaderProfile[] };
        if (cancelled) return;
        apply(body.readers);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? show(loadError.message) : t("desk.loadFailed"));
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

  async function createReader() {
    if (!name.trim() || !prompt.trim()) {
      toast.error(t("desk.needNamePrompt"));
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
        toast.error(data.error ? show(data.error) : t("desk.addFailed"));
        return;
      }
      apply([...readers, data.reader]);
      setName("");
      setBlurb("");
      setPrompt("");
      toast.success(t("desk.added"));
    } catch {
      toast.error(t("desk.addFailed"));
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
      toast.error(data.error ? show(data.error) : t("desk.saveFailed"));
      return;
    }
    apply(readers.map((item) => (item.id === reader.id ? data.reader! : item)));
    toast.success(t("desk.saved"));
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
      toast.error(data.error ? show(data.error) : t("desk.hideFailed"));
      return;
    }
    apply(readers.map((item) => (item.id === reader.id ? data.reader! : item)));
  }

  async function draftFromSpec() {
    if (!requirement.trim()) {
      toast.error(t("desk.needRequirement"));
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
        toast.error(data.error ? show(data.error) : t("desk.draftFailed"));
        return;
      }
      apply([...readers, data.reader]);
      setRequirement("");
      setFiles([]);
      setFileKey((key) => key + 1);
      toast.success(t("desk.drafted"));
    } catch {
      toast.error(t("desk.draftFailed"));
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
      toast.error(t("desk.deleteFailed"));
      return;
    }
    apply(readers.filter((item) => item.id !== reader.id));
    setPendingDelete(null);
    toast.success(t("desk.deleted"));
  }

  return (
    <Shell>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-medium">{t("desk.title")}</h1>
          <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
            {t("desk.intro")}
          </p>
        </div>
        {loading ? <p className="text-sm text-muted-foreground">{t("desk.loading")}</p> : null}
        {error ? (
          <div className="sheet rounded-lg border border-border px-4 py-5">
            <p className="text-sm">{error}</p>
            <Button type="button" variant="outline" className="mt-3" onClick={() => void load()}>
              {t("common.retry")}
            </Button>
          </div>
        ) : null}
        {!loading && !error && readers.length === 0 ? (
          <div className="sheet rounded-lg border border-dashed border-border px-6 py-8">
            <h2 className="text-lg font-medium">{t("desk.emptyTitle")}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{t("desk.emptyBody")}</p>
          </div>
        ) : null}
        <ul className="space-y-4">
          {readers.map((reader) => {
            const draft = drafts[reader.id] ?? { name: reader.name, blurb: reader.blurb, prompt: reader.prompt };
            return (
              <li key={reader.id} className="sheet space-y-3 rounded-lg border border-border px-4 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={reader.blocked ? "outline" : "secondary"}>{reader.blocked ? t("desk.hidden") : t("desk.active")}</Badge>
                  <Badge variant="outline">{reader.origin === "builtin" ? t("desk.originBuiltin") : reader.origin === "from-spec" ? t("desk.originSpec") : t("desk.originManual")}</Badge>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor={`name-${reader.id}`}>{t("desk.name")}</Label>
                    <Input id={`name-${reader.id}`} value={draft.name} onChange={(event) => setDrafts({ ...drafts, [reader.id]: { ...draft, name: event.target.value } })} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`blurb-${reader.id}`}>{t("desk.blurb")}</Label>
                    <Input id={`blurb-${reader.id}`} value={draft.blurb} onChange={(event) => setDrafts({ ...drafts, [reader.id]: { ...draft, blurb: event.target.value } })} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`prompt-${reader.id}`}>{t("desk.prompt")}</Label>
                  <Textarea id={`prompt-${reader.id}`} value={draft.prompt} onChange={(event) => setDrafts({ ...drafts, [reader.id]: { ...draft, prompt: event.target.value } })} className="min-h-36" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={() => void save(reader)}>{t("desk.save")}</Button>
                  <Button type="button" variant="outline" onClick={() => void toggle(reader)}>
                    {reader.blocked ? t("desk.unhide") : t("desk.hide")}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setPendingDelete(reader)}>{t("desk.delete")}</Button>
                </div>
              </li>
            );
          })}
        </ul>
        <section className="sheet space-y-3 rounded-lg border border-border px-4 py-4">
          <h2 className="text-base font-medium">{t("desk.fromSpecTitle")}</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            {t("desk.fromSpecBody")}
          </p>
          <div className="space-y-1">
            <Label htmlFor="reader-requirement">{t("desk.requirement")}</Label>
            <Textarea id="reader-requirement" value={requirement} onChange={(event) => setRequirement(event.target.value)} className="min-h-24" placeholder={t("desk.requirementPlaceholder")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="reader-files">{t("desk.files")}</Label>
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
            {drafting ? t("desk.drafting") : t("desk.draft")}
          </Button>
        </section>
        <section className="sheet space-y-3 rounded-lg border border-border px-4 py-4">
          <h2 className="text-base font-medium">{t("desk.addTitle")}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="new-reader-name">{t("desk.newName")}</Label>
              <Input id="new-reader-name" value={name} onChange={(event) => setName(event.target.value)} placeholder={t("desk.newNamePlaceholder")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-reader-blurb">{t("desk.newBlurb")}</Label>
              <Input id="new-reader-blurb" value={blurb} onChange={(event) => setBlurb(event.target.value)} placeholder={t("desk.newBlurbPlaceholder")} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-reader-prompt">{t("desk.newPrompt")}</Label>
            <Textarea id="new-reader-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} className="min-h-32" placeholder={t("desk.newPromptPlaceholder")} />
          </div>
          <Button type="button" disabled={creating} onClick={() => void createReader()}>
            {creating ? t("desk.adding") : t("desk.add")}
          </Button>
        </section>
      </div>
      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("desk.deleteAsk", { name: pendingDelete?.name ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>{t("desk.deleteBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("desk.keep")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => pendingDelete && void remove(pendingDelete)}>{t("desk.delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Shell>
  );
}
