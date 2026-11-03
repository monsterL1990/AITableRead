"use client";

import { STEPS } from "@/lib/pipeline";
import type { Project, StepId } from "@/lib/types";

export function StepTimeline({
  project,
  viewStep,
  onView,
}: {
  project: Project;
  viewStep: StepId;
  onView: (step: StepId) => void;
}) {
  return (
    <ol className="flex gap-2 overflow-x-auto pb-1">
      {STEPS.map((step) => {
        const locked = step.id > project.currentStep;
        const viewing = step.id === viewStep;
        const done = project.confirmed[step.id];
        return (
          <li key={step.id} className="min-w-[9.5rem] flex-1">
            <button
              type="button"
              disabled={locked}
              aria-current={viewing ? "step" : undefined}
              onClick={() => onView(step.id)}
              className={`flex h-full w-full flex-col items-start gap-1 rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                viewing ? "border-primary bg-primary text-primary-foreground" : "border-border bg-paper hover:bg-accent"
              }`}
            >
              <span className="flex items-center gap-2 text-xs tracking-wide">
                <span className={`inline-flex size-5 items-center justify-center border text-[11px] ${viewing ? "border-primary-foreground/40" : "border-current"}`}>
                  {step.id}
                </span>
                {done ? "已确认" : step.id === project.currentStep ? "当前" : "未到"}
              </span>
              <span className="text-sm font-medium">{step.title}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
