"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/components/locale-provider";
import { ModeBanner } from "@/components/mode-banner";
import type { MessageId } from "@/lib/i18n/catalog";
import { Shell } from "@/components/shell";
import { StepPanels } from "@/components/step-panels";
import { StepTimeline } from "@/components/step-timeline";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { byokPurgeActive } from "@/lib/account-policy";
import { archivePath, formatWhen, safeFilename } from "@/lib/format";
import { snapshotForTask } from "@/lib/generation";
import { projectToMarkdown } from "@/lib/markdown";
import {
  READER_REVISE_NEED_ADOPTION,
  READER_REVISE_NONE,
  qualityReviseBlock,
  readerReviseSelection,
  textForStep,
} from "@/lib/pipeline";
import {
  keepReviews,
  reviewBlockedBySaveMessage,
  reviewRequestFailedMessage,
  type ReaderActionFailure,
} from "@/lib/reader-action";
import { BUSY_JOB_MESSAGE, pendingJobFailure, pendingJobProgress } from "@/lib/pending-job";
import { readSse } from "@/lib/sse";
import type { FeedbackSource, GenerateTask, Project, PublicConfig, ReaderProfile, ReviewNote, ReviewTriage, StepId } from "@/lib/types";

const TEXT_KEYS = ["title", "idea", "outline", "draft", "polished", "wordMin", "wordMax"] as const;

function isCancelledMessage(message: string) {
  return message.startsWith("已取消") || message.startsWith("Cancelled.");
}

function isBusyMessage(message: string) {
  return message === BUSY_JOB_MESSAGE || message.includes("已有任务在跑") || message.includes("already running");
}

