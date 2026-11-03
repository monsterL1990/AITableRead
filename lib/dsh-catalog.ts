import type { DshCatalogFailure, DshCatalogOption, DshCatalogView, DshModelRef } from "./types";

const MAX_ID = 120;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function clip(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 180);
}

function id(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_ID || /[\r\n]/.test(trimmed)) return "";
  return trimmed;
}

/** 把 session/modelCatalog 的值收成设置页能用的选项。只留 routableProviders 里的提供方。 */
export function parseModelCatalog(value: unknown): Pick<DshCatalogView, "defaultModel" | "options" | "failures"> {
  const raw = asRecord(value);
  const routable = Array.isArray(raw?.routableProviders)
    ? raw.routableProviders.map(id).filter(Boolean)
    : [];
  const allowed = new Set(routable);
  const options: DshCatalogOption[] = [];
  const groups = Array.isArray(raw?.groups) ? raw.groups : [];
  for (const group of groups) {
    const record = asRecord(group);
    if (!record) continue;
    const provider = id(record.id);
    if (!provider || (allowed.size > 0 && !allowed.has(provider))) continue;
    const providerName = id(record.name) || provider;
    const models = Array.isArray(record.models) ? record.models : [];
    for (const model of models) {
      const item = asRecord(model);
      if (!item) continue;
      const modelId = id(item.id);
      if (!modelId) continue;
      options.push({
        provider,
        providerName,
        model: modelId,
        name: id(item.name) || modelId,
      });
    }
  }
  const failures: DshCatalogFailure[] = [];
  const rawFailures = Array.isArray(raw?.failures) ? raw.failures : [];
  for (const failure of rawFailures) {
    const record = asRecord(failure);
    if (!record) continue;
    const provider = id(record.id);
    if (!provider) continue;
    failures.push({
      provider,
      name: id(record.name) || provider,
      message: clip(typeof record.message === "string" ? record.message : ""),
    });
  }
  const fallback = asRecord(raw?.default);
  const provider = id(fallback?.provider);
  const model = id(fallback?.model);
  const matched = provider && model ? options.find((item) => item.provider === provider && item.model === model) : undefined;
  const defaultModel = provider && model
    ? matched ?? { provider, providerName: provider, model, name: model }
    : null;
  return { defaultModel, options, failures };
}

export function sameDshModel(left: DshModelRef | null | undefined, right: DshModelRef | null | undefined): boolean {
  if (!left || !right) return left == null && right == null;
  return left.provider === right.provider && left.model === right.model;
}

export function formatDshModelRef(model: DshModelRef | null | undefined): string {
  if (!model?.provider || !model.model) return "";
  return `${model.provider} / ${model.model}`;
}

export function matchDshModel(
  value: unknown,
  options: DshCatalogOption[],
): { ok: true; model: DshModelRef } | { ok: false; error: string } {
  const raw = asRecord(value);
  const provider = id(raw?.provider);
  const model = id(raw?.model);
  if (!provider || !model) return { ok: false, error: "请从当前目录里选一个模型。" };
  const found = options.some((item) => item.provider === provider && item.model === model);
  if (!found) return { ok: false, error: "这个模型不在当前 DSH 目录里。请刷新设置后再选。" };
  return { ok: true, model: { provider, model } };
}

export function emptyDshCatalog(error: string): DshCatalogView {
  return { loaded: false, error, defaultModel: null, options: [], failures: [] };
}

export function catalogFromValue(value: unknown): DshCatalogView {
  return { loaded: true, error: "", ...parseModelCatalog(value) };
}
