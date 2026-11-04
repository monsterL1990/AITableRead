"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/components/locale-provider";
import { ProseField } from "@/components/prose-field";
import type { MessageId } from "@/lib/i18n/catalog";
import { ReaderDiscussDialog, ReaderTriageControls } from "@/components/reader-triage";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { countChars } from "@/lib/format";
import { READER_REVISE_NEED_ADOPTION, qualityReviseBlock, reviewTriageOf, reviewsForStep, textForStep, versionsOf, wordTargetLabel } from "@/lib/pipeline";
import {
  readerCardBody,
  readerCardFailed,
  reviewAllButtonLabel,
  reviewOneButtonLabel,
  type ReaderActionFailure,
} from "@/lib/reader-action";
import type { Project, ReaderProfile, ReviewTriage, StepId } from "@/lib/types";

export function StepPanels({
  project,
  viewStep,
  readers,
  feedback,
  busy,
  generating,
  onFeedback,
  onChange,
  onGenerate,
  onRevise,
  onReview,
  onReviewAll,
  onTriage,
  onSaveOpinion,
  onAmendOpinion,
  readerFailure,
  onQuality,
  onRollback,
  onConfirm,
}: {
  project: Project;
  viewStep: StepId;
  readers: ReaderProfile[];
  feedback: string;
  busy: boolean;
  generating: string;
  onFeedback: (value: string) => void;
  onChange: (patch: Partial<Pick<Project, "idea" | "outline" | "draft" | "polished">>) => void;
  onGenerate: () => void;
  onRevise: (source: "user" | "readers" | "quality") => void;
  onReview: (readerId: string) => void;
  onReviewAll: () => void;
  onTriage: (reviewId: string, triage: ReviewTriage) => Promise<boolean>;
  onSaveOpinion: (reviewId: string, text: string, discussion: string) => Promise<boolean>;
  onAmendOpinion: (input: { reviewId: string; readerId: string; text: string; discussion: string }) => void;
  readerFailure: ReaderActionFailure | null;
  onQuality: () => void;
  onRollback: (versionId: string) => void;
  onConfirm: () => void;
}) {
  const { t, show } = useI18n();
  const stepResult = t(`step.${viewStep}.result` as MessageId);
  const stepHint = t(`step.${viewStep}.hint` as MessageId);
  const kind = viewStep === 1 ? "outline" : viewStep === 2 ? "draft" : "polish";
  const text = textForStep(project, viewStep);
  const versions = versionsOf(project, kind);
  const notes = reviewsForStep(project, viewStep);
  const visibleReaders = readers.filter((reader) => !reader.blocked);
  const visibleReviews = visibleReaders.flatMap((reader) => {
    const note = notes.find((item) => item.readerId === reader.id);
    return note?.text.trim() ? [note] : [];
  });
  const adoptedCount = visibleReviews.filter((note) => reviewTriageOf(note.triage) === "adopted").length;
  const reviseHint = visibleReviews.length > 0 && adoptedCount === 0 ? READER_REVISE_NEED_ADOPTION : null;
  const [discussId, setDiscussId] = useState<string | null>(null);
  const discussing = notes.find((note) => note.id === discussId) ?? null;
  const count = countChars(text);
  const showWords = viewStep > 1;
  const quality = project.qualityReport?.step === viewStep && project.qualityReport.text.trim() ? project.qualityReport : null;
  const qualityMessage = viewStep > 1 ? qualityReviseBlock(project, viewStep) : "还没有质检清单。";
  const qualityReady = qualityMessage === null;

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-muted-foreground">{stepHint}</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel kicker={t("panel.input")} title={viewStep === 1 ? t("panel.inputIdea") : viewStep === 2 ? t("panel.inputOutline") : t("panel.inputDraft")}>
          {viewStep === 1 ? (
            <ProseField id="idea" label={t("panel.ideaLabel")} hint={t("panel.ideaHint")} value={project.idea} readOnly={busy} placeholder={t("panel.ideaPlaceholder")} onChange={(idea) => onChange({ idea })} />
          ) : null}
          {viewStep === 2 ? (
            <ProseField id="outline-source" label={t("panel.outlineSource")} value={project.outline} readOnly={busy} onChange={(outline) => onChange({ outline })} />
          ) : null}
          {viewStep === 3 ? (
            <ProseField id="draft-source" label={t("panel.draftSource")} hint={t("panel.draftHint")} value={project.draft} readOnly={busy} onChange={(draft) => onChange({ draft })} />
          ) : null}
          <div className="mt-3">
            <Button type="button" disabled={busy || (viewStep === 1 ? !project.idea.trim() : viewStep === 2 ? !project.outline.trim() : !project.draft.trim() && !project.polished.trim())} onClick={onGenerate}>
              {generating === "generate" ? <Loader2 className="animate-spin" /> : null}
              {generating === "generate" ? t("panel.writing") : viewStep === 1 ? t("panel.generateOutline") : viewStep === 2 ? t("panel.generateDraft") : t("panel.generatePolish")}
            </Button>
          </div>
        </Panel>
        <Panel kicker={t("panel.result")} title={stepResult}>
          {showWords ? (
            <p className="mb-2 text-sm text-muted-foreground">
              {t("panel.lengthLine", { count, target: show(wordTargetLabel(project)) })}
              {project.wordMin && count < project.wordMin ? t("panel.short") : ""}
              {project.wordMax && count > project.wordMax ? t("panel.long") : ""}
            </p>
          ) : (
            <p className="mb-2 text-sm text-muted-foreground">{t("field.chars", { count })}</p>
          )}
          <ProseField
            id={`result-${viewStep}`}
            label={t("panel.editable", { name: stepResult })}
            value={text}
            readOnly={busy}
            placeholder={t("panel.resultPlaceholder")}
            onChange={(value) => onChange(viewStep === 1 ? { outline: value } : viewStep === 2 ? { draft: value } : { polished: value })}
          />
        </Panel>
      </div>

      <section className="sheet space-y-4 rounded-lg border border-primary/30 bg-paper px-4 py-4">
        <div>
          <h2 className="text-base font-medium">{t("panel.confirmTitle")}</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{t("panel.confirmHint")}</p>
        </div>
        <div className="space-y-2">
          <label htmlFor="feedback" className="text-sm font-medium">{t("panel.yourNotes")}</label>
          <Textarea id="feedback" value={feedback} readOnly={busy} onChange={(event) => onFeedback(event.target.value)} placeholder={t("panel.yourNotesPlaceholder")} className="min-h-28 bg-paper" />
          <Button type="button" disabled={busy || !feedback.trim() || !text.trim()} onClick={() => onRevise("user")}>
            {generating === "user" ? t("panel.revisingYours") : t("panel.reviseYours")}
          </Button>
        </div>
        <div className="space-y-3 border-t border-border pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">{t("panel.readers")}</h3>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || !text.trim() || visibleReaders.length === 0}
              aria-invalid={readerFailure?.readerId === null || undefined}
              aria-describedby={readerFailure ? "reader-action-error" : undefined}
              onClick={onReviewAll}
            >
              {show(reviewAllButtonLabel(generating, readerFailure?.readerId === null))}
            </Button>
          </div>
          {readerFailure ? (
            <p id="reader-action-error" role="alert" className="text-sm leading-6 text-destructive">
              {show(readerFailure.message)}
            </p>
          ) : null}
          {visibleReaders.length === 0 ? <p className="text-sm text-muted-foreground">{t("panel.noReaders")}</p> : null}
          <ul className="grid gap-3 md:grid-cols-3">
            {visibleReaders.map((reader) => {
              const note = notes.find((item) => item.readerId === reader.id);
              const failed = readerCardFailed(readerFailure, reader.id);
              const body = readerCardBody(note?.text, failed ? readerFailure?.message ?? null : null);
              const waiting = !body.opinion && (generating === reader.id || generating === "readers");
              return (
                <li key={reader.id} className="rounded-lg border border-border px-3 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{reader.name}</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{reader.blurb}</p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy || !text.trim()}
                      aria-invalid={failed || undefined}
                      aria-describedby={failed ? "reader-action-error" : undefined}
                      onClick={() => onReview(reader.id)}
                    >
                      {show(reviewOneButtonLabel(generating === reader.id, Boolean(note?.text.trim()), failed))}
                    </Button>
                  </div>
                  {body.opinion ? <ReaderOpinion key={note?.id ?? reader.id} text={body.opinion} expandable /> : null}
                  {body.opinion && note ? (
                    <ReaderTriageControls
                      note={note}
                      disabled={busy}
                      onTriage={(reviewId, triage) => void onTriage(reviewId, triage)}
                      onDiscuss={() => setDiscussId(note.id)}
                    />
                  ) : null}
                  {body.error ? <p className="mt-2 text-xs leading-5 text-destructive">{show(body.error)}</p> : null}
                  {!body.opinion && !body.error ? (
                    <ReaderOpinion key={`${reader.id}-empty`} text={waiting ? t("panel.readerWatching") : t("panel.readerEmpty")} expandable={false} />
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div className="space-y-2">
            <Button
              type="button"
              variant="outline"
              data-action="revise-from-readers"
              disabled={busy || adoptedCount === 0}
              title={reviseHint ? show(reviseHint) : undefined}
              aria-describedby={reviseHint ? "readers-revise-hint" : undefined}
              onClick={() => onRevise("readers")}
            >
              {generating === "readers-revise" ? t("panel.revisingReaders") : t("panel.reviseReaders")}
            </Button>
            {reviseHint ? (
              <p id="readers-revise-hint" className="text-sm text-muted-foreground">
                {show(reviseHint)}
              </p>
            ) : null}
          </div>
        </div>
        {viewStep > 1 ? (
          <div className="space-y-2 border-t border-border pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">{t("panel.quality")}</h3>
              <Button type="button" variant="outline" size="sm" disabled={busy || !text.trim()} onClick={onQuality}>
                {generating === "quality" ? t("panel.qualityRunning") : t("panel.qualityRun")}
              </Button>
            </div>
            {quality && qualityMessage ? (
              <p className="text-sm leading-6">{show(qualityMessage)}</p>
            ) : null}
            {quality && qualityMessage ? <p className="text-xs text-muted-foreground">{t("panel.qualityStale")}</p> : null}
            <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{quality?.text || t("panel.qualityEmpty")}</p>
            <Button
              type="button"
              variant="outline"
              disabled={busy || !qualityReady}
              title={quality && qualityMessage ? show(qualityMessage) : undefined}
              onClick={() => onRevise("quality")}
            >
              {generating === "quality-revise" ? t("panel.revisingQuality") : t("panel.reviseQuality")}
            </Button>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <p className="text-sm text-muted-foreground">{project.confirmed[viewStep] ? t("panel.alreadyConfirmed") : t("panel.confirmToAdvance")}</p>
          <Button type="button" size="lg" disabled={busy || !text.trim()} onClick={onConfirm}>
            {t("panel.confirmFinal")}
          </Button>
        </div>
      </section>

      <ReaderDiscussDialog
        note={discussing}
        open={Boolean(discussing)}
        busy={busy}
        amending={Boolean(discussing) && generating === `discuss:${discussing?.id}`}
        onOpenChange={(next) => {
          if (!next) setDiscussId(null);
        }}
        onSave={onSaveOpinion}
        onAmend={onAmendOpinion}
        onTriage={onTriage}
      />

      <section className="space-y-2">
        <h2 className="text-sm font-medium">{t("panel.versions")}</h2>
        {versions.length === 0 ? <p className="text-sm text-muted-foreground">{t("panel.versionsEmpty")}</p> : null}
        <ul className="flex flex-wrap gap-2">
          {[...versions].reverse().map((version) => (
            <li key={version.id}>
              <Button type="button" size="sm" variant={project.currentVersion[kind] === version.id ? "secondary" : "outline"} disabled={busy} onClick={() => onRollback(version.id)}>
                {show(version.label)}
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function ReaderOpinion({ text, expandable }: { text: string; expandable: boolean }) {
  const { t } = useI18n();
  const body = useRef<HTMLParagraphElement>(null);
  const [openText, setOpenText] = useState<string | null>(null);
  const [clamped, setClamped] = useState(false);
  const expanded = expandable && openText === text;
  const likelyClamped = expandable && (text.length > 120 || text.split("\n").length > 4);

  useEffect(() => {
    const node = body.current;
    if (!node || expanded) return;
    const overflows = node.scrollHeight > node.clientHeight + 1;
    if (overflows !== clamped) setClamped(overflows);
  }, [text, expanded, clamped]);

  const showToggle = expandable && (expanded || clamped || likelyClamped);

  return (
    <div className="mt-2">
      <p
        ref={body}
        className={
          expanded
            ? "whitespace-pre-wrap text-sm leading-6 text-foreground"
            : "line-clamp-4 text-xs leading-5 text-muted-foreground"
        }
      >
        {text}
      </p>
      {showToggle ? (
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="mt-2"
          aria-expanded={expanded}
          onClick={() => setOpenText(expanded ? null : text)}
        >
          {expanded ? t("panel.collapse") : t("panel.expand")}
        </Button>
      ) : null}
    </div>
  );
}

function Panel({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) {
  return (
    <section className="sheet min-w-0 rounded-lg border border-border px-4 py-4">
      <p className="text-xs tracking-wide text-muted-foreground">{kicker}</p>
      <h2 className="mt-1 text-base font-medium">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}