export function PipelineWorkspace({ id }: { id: string }) {
  const { t, show, locale } = useI18n();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [readers, setReaders] = useState<ReaderProfile[]>([]);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [viewStep, setViewStep] = useState<StepId>(1);
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [readerFailure, setReaderFailure] = useState<ReaderActionFailure | null>(null);
  const [generating, setGenerating] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [cancelling, setCancelling] = useState(false);
  const [overwriteOpen, setOverwriteOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const projectRef = useRef<Project | null>(null);
  const readersRef = useRef<ReaderProfile[]>([]);
  const viewStepRef = useRef<StepId>(1);
  const feedbackRef = useRef("");
  const busyRef = useRef(false);
  const sseLive = useRef(false);
  const sseSettled = useRef(false);
  const localCancel = useRef(false);
  const watchedStart = useRef("");
  const lastPersistError = useRef("");
  const tail = useRef<Promise<void>>(Promise.resolve());
  const saveTimer = useRef<number | null>(null);
  const controllers = useRef(new Set<AbortController>());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [projectRes, configRes, readerRes] = await Promise.all([
          fetch(`/api/projects/${id}`),
          fetch("/api/config"),
          fetch("/api/readers"),
        ]);
        if (projectRes.status === 401) {
          router.replace("/login");
          return;
        }
        if (projectRes.status === 404) {
          if (!cancelled) setMissing(true);
          return;
        }
        if (!projectRes.ok) throw new Error("work.openFailed");
        const body = (await projectRes.json()) as { project: Project };
        if (cancelled) return;
        projectRef.current = body.project;
        setProject(body.project);
        const job = body.project.pendingJob;
        if (job) {
          busyRef.current = true;
          watchedStart.current = job.startedAt;
          setGenerating(job.label);
          setViewStep(job.step);
          viewStepRef.current = job.step;
        } else {
          setViewStep(body.project.currentStep);
          viewStepRef.current = body.project.currentStep;
        }
        if (configRes.ok) setConfig((await configRes.json()) as PublicConfig);
        if (readerRes.ok) {
          const readerBody = (await readerRes.json()) as { readers: ReaderProfile[] };
          readersRef.current = readerBody.readers;
          setReaders(readerBody.readers);
        }
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? show(error.message) : t("work.openFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    const active = controllers.current;
    return () => {
      cancelled = true;
      // 只停这次页面上的读取。服务端任务继续，不在这里取消。
      active.forEach((controller) => controller.abort());
    };
    // Language helpers are closed over for this load only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, router]);

  const pendingRequestId = project?.pendingJob?.requestId ?? "";

  useEffect(() => {
    if (!pendingRequestId) return;
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [pendingRequestId]);

  useEffect(() => {
    if (!pendingRequestId) return;
    let stopped = false;
    let timer = 0;
    const tick = async () => {
      if (stopped) return;
      try {
        const response = await fetch(`/api/projects/${id}`);
        if (stopped || !response.ok) return;
        const data = (await response.json()) as { project?: Project };
        const next = data.project;
        if (!next || stopped) return;
        if (next.pendingJob) {
          watchedStart.current = next.pendingJob.startedAt;
          const local = projectRef.current;
          if (sseLive.current && local) {
            if (next.revision !== local.revision || local.pendingJob?.requestId !== next.pendingJob.requestId) {
              commit({
                ...next,
                idea: local.idea,
                outline: local.outline,
                draft: local.draft,
                polished: local.polished,
                reviews: local.reviews,
              });
            }
          } else if (!local || next.revision !== local.revision || local.pendingJob?.requestId !== next.pendingJob.requestId) {
            commit(next);
          }
          setNow(Date.now());
          return;
        }
        if (sseLive.current) {
          const local = projectRef.current;
          if (!local || next.revision !== local.revision) commit(next);
          return;
        }
        const failure = pendingJobFailure(next.log, watchedStart.current);
        commit(next);
        busyRef.current = false;
        setGenerating("");
        if (!sseSettled.current) {
          if (failure) toast.error(show(failure));
          else toast.success(t("work.finished"));
        }
        sseSettled.current = true;
      } catch {
        // 下一轮再问。
      } finally {
        if (!stopped) timer = window.setTimeout(() => void tick(), 2000);
      }
    };
    timer = window.setTimeout(() => void tick(), 800);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
    // Language helpers are closed over for this watch only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRequestId, id]);

  function commit(next: Project) {
    projectRef.current = next;
    setProject(next);
  }

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.current.then(task, task);
    tail.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function scheduleSave() {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      void enqueue(async () => {
        const current = projectRef.current;
        if (!current || busyRef.current) return;
        await persist(current);
      });
    }, 450);
  }

  function onChange(patch: Partial<Pick<Project, "title" | "idea" | "outline" | "draft" | "polished" | "wordMin" | "wordMax">>) {
    const prev = projectRef.current;
    if (!prev || busyRef.current) return;
    commit({ ...prev, ...patch });
    scheduleSave();
  }

  function absorbServer(server: Project, sent?: Project) {
    const local = projectRef.current;
    if (!local || !sent) {
      commit(server);
      return;
    }
    const next: Project = { ...server };
    let drifted = false;
    for (const key of TEXT_KEYS) {
      if (local[key] !== sent[key]) {
        next[key] = local[key] as never;
        drifted = true;
      }
    }
    commit(next);
    if (drifted) scheduleSave();
  }

  function restoreReviews(previous: ReviewNote[]) {
    const current = projectRef.current;
    if (!current) return;
    const merged = keepReviews(previous, current.reviews);
    if (merged !== current.reviews) commit({ ...current, reviews: merged });
  }

  async function persist(snapshot: Project, options?: { quiet?: boolean }): Promise<boolean> {
    setSaveState("saving");
    lastPersistError.current = "";
    try {
      const response = await fetch(`/api/projects/${snapshot.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload(snapshot)),
      });
      if (response.status === 401) {
        router.replace("/login");
        return false;
      }
      const data = (await response.json().catch(() => ({}))) as { error?: string; project?: Project };
      if (!response.ok || !data.project) {
        const message = data.error ? show(data.error) : t("work.saveError");
        lastPersistError.current = message;
        setSaveState("error");
        if (!options?.quiet) toast.error(message);
        return false;
      }
      absorbServer(data.project, snapshot);
      setSaveState("saved");
      return true;
    } catch {
      const message = t("work.saveError");
      lastPersistError.current = message;
      setSaveState("error");
      if (!options?.quiet) toast.error(message);
      return false;
    }
  }

  async function refetch() {
    const current = projectRef.current;
    if (!current) return;
    const response = await fetch(`/api/projects/${current.id}`);
    if (!response.ok) return;
    const data = (await response.json()) as { project: Project };
    commit(data.project);
  }

  async function refetchKeeping(reviews: ReviewNote[]) {
    const current = projectRef.current;
    if (!current) return;
    try {
      const response = await fetch(`/api/projects/${current.id}`);
      if (!response.ok) {
        restoreReviews(reviews);
        return;
      }
      const data = (await response.json()) as { project?: Project };
      if (!data.project) {
        restoreReviews(reviews);
        return;
      }
      const merged = keepReviews(reviews, data.project.reviews ?? []);
      commit(merged === data.project.reviews ? data.project : { ...data.project, reviews: merged });
    } catch {
      restoreReviews(reviews);
    }
  }

  function applyStreamText(task: GenerateTask, step: StepId, text: string) {
    const prev = projectRef.current;
    if (!prev) return;
    const next: Project = { ...prev };
    const writing =
      task === "outline" || task === "draft" || task === "polish" || task === "revise-from-feedback";
    if (!writing) return;
    if (step === 1) next.outline = text;
    else if (step === 2) next.draft = text;
    else next.polished = text;
    commit(next);
  }

  function keepLocalText(server: Project): Project {
    const local = projectRef.current;
    if (!local) return server;
    return {
      ...server,
      idea: local.idea,
      outline: local.outline,
      draft: local.draft,
      polished: local.polished,
      reviews: local.reviews,
    };
  }

  async function streamJob(
    source: Project,
    task: GenerateTask,
    step: StepId,
    extra: { readerId?: string; feedback?: string; feedbackSource?: FeedbackSource; reviewId?: string },
    hooks?: { onReviewFailure?: (error: unknown) => void },
  ): Promise<boolean> {
    const reviewsBefore = hooks?.onReviewFailure ? [...(projectRef.current?.reviews ?? [])] : null;
    const controller = new AbortController();
    controllers.current.add(controller);
    const noteFailure = (message: string, error: unknown) => {
      if (localCancel.current && isCancelledMessage(message)) return;
      if (hooks?.onReviewFailure && reviewsBefore) hooks.onReviewFailure(error);
      else toast.error(message);
    };
    try {
      const response = await fetch(`/api/projects/${source.id}/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          task,
          step,
          readerId: extra.readerId,
          reviewId: extra.reviewId,
          feedback: extra.feedback ?? "",
          feedbackSource: extra.feedbackSource,
          snapshot: snapshotForTask(task, source),
        }),
      });
      if (response.status === 401) {
        router.replace("/login");
        return false;
      }
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ? show(data.error) : t("work.generateFailed"));
      }
      let acc = "";
      let finished = false;
      await readSse(response, (event) => {
        if (event.type === "pending" && event.project) {
          const job = event.project.pendingJob;
          if (job) watchedStart.current = job.startedAt;
          commit(sseLive.current ? keepLocalText(event.project) : event.project);
          return;
        }
        if (event.type === "delta" && event.text) {
          acc += event.text;
          applyStreamText(task, step, acc);
        }
        if (event.type === "error") {
          sseSettled.current = true;
          throw new Error(event.message ? show(event.message) : t("work.generateFailed"));
        }
        if (event.type === "done" && event.project) {
          finished = true;
          sseSettled.current = true;
          commit(event.project);
        }
      });
      if (!finished) {
        await refetch();
        if (projectRef.current?.pendingJob) {
          sseLive.current = false;
          watchedStart.current = projectRef.current.pendingJob.startedAt;
          toast.message(t("job.disconnect"));
          return false;
        }
        const failure = pendingJobFailure(projectRef.current?.log ?? [], watchedStart.current);
        if (failure) {
          noteFailure(failure, new Error(failure));
          return false;
        }
        sseSettled.current = true;
        return true;
      }
      return true;
    } catch (error) {
      if (controller.signal.aborted) {
        sseLive.current = false;
        return false;
      }
      const message = error instanceof Error ? error.message : t("work.generateFailed");
      if (localCancel.current && isCancelledMessage(message)) return false;
      if (isBusyMessage(message)) {
        toast.error(t("job.busy"));
        await refetch();
        return false;
      }
      await refetch();
      if (projectRef.current?.pendingJob) {
        sseLive.current = false;
        watchedStart.current = projectRef.current.pendingJob.startedAt;
        toast.message(t("job.disconnect"));
        return false;
      }
      if (hooks?.onReviewFailure && reviewsBefore) {
        hooks.onReviewFailure(error);
        await refetchKeeping(reviewsBefore);
        return false;
      }
      toast.error(message);
      return false;
    } finally {
      controllers.current.delete(controller);
    }
  }

  function alreadyRunning(): boolean {
    return busyRef.current || Boolean(projectRef.current?.pendingJob);
  }

  async function runJobs(
    label: string,
    jobs: (source: Project) => Promise<boolean>,
    options?: { onSaveFailed?: (serverMessage: string) => void },
  ) {
    if (alreadyRunning()) {
      toast.error(t("job.busy"));
      return;
    }
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    setOverwriteOpen(false);
    busyRef.current = true;
    sseLive.current = true;
    sseSettled.current = false;
    localCancel.current = false;
    watchedStart.current = new Date().toISOString();
    setGenerating(label);
    try {
      await enqueue(async () => {
        const current = projectRef.current;
        if (!current) return;
        const saved = await persist(current, { quiet: Boolean(options?.onSaveFailed) });
        if (!saved || !projectRef.current) {
          if (!saved && options?.onSaveFailed && lastPersistError.current) options.onSaveFailed(lastPersistError.current);
          return;
        }
        await jobs(projectRef.current);
      });
    } finally {
      sseLive.current = false;
      const pending = projectRef.current?.pendingJob;
      if (pending) {
        busyRef.current = true;
        watchedStart.current = pending.startedAt;
        setGenerating(pending.label);
      } else {
        busyRef.current = false;
        setGenerating("");
      }
    }
  }

  function requestGenerate() {
    const current = projectRef.current;
    if (!current) return;
    if (alreadyRunning()) {
      toast.error(t("job.busy"));
      return;
    }
    if (textForStep(current, viewStepRef.current).trim()) {
      setOverwriteOpen(true);
      return;
    }
    void startGenerate();
  }

  function startGenerate() {
    const step = viewStepRef.current;
    const task: GenerateTask = step === 1 ? "outline" : step === 2 ? "draft" : "polish";
    void runJobs("generate", (source) => streamJob(source, task, step, {}));
  }

  function revise(source: FeedbackSource) {
    const step = viewStepRef.current;
    const current = projectRef.current;
    if (source === "quality") {
      const block = current ? qualityReviseBlock(current, step) : "还没有质检清单。";
      if (block) {
        toast.error(show(block));
        return;
      }
    }
    if (source === "readers") {
      const selection = current ? readerReviseSelection(current, step, readersRef.current) : null;
      if (!selection?.text) {
        toast.error(show(selection && (selection.unset.length > 0 || selection.ignored.length > 0) ? READER_REVISE_NEED_ADOPTION : READER_REVISE_NONE));
        return;
      }
    }
    const note = source === "user" ? feedbackRef.current : "";
    const label = source === "user" ? "user" : source === "readers" ? "readers-revise" : "quality-revise";
    void runJobs(label, async (fresh) => {
      const ok = await streamJob(fresh, "revise-from-feedback", step, { feedback: note, feedbackSource: source });
      if (ok && source === "user") {
        feedbackRef.current = "";
        setFeedback("");
      }
      return ok;
    });
  }

  async function patchReview(body: Record<string, unknown>, snapshot: Project): Promise<boolean> {
    setSaveState("saving");
    lastPersistError.current = "";
    try {
      const response = await fetch(`/api/projects/${snapshot.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.status === 401) {
        router.replace("/login");
        return false;
      }
      const data = (await response.json().catch(() => ({}))) as { error?: string; project?: Project };
      if (!response.ok || !data.project) {
        const message = data.error ? show(data.error) : t("work.saveError");
        lastPersistError.current = message;
        setSaveState("error");
        toast.error(message);
        return false;
      }
      absorbServer(data.project, snapshot);
      setSaveState("saved");
      return true;
    } catch {
      const message = t("work.saveError");
      lastPersistError.current = message;
      setSaveState("error");
      toast.error(message);
      return false;
    }
  }

  function setTriage(reviewId: string, triage: ReviewTriage): Promise<boolean> {
    const prev = projectRef.current;
    if (!prev || busyRef.current) return Promise.resolve(false);
    const previousTriage = prev.reviews.find((note) => note.id === reviewId)?.triage ?? "unset";
    const snapshot: Project = {
      ...prev,
      reviews: prev.reviews.map((note) => (note.id === reviewId ? { ...note, triage } : note)),
    };
    commit(snapshot);
    return enqueue(async () => {
      const ok = await patchReview({ reviewTriage: { id: reviewId, triage } }, snapshot);
      if (!ok) {
        const current = projectRef.current;
        if (current) {
          commit({
            ...current,
            reviews: current.reviews.map((note) => (note.id === reviewId ? { ...note, triage: previousTriage } : note)),
          });
        }
      }
      return ok;
    });
  }

  function saveOpinion(reviewId: string, text: string, discussion: string): Promise<boolean> {
    const prev = projectRef.current;
    if (!prev || busyRef.current) return Promise.resolve(false);
    const trimmed = text.trim();
    const talk = discussion.trim();
    if (!trimmed) {
      toast.error(t("work.discussEmpty"));
      return Promise.resolve(false);
    }
    const previous = prev.reviews.find((note) => note.id === reviewId);
    const snapshot: Project = {
      ...prev,
      reviews: prev.reviews.map((note) => {
        if (note.id !== reviewId) return note;
        return {
          ...note,
          text: trimmed,
          discussion: talk,
          triage: note.text.trim() === trimmed ? note.triage : "unset",
        };
      }),
    };
    commit(snapshot);
    return enqueue(async () => {
      const ok = await patchReview({ reviewAmendment: { id: reviewId, text: trimmed, discussion: talk } }, snapshot);
      if (!ok && previous) {
        const current = projectRef.current;
        if (current) {
          commit({
            ...current,
            reviews: current.reviews.map((note) => (note.id === reviewId ? previous : note)),
          });
        }
      }
      return ok;
    });
  }

  function amendOpinion(input: { reviewId: string; readerId: string; text: string; discussion: string }) {
    const step = viewStepRef.current;
    const talk = input.discussion.trim();
    const text = input.text.trim();
    if (!talk) {
      toast.error(t("work.discussNeed"));
      return;
    }
    if (!text) {
      toast.error(t("work.discussEmpty"));
      return;
    }
    void runJobs(`discuss:${input.reviewId}`, async () => {
      const current = projectRef.current;
      if (!current) return false;
      const saved = await patchReview(
        { reviewAmendment: { id: input.reviewId, text, discussion: talk } },
        current,
      );
      if (!saved) return false;
      const fresh = projectRef.current ?? current;
      const ok = await streamJob(fresh, "amend-review", step, { readerId: input.readerId, reviewId: input.reviewId, feedback: talk });
      if (ok) toast.success(t("work.discussed"));
      return ok;
    });
  }

  function failReviewSave(readerId: string | null, readerName: string | null, previous: ReviewNote[]) {
    return (serverMessage: string) => {
      restoreReviews(previous);
      const message = reviewBlockedBySaveMessage(readerName, serverMessage);
      toast.error(message);
      setReaderFailure({ message, readerId });
    };
  }

  function reviewOne(readerId: string) {
    const step = viewStepRef.current;
    const name = readersRef.current.find((reader) => reader.id === readerId)?.name ?? t("work.thisReader");
    const previous = [...(projectRef.current?.reviews ?? [])];
    setReaderFailure(null);
    void runJobs(
      readerId,
      async (source) => {
        const before = [...(projectRef.current?.reviews ?? previous)];
        const ok = await streamJob(source, "review", step, { readerId }, {
          onReviewFailure: (error) => {
            const message = reviewRequestFailedMessage(name, error);
            toast.error(message);
            setReaderFailure({ message, readerId });
          },
        });
        if (!ok) restoreReviews(before);
        else setReaderFailure(null);
        return ok;
      },
      { onSaveFailed: failReviewSave(readerId, name, previous) },
    );
  }

  function reviewAll() {
    const step = viewStepRef.current;
    const open = readersRef.current.filter((reader) => !reader.blocked);
    const previous = [...(projectRef.current?.reviews ?? [])];
    setReaderFailure(null);
    void runJobs(
      "readers",
      async (source) => {
        let latest = source;
        for (const reader of open) {
          const before = [...(projectRef.current?.reviews ?? [])];
          const ok = await streamJob(latest, "review", step, { readerId: reader.id }, {
            onReviewFailure: (error) => {
              const message = reviewRequestFailedMessage(reader.name, error);
              toast.error(message);
              setReaderFailure({ message, readerId: reader.id });
            },
          });
          if (!ok) {
            restoreReviews(before);
            return false;
          }
          latest = projectRef.current ?? latest;
        }
        setReaderFailure(null);
        return true;
      },
      { onSaveFailed: failReviewSave(null, null, previous) },
    );
  }

  function quality() {
    const step = viewStepRef.current;
    void runJobs("quality", (source) => streamJob(source, "quality-check", step, {}));
  }

  async function confirmStep() {
    const step = viewStepRef.current;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    busyRef.current = true;
    setGenerating("confirm");
    try {
      await enqueue(async () => {
        const current = projectRef.current;
        if (!current) return;
        const response = await fetch(`/api/projects/${current.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...payload(current), confirmStep: step }),
        });
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        const data = (await response.json().catch(() => ({}))) as { error?: string; project?: Project };
        if (!data.project) {
          toast.error(data.error ? show(data.error) : t("work.confirmFailed"));
          return;
        }
        absorbServer(data.project, current);
        if (!response.ok) {
          toast.error(data.error ? show(data.error) : t("work.confirmBlocked"));
          return;
        }
        if (data.project.currentStep !== step && data.project.currentStep > step) {
          viewStepRef.current = data.project.currentStep;
          setViewStep(data.project.currentStep);
        }
        toast.success(t("work.confirmed"));
      });
    } finally {
      busyRef.current = false;
      setGenerating("");
    }
  }

  async function rollback(versionId: string) {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    busyRef.current = true;
    setGenerating("rollback");
    try {
      await enqueue(async () => {
        const current = projectRef.current;
        if (!current) return;
        const version = current.versions.find((item) => item.id === versionId);
        const body: Record<string, unknown> = {
          title: current.title,
          idea: current.idea,
          wordMin: current.wordMin,
          wordMax: current.wordMax,
          rollbackVersionId: versionId,
        };
        if (!version || version.kind !== "outline") body.outline = current.outline;
        if (!version || version.kind !== "draft") body.draft = current.draft;
        if (!version || version.kind !== "polish") body.polished = current.polished;
        const response = await fetch(`/api/projects/${current.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        const data = (await response.json().catch(() => ({}))) as { error?: string; project?: Project };
        if (!response.ok || !data.project) {
          toast.error(data.error ? show(data.error) : t("work.rollbackFailed"));
          if (data.project) commit(data.project);
          return;
        }
        commit(data.project);
        toast.success(t("work.rolledBack"));
      });
    } finally {
      busyRef.current = false;
      setGenerating("");
    }
  }

  function exportMarkdown(scope: "full" | "current") {
    const current = projectRef.current;
    if (!current) return;
    const text = projectToMarkdown(
      current,
      scope,
      config
        ? { textRoute: config.textRoute, dshConfigured: config.dshConfigured, byokPurge: byokPurgeActive(config) }
        : undefined,
      locale,
    );
    const suffix = scope === "full" ? t("work.exportFullSuffix") : "";
    download(`${safeFilename(current.title)}${suffix}.md`, text);
    toast.success(scope === "full" ? t("work.exportedFull") : t("work.exportedCurrent"));
  }

  function chooseStep(step: StepId) {
    viewStepRef.current = step;
    setViewStep(step);
  }

  async function cancelPending() {
    const current = projectRef.current;
    if (!current?.pendingJob || cancelling || localCancel.current) return;
    localCancel.current = true;
    sseSettled.current = true;
    setCancelling(true);
    try {
      const response = await fetch(`/api/projects/${current.id}/generate/cancel`, { method: "POST" });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      const data = (await response.json().catch(() => ({}))) as { error?: string; project?: Project };
      if (!response.ok || !data.project) {
        localCancel.current = false;
        sseSettled.current = false;
        toast.error(data.error ? show(data.error) : t("work.cancelFailed"));
        return;
      }
      sseLive.current = false;
      commit(data.project);
      busyRef.current = false;
      setGenerating("");
      toast.message(t("job.cancelled"));
    } catch {
      localCancel.current = false;
      sseSettled.current = false;
      toast.error(t("work.cancelFailed"));
    } finally {
      setCancelling(false);
    }
  }

  if (loading) {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">{t("work.loading")}</p>
      </Shell>
    );
  }
  if (missing) {
    return (
      <Shell>
        <div className="sheet rounded-lg border border-border px-6 py-10">
          <h1 className="text-xl font-medium">{t("work.missingTitle")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("work.missingBody")}</p>
          <Button className="mt-4" asChild>
            <Link href="/">{t("work.backHome")}</Link>
          </Button>
        </div>
      </Shell>
    );
  }
  if (loadError || !project) {
    return (
      <Shell>
        <div className="sheet rounded-lg border border-border px-6 py-10">
          <h1 className="text-xl font-medium">{t("work.openFailedTitle")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{loadError ? show(loadError) : t("work.tryAgain")}</p>
        </div>
      </Shell>
    );
  }

  const pendingJob = project.pendingJob;
  const activeLabel = generating || pendingJob?.label || "";
  const busy = activeLabel.length > 0;
  const path = archivePath(project.ownerId, project.id);
  const currentLabel = t(`step.${project.currentStep}.short` as MessageId);

  return (
    <Shell>
      <div className="space-y-4">
        <ModeBanner config={config} />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <Input
              aria-label={t("work.titleLabel")}
              value={project.title}
              readOnly={busy}
              onChange={(event) => onChange({ title: event.target.value })}
              className="h-11 border-transparent bg-transparent px-0 text-2xl font-medium shadow-none focus-visible:border-border"
            />
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>{show(saveLabel(saveState))}</span>
              <span>{t("work.updated", { when: show(formatWhen(project.updatedAt)) })}</span>
              {project.confirmed[3] ? <Badge>{t("home.confirmed")}</Badge> : <Badge variant="outline">{t("home.inProgress")}</Badge>}
              <span className="font-mono">{t("work.archive", { path })}</span>
              <button
                type="button"
                className="underline-offset-2 hover:underline"
                onClick={() => {
                  void navigator.clipboard.writeText(path);
                  toast.success(t("work.copiedPath"));
                }}
              >
                {t("work.copyPath")}
              </button>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setLogOpen(true)}>
              {t("work.log")}
            </Button>
            <Button type="button" variant="outline" onClick={() => exportMarkdown("current")}>
              {t("work.exportCurrent")}
            </Button>
            <Button type="button" variant="outline" onClick={() => exportMarkdown("full")}>
              {t("work.exportFull")}
            </Button>
          </div>
        </div>

        <div className="sheet flex flex-wrap items-end gap-3 rounded-lg border border-border px-4 py-3">
          <div className="space-y-1">
            <Label htmlFor="word-min">{t("work.wordMin")}</Label>
            <Input
              id="word-min"
              inputMode="numeric"
              className="w-28"
              disabled={busy}
              value={project.wordMin ?? ""}
              onChange={(event) => onChange({ wordMin: readCount(event.target.value) })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="word-max">{t("work.wordMax")}</Label>
            <Input
              id="word-max"
              inputMode="numeric"
              className="w-28"
              disabled={busy}
              value={project.wordMax ?? ""}
              onChange={(event) => onChange({ wordMax: readCount(event.target.value) })}
            />
          </div>
          <p className="pb-2 text-sm text-muted-foreground">{t("work.wordHint")}</p>
          {(project.wordMin ?? 0) >= 8000 || (project.wordMax ?? 0) >= 8000 ? (
            <p className="basis-full text-sm leading-6 text-muted-foreground">
              {t("work.wordWarn")}
            </p>
          ) : null}
        </div>

        <StepTimeline project={project} viewStep={viewStep} onView={chooseStep} />

        {viewStep !== project.currentStep ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">{t("work.reviewing", { step: currentLabel })}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => chooseStep(project.currentStep)}>
              {t("work.backToStep", { step: currentLabel })}
            </Button>
          </div>
        ) : null}

        {pendingJob ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/40 bg-paper px-4 py-3" role="status" aria-live="polite">
            <p className="text-sm">
              <Loader2 className="mr-2 inline size-4 animate-spin" aria-hidden="true" />
              {show(pendingJobProgress(pendingJob, now, readers))}
            </p>
            <Button type="button" variant="outline" size="sm" disabled={cancelling} onClick={() => void cancelPending()}>
              {cancelling ? t("work.cancelling") : t("work.cancel")}
            </Button>
          </div>
        ) : null}

        <StepPanels
          project={project}
          viewStep={viewStep}
          readers={readers}
          feedback={feedback}
          busy={busy}
          generating={activeLabel}
          onFeedback={(value) => {
            feedbackRef.current = value;
            setFeedback(value);
          }}
          onChange={onChange}
          onGenerate={requestGenerate}
          onRevise={revise}
          onReview={reviewOne}
          onReviewAll={reviewAll}
          onTriage={setTriage}
          onSaveOpinion={saveOpinion}
          onAmendOpinion={amendOpinion}
          readerFailure={readerFailure}
          onQuality={quality}
          onRollback={(versionId) => void rollback(versionId)}
          onConfirm={() => void confirmStep()}
        />
      </div>

      <AlertDialog open={overwriteOpen} onOpenChange={setOverwriteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("work.regenTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("work.regenBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("work.regenKeep")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => startGenerate()}>{t("work.regenGo")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("work.logTitle")}</DialogTitle>
            <DialogDescription>{t("work.logBody")}</DialogDescription>
          </DialogHeader>
          {project.log.length === 0 ? <p className="text-sm text-muted-foreground">{t("work.logEmpty")}</p> : null}
          <ol className="space-y-3">
            {project.log.map((entry) => (
              <li key={entry.id} className="rounded-lg border border-border px-3 py-3">
                <p className="text-xs text-muted-foreground">
                  {show(formatWhen(entry.at))}
                  {entry.step ? t("work.logStep", { step: entry.step }) : ""}
                  {entry.versionId ? ` · ${entry.versionId.slice(0, 8)}` : ""}
                </p>
                <p className="mt-1 text-sm font-medium">{show(entry.summary)}</p>
                {entry.detail ? <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{show(entry.detail)}</p> : null}
              </li>
            ))}
          </ol>
        </DialogContent>
      </Dialog>
    </Shell>
  );
}

function payload(project: Project) {
  return {
    title: project.title,
    idea: project.idea,
    outline: project.outline,
    draft: project.draft,
    polished: project.polished,
    wordMin: project.wordMin,
    wordMax: project.wordMax,
  };
}

function readCount(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed);
}

function saveLabel(state: "idle" | "saving" | "saved" | "error") {
  if (state === "saving") return "正在保存…";
  if (state === "saved") return "已保存";
  if (state === "error") return "保存失败";
  return "稿在这台机器上";
}

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
