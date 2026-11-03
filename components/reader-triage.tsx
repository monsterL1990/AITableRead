"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { reviewTriageLabel } from "@/lib/reader-action";
import { reviewTriageOf } from "@/lib/pipeline";
import type { ReviewNote, ReviewTriage } from "@/lib/types";

export function ReaderTriageControls({
  note,
  disabled,
  onTriage,
  onDiscuss,
}: {
  note: ReviewNote;
  disabled: boolean;
  onTriage: (reviewId: string, triage: ReviewTriage) => void;
  onDiscuss: () => void;
}) {
  const triage = reviewTriageOf(note.triage);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" data-reader-triage={note.readerId}>
      <Button
        type="button"
        size="xs"
        variant={triage === "adopted" ? "default" : "outline"}
        disabled={disabled}
        aria-pressed={triage === "adopted"}
        onClick={() => onTriage(note.id, triage === "adopted" ? "unset" : "adopted")}
      >
        采纳
      </Button>
      <Button
        type="button"
        size="xs"
        variant={triage === "ignored" ? "destructive" : "outline"}
        disabled={disabled}
        aria-pressed={triage === "ignored"}
        onClick={() => onTriage(note.id, triage === "ignored" ? "unset" : "ignored")}
      >
        忽略
      </Button>
      <Button type="button" size="xs" variant="outline" disabled={disabled} aria-haspopup="dialog" onClick={onDiscuss}>
        讨论
      </Button>
      <span className="text-xs text-muted-foreground">{reviewTriageLabel(triage)}</span>
    </div>
  );
}

export function ReaderDiscussDialog({
  note,
  open,
  busy,
  amending,
  onOpenChange,
  onSave,
  onAmend,
  onTriage,
}: {
  note: ReviewNote | null;
  open: boolean;
  busy: boolean;
  amending: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (reviewId: string, text: string, discussion: string) => Promise<boolean>;
  onAmend: (input: { reviewId: string; readerId: string; text: string; discussion: string }) => void;
  onTriage: (reviewId: string, triage: ReviewTriage) => Promise<boolean>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        {note ? (
          <ReaderDiscussForm
            key={`${note.id}:${note.text}:${note.discussion}`}
            note={note}
            busy={busy}
            amending={amending}
            onSave={onSave}
            onAmend={onAmend}
            onTriage={onTriage}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function ReaderDiscussForm({
  note,
  busy,
  amending,
  onSave,
  onAmend,
  onTriage,
  onClose,
}: {
  note: ReviewNote;
  busy: boolean;
  amending: boolean;
  onSave: (reviewId: string, text: string, discussion: string) => Promise<boolean>;
  onAmend: (input: { reviewId: string; readerId: string; text: string; discussion: string }) => void;
  onTriage: (reviewId: string, triage: ReviewTriage) => Promise<boolean>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(note.text);
  const [talk, setTalk] = useState(note.discussion);
  const [saving, setSaving] = useState(false);
  const locked = busy || saving || amending;

  async function save(announce: boolean): Promise<boolean> {
    setSaving(true);
    try {
      const changed = draft.trim() !== note.text.trim();
      const ok = await onSave(note.id, draft, talk);
      if (ok && announce) toast.success(changed ? "这条意见已保存，请再点采纳。" : "这条意见已保存。");
      return ok;
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>讨论这条意见</DialogTitle>
        <DialogDescription>
          {note.readerName}的这条意见。保存后写进这条意见；让 AI 改写会回到未定。只有采纳的才会进入「按已有读者意见改一版」。
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-2">
          <label htmlFor={`discuss-opinion-${note.id}`} className="text-sm font-medium">
            这条意见
          </label>
          <Textarea
            id={`discuss-opinion-${note.id}`}
            value={draft}
            readOnly={locked}
            onChange={(event) => setDraft(event.target.value)}
            className="min-h-40 bg-paper"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor={`discuss-talk-${note.id}`} className="text-sm font-medium">
            你想怎么改
          </label>
          <Textarea
            id={`discuss-talk-${note.id}`}
            value={talk}
            readOnly={locked}
            placeholder="例如：第四拍别删，把动机写成一个具体动作。"
            onChange={(event) => setTalk(event.target.value)}
            className="min-h-24 bg-paper"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={locked || !draft.trim()} onClick={() => void save(true)}>
          {saving ? "正在保存…" : "保存这条意见"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={locked || !talk.trim()}
          onClick={() => onAmend({ reviewId: note.id, readerId: note.readerId, text: draft, discussion: talk })}
        >
          {amending ? <Loader2 className="animate-spin" /> : null}
          {amending ? "正在按讨论改这条意见…" : "让 AI 根据我的讨论改这条意见"}
        </Button>
        <Button
          type="button"
          disabled={locked || !draft.trim()}
          onClick={() => {
            void (async () => {
              const saved = await save(false);
              if (!saved) return;
              const marked = await onTriage(note.id, "adopted");
              if (marked) onClose();
            })();
          }}
        >
          采纳这条意见
        </Button>
      </div>
    </>
  );
}
