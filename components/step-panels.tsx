"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ProseField } from "@/components/prose-field";
import { ReaderDiscussDialog, ReaderTriageControls } from "@/components/reader-triage";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { countChars } from "@/lib/format";
import { READER_REVISE_NEED_ADOPTION, STEPS, qualityReviseBlock, reviewTriageOf, reviewsForStep, textForStep, versionsOf, wordTargetLabel } from "@/lib/pipeline";
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
  const step = STEPS.find((item) => item.id === viewStep)!;
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
      <p className="text-sm leading-6 text-muted-foreground">{step.hint}</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel kicker="输入" title={viewStep === 1 ? "想法" : viewStep === 2 ? "大纲" : "待润色的稿件"}>
          {viewStep === 1 ? (
            <ProseField id="idea" label="这一节想写什么" hint="人物必须是成年人。" value={project.idea} readOnly={busy} placeholder="两个成年人。他们是谁，想要什么，这一节发生什么。" onChange={(idea) => onChange({ idea })} />
          ) : null}
          {viewStep === 2 ? (
            <ProseField id="outline-source" label="按这份大纲写" value={project.outline} readOnly={busy} onChange={(outline) => onChange({ outline })} />
          ) : null}
          {viewStep === 3 ? (
            <ProseField id="draft-source" label="初稿或导入的稿件" hint="润色默认对着这一份改。从完整稿件进来时，它已经抄进右边的润色稿。" value={project.draft} readOnly={busy} onChange={(draft) => onChange({ draft })} />
          ) : null}
          <div className="mt-3">
            <Button type="button" disabled={busy || (viewStep === 1 ? !project.idea.trim() : viewStep === 2 ? !project.outline.trim() : !project.draft.trim() && !project.polished.trim())} onClick={onGenerate}>
              {generating === "generate" ? <Loader2 className="animate-spin" /> : null}
              {generating === "generate" ? "正在写…" : viewStep === 1 ? "生成大纲" : viewStep === 2 ? "生成初稿" : "生成润色"}
            </Button>
          </div>
        </Panel>
        <Panel kicker="结果" title={step.result}>
          {showWords ? (
            <p className="mb-2 text-sm text-muted-foreground">
              实际 {count} 字 · 目标 {wordTargetLabel(project)}
              {project.wordMin && count < project.wordMin ? " · 还短于下限" : ""}
              {project.wordMax && count > project.wordMax ? " · 超过上限" : ""}
            </p>
          ) : (
            <p className="mb-2 text-sm text-muted-foreground">{count} 字</p>
          )}
          <ProseField
            id={`result-${viewStep}`}
            label={`可编辑的${step.result}`}
            value={text}
            readOnly={busy}
            placeholder="生成后会出现在这里。也可以自己写。"
            onChange={(value) => onChange(viewStep === 1 ? { outline: value } : viewStep === 2 ? { draft: value } : { polished: value })}
          />
        </Panel>
      </div>

      <section className="sheet space-y-4 rounded-lg border border-primary/30 bg-paper px-4 py-4">
        <div>
          <h2 className="text-base font-medium">确认这一步</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">先改到你认可，再确认。读者可以一个都不请。确认之前不能进入后面的主步骤。</p>
        </div>
        <div className="space-y-2">
          <label htmlFor="feedback" className="text-sm font-medium">你的修改意见</label>
          <Textarea id="feedback" value={feedback} readOnly={busy} onChange={(event) => onFeedback(event.target.value)} placeholder="直接写要改什么。例如：第四拍写具体一点，别再缩短。" className="min-h-28 bg-paper" />
          <Button type="button" disabled={busy || !feedback.trim() || !text.trim()} onClick={() => onRevise("user")}>
            {generating === "user" ? "正在按意见改…" : "按这条意见改一版"}
          </Button>
        </div>
        <div className="space-y-3 border-t border-border pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">读者（可选）</h3>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || !text.trim() || visibleReaders.length === 0}
              aria-invalid={readerFailure?.readerId === null || undefined}
              aria-describedby={readerFailure ? "reader-action-error" : undefined}
              onClick={onReviewAll}
            >
              {reviewAllButtonLabel(generating, readerFailure?.readerId === null)}
            </Button>
          </div>
          {readerFailure ? (
            <p id="reader-action-error" role="alert" className="text-sm leading-6 text-destructive">
              {readerFailure.message}
            </p>
          ) : null}
          {visibleReaders.length === 0 ? <p className="text-sm text-muted-foreground">没有可请的读者。到「读者」页取消屏蔽，或加一位。</p> : null}
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
                      {reviewOneButtonLabel(generating === reader.id, Boolean(note?.text.trim()), failed)}
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
                  {body.error ? <p className="mt-2 text-xs leading-5 text-destructive">{body.error}</p> : null}
                  {!body.opinion && !body.error ? (
                    <ReaderOpinion key={`${reader.id}-empty`} text={waiting ? "正在看…" : "还没有意见。"} expandable={false} />
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
              title={reviseHint ?? undefined}
              aria-describedby={reviseHint ? "readers-revise-hint" : undefined}
              onClick={() => onRevise("readers")}
            >
              {generating === "readers-revise" ? "正在按读者意见改…" : "按已有读者意见改一版"}
            </Button>
            {reviseHint ? (
              <p id="readers-revise-hint" className="text-sm text-muted-foreground">
                {reviseHint}
              </p>
            ) : null}
          </div>
        </div>
        {viewStep > 1 ? (
          <div className="space-y-2 border-t border-border pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">结构质检</h3>
              <Button type="button" variant="outline" size="sm" disabled={busy || !text.trim()} onClick={onQuality}>
                {generating === "quality" ? "正在对照大纲…" : "跑一次结构质检"}
              </Button>
            </div>
            {quality && qualityMessage ? (
              <p className="text-sm leading-6">{qualityMessage}</p>
            ) : null}
            {quality && qualityMessage ? <p className="text-xs text-muted-foreground">上次对照更早正文写下的清单：</p> : null}
            <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{quality?.text || "还没有清单。质检只查贴大纲、字数和细节缺口，不是另一位读者。"}</p>
            <Button
              type="button"
              variant="outline"
              disabled={busy || !qualityReady}
              title={quality && qualityMessage ? qualityMessage : undefined}
              onClick={() => onRevise("quality")}
            >
              {generating === "quality-revise" ? "正在按质检改…" : "按质检意见再改"}
            </Button>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <p className="text-sm text-muted-foreground">{project.confirmed[viewStep] ? "这一步已经确认过。还可以继续改，再确认一次。" : "确认之后才能进入下一步。"}</p>
          <Button type="button" size="lg" disabled={busy || !text.trim()} onClick={onConfirm}>
            确认本步定稿
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
        <h2 className="text-sm font-medium">版本</h2>
        {versions.length === 0 ? <p className="text-sm text-muted-foreground">还没有入库的版本。生成或确认后会留下。</p> : null}
        <ul className="flex flex-wrap gap-2">
          {[...versions].reverse().map((version) => (
            <li key={version.id}>
              <Button type="button" size="sm" variant={project.currentVersion[kind] === version.id ? "secondary" : "outline"} disabled={busy} onClick={() => onRollback(version.id)}>
                {version.label}
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function ReaderOpinion({ text, expandable }: { text: string; expandable: boolean }) {
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
          {expanded ? "收起" : "展开"}
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
