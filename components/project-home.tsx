"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/components/locale-provider";
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
import type { MessageId } from "@/lib/i18n/catalog";
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
  if (!listRes.ok) throw new Error("home.loadFailed");
  const body = (await listRes.json()) as { projects: ProjectSummary[] };
  setProjects(body.projects);
  if (configRes.ok) setConfig((await configRes.json()) as PublicConfig);
}

export function ProjectHome() {
  const router = useRouter();
  const { t, show } = useI18n();
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
      setError(loadError instanceof Error ? show(loadError.message) : t("home.loadFailed"));
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
        if (!cancelled) setError(loadError instanceof Error ? show(loadError.message) : t("home.loadFailed"));
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

  async function createProject() {
    const nextTitle = title.trim();
    if (!nextTitle) {
      toast.error(t("home.needTitle"));
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
        toast.error(data.error ? show(data.error) : t("home.createFailed"));
        return;
      }
      router.push(`/projects/${data.project.id}`);
    } catch {
      toast.error(t("home.createFailed"));
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
      toast.error(t("home.deleteFailed"));
      return;
    }
    setProjects((current) => current.filter((item) => item.id !== project.id));
    setPendingDelete(null);
    toast.success(t("home.deleted"));
  }

  return (
    <Shell>
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-medium">{t("home.title")}</h1>
            <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">{t("home.intro")}</p>
          </div>
          <Button type="button" onClick={() => setOpen(true)}>
            {t("home.new")}
          </Button>
        </div>
        <ModeBanner config={config} />
        {loading ? <p className="text-sm text-muted-foreground">{t("home.loading")}</p> : null}
        {error ? (
          <div className="sheet rounded-lg border border-border px-4 py-5">
            <p className="text-sm">{error}</p>
            <Button type="button" variant="outline" className="mt-3" onClick={() => void load()}>
              {t("common.retry")}
            </Button>
          </div>
        ) : null}
        {!loading && !error && projects.length === 0 ? (
          <div className="sheet rounded-lg border border-dashed border-border px-6 py-12">
            <h2 className="text-lg font-medium">{t("home.emptyTitle")}</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{t("home.emptyBody")}</p>
            <Button type="button" className="mt-4" onClick={() => setOpen(true)}>
              {t("home.new")}
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
                      {step ? t(`step.${step.id}.title` as MessageId) : ""} · {show(formatWhen(project.updatedAt))}
                    </p>
                  </div>
                  {project.polishConfirmed ? <Badge>{t("home.confirmed")}</Badge> : <Badge variant="outline">{t("home.inProgress")}</Badge>}
                </div>
                <div className="mt-4 flex min-w-0 items-center justify-between gap-3 border-t border-border px-4 py-3">
                  <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">{project.archivePath}</p>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setPendingDelete(project)}>
                    {t("home.delete")}
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
            <DialogTitle>{t("home.dialogTitle")}</DialogTitle>
            <DialogDescription>{t("home.dialogBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="new-title">{t("home.titleLabel")}</Label>
              <Input id="new-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t("home.titlePlaceholder")} />
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t("home.startFrom")}</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {(
                  [
                    ["idea", t("home.fromIdea")],
                    ["outline", t("home.fromOutline")],
                    ["manuscript", t("home.fromManuscript")],
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
                <Label htmlFor="new-idea">{t("home.idea")}</Label>
                <Textarea id="new-idea" value={idea} onChange={(event) => setIdea(event.target.value)} placeholder={t("home.ideaPlaceholder")} className="min-h-32" />
              </div>
            ) : null}
            {startFrom === "outline" ? (
              <div className="space-y-2">
                <Label htmlFor="new-outline">{t("home.outline")}</Label>
                <Textarea id="new-outline" value={outline} onChange={(event) => setOutline(event.target.value)} placeholder={t("home.outlinePlaceholder")} className="min-h-32" />
              </div>
            ) : null}
            {startFrom === "manuscript" ? (
              <div className="space-y-2">
                <Label htmlFor="new-manuscript">{t("home.manuscript")}</Label>
                <Textarea id="new-manuscript" value={manuscript} onChange={(event) => setManuscript(event.target.value)} placeholder={t("home.manuscriptPlaceholder")} className="min-h-32" />
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="new-min">{t("home.wordMin")}</Label>
                <Input id="new-min" inputMode="numeric" value={wordMin} onChange={(event) => setWordMin(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-max">{t("home.wordMax")}</Label>
                <Input id="new-max" inputMode="numeric" value={wordMax} onChange={(event) => setWordMax(event.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("home.cancel")}
            </Button>
            <Button type="button" disabled={creating || !title.trim()} onClick={() => void createProject()}>
              {creating ? t("home.creating") : t("home.start")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={pendingDelete !== null} onOpenChange={(next) => { if (!next) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("home.deleteAsk", { title: pendingDelete?.title ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>{t("home.deleteBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("home.keep")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => pendingDelete && void remove(pendingDelete)}>{t("home.delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Shell>
  );
}
