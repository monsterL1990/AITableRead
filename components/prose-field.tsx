"use client";

import { useState } from "react";
import { ManuscriptView } from "@/components/manuscript-view";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { countChars } from "@/lib/format";

export function ProseField({
  id,
  label,
  hint,
  value,
  onChange,
  readOnly,
  placeholder,
  tall = true,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  tall?: boolean;
}) {
  const [preview, setPreview] = useState(false);
  const height = tall ? "h-[42vh] min-h-72" : "h-48 min-h-40";
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Label htmlFor={id}>{label}</Label>
          {hint ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{hint}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-3 pt-0.5 text-xs text-muted-foreground">
          <span>{countChars(value)} 字</span>
          <button type="button" className="underline-offset-2 hover:underline" onClick={() => setPreview((current) => !current)}>
            {preview ? "编辑" : "预览"}
          </button>
        </div>
      </div>
      {preview ? (
        <div className={`sheet overflow-auto rounded-lg border border-border px-4 py-3 ${height}`}>
          <ManuscriptView text={value} />
        </div>
      ) : (
        <Textarea
          id={id}
          value={value}
          readOnly={readOnly}
          spellCheck={false}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className={`prose-sheet bg-paper ${height}`}
        />
      )}
    </div>
  );
}
