"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ModeBanner } from "@/components/mode-banner";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatWhen } from "@/lib/format";
import { STEPS } from "@/lib/pipeline";
import type { ProjectSummary, PublicConfig, StartFrom } from "@/lib/types";

async function readList(
  router: { replace: (href: string) => void },
  setProjects: (projects: ProjectSummary[]) => void,
  setConfig: (config: PublicConfig | null) => void,
) {
  const [listRes, configRes] = await Promise.all([fetch("/api/projects"), fetch("/api/config")]);
  if (listRes.status === 401) {
    router.replace("/login");
    return;
  }
  if (!listRes.ok) throw new Error("稿单没有载入。");
  const body = (await listRes.json()) as { projects: ProjectSummary[] };
  setProjects(body.projects);
  if (configRes.ok) setConfig((await configRes.json()) as PublicConfig);
}

export function ProjectHome() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [startFrom, setStartFrom] = useState<StartFrom>("idea");
  const [idea, setIdea] = useState("");
  const [outline, setOutline] = useState("");
  const [manuscript, setManuscript] = useState("");
  const [wordMin, setWordMin] = useState("2000");
  const [wordMax, setWordMax] = useState("3500");
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ProjectSummary | null>(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      await readList(router, setProjects, setConfig);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "稿单没有载入。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await readList(router, (projects) => {
          if (!cancelled) setProjects(projects);
        }, (next) => {
          if (!cancelled) setConfig(next);
        });
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "稿单没有载入。");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function createProject() {
    const nextTitle = title.trim();
    if (!nextTitle) {
      toast.error("先写一个标题。");
      return;
    }
    setCreating(true);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: nextTitle,
          startFrom,
          idea,
          outline,
          manuscript,
          wordMin: wordMin.trim() ? Number(wordMin) : null,
          wordMax: wordMax.trim() ? Number(wordMax) : null,
        }),
      });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      const data = (await response.json().catch(() => ({}))) as { error?: string; project?: { id: string } };
      if (!response.ok || !data.project) {
        toast.error(data.error || "没能开稿。");
        return;
      }
      router.push(`/projects/${data.project.id}`);
    } catch {
      toast.error("没能开稿。");
    } finally {
      setCreating(false);
    }
  }

  async function remove(project: ProjectSummary) {
    const response = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
    if (response.status === 401) {
      router.replace("/login");
      return;
    }
    if (!response.ok) {
      toast.error("没能删除。");
      return;
    }
    setProjects((current) => current.filter((item) => item.id !== project.id));
    setPendingDelete(null);
    toast.success("已删除。");
  }

  return (
    <Shell>
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-medium">稿单</h1>
            <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
              三步：想法到大纲，大纲到初稿，稿件到润色。每一步改到认可再确认，确认之前不能跳到下一步。
            </p>
          </div>
          <Button type="button" onClick={() => setOpen(true)}>
            新开一稿
          </Button>
        </div>
        <ModeBanner config={config} />
        {loading ? <p className="text-sm text-muted-foreground">正在读稿单…</p> : null}
        {error ? (
          <div className="sheet rounded-lg border border-border px-4 py-5">
            <p className="text-sm">{error}</p>
            <Button type="button" variant="outline" className="mt-3" onClick={() => void load()}>
              再试一次
            </Button>
          </div>
        ) : null}
        {!loading && !error && projects.length === 0 ? (
          <div className="sheet rounded-lg border border-dashed border-border px-6 py-12">
            <h2 className="text-lg font-medium">还没有稿子</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              可以从一个想法开始，也可以直接放进大纲或一份完整稿件。人物要写成成年人。
            </p>
            <Button type="button" className="mt-4" onClick={() => setOpen(true)}>
              新开一稿
            </Button>
          </div>
        ) : null}
        <ul className="grid gap-3 sm:grid-cols-2">
          {projects.map((project) => {
            const step = STEPS.find((item) => item.id === project.currentStep);
            return (
              <li key={project.id} className="sheet min-w-0 rounded-lg border border-border">
                <div className="flex items-start justify-between gap-3 px-4 pt-4">
                  <div className="min-w-0">
                    <Link href={`/projects/${project.id}`} className="block truncate text-lg font-medium hover:underline">
                      {project.title}
                    </Link>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {step?.title} · {formatWhen(project.updatedAt)}
                    </p>
                  </div>
                  {project.polishConfirmed ? <Badge>润色已确认</Badge> : <Badge variant="outline">进行中</Badge>}
                </div>
                <div className="mt-4 flex min-w-0 items-center justify-between gap-3 border-t border-border px-4 py-3">
                  <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">{project.archivePath}</p>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setPendingDelete(project)}>
                    删除
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>新开一稿</DialogTitle>
            <DialogDescription>选一个起点。目标字数会写进生成和质检。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="new-title">标题</Label>
              <Input id="new-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：回声" />
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">从哪里开始</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {(
                  [
                    ["idea", "从想法"],
                    ["outline", "从大纲"],
                    ["manuscript", "从完整稿件"],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value} className={`cursor-pointer rounded-lg border px-3 py-2 text-sm ${startFrom === value ? "border-primary bg-accent" : "border-border"}`}>
                    <input className="sr-only" type="radio" name="start-from" value={value} checked={startFrom === value} onChange={() => setStartFrom(value)} />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            {startFrom === "idea" ? (
              <div className="space-y-2">
                <Label htmlFor="new-idea">想法</Label>
                <Textarea id="new-idea" value={idea} onChange={(event) => setIdea(event.target.value)} placeholder="两个成年人。他们是谁，想要什么，这一节发生什么。" className="min-h-32" />
              </div>
            ) : null}
            {startFrom === "outline" ? (
              <div className="space-y-2">
                <Label htmlFor="new-outline">大纲</Label>
                <Textarea id="new-outline" value={outline} onChange={(event) => setOutline(event.target.value)} placeholder="节拍写细一点。确认这份大纲之后才能写初稿。" className="min-h-32" />
              </div>
            ) : null}
            {startFrom === "manuscript" ? (
              <div className="space-y-2">
                <Label htmlFor="new-manuscript">完整稿件</Label>
                <Textarea id="new-manuscript" value={manuscript} onChange={(event) => setManuscript(event.target.value)} placeholder="这份稿子直接进入润色。大纲和初稿两步记为已确认。" className="min-h-32" />
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="new-min">目标下限</Label>
                <Input id="new-min" inputMode="numeric" value={wordMin} onChange={(event) => setWordMin(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-max">目标上限</Label>
                <Input id="new-max" inputMode="numeric" value={wordMax} onChange={(event) => setWordMax(event.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="button" disabled={creating || !title.trim()} onClick={() => void createProject()}>
              {creating ? "正在开稿…" : "开始"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={pendingDelete !== null} onOpenChange={(next) => { if (!next) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除「{pendingDelete?.title}」？</AlertDialogTitle>
            <AlertDialogDescription>大纲、初稿、润色稿、版本和流程记录都会去掉，不能恢复。</AlertDialogDescription>
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
