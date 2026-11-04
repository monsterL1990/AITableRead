import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeCustomApi } from "./custom-api";
import { emptyDshConnection, normalizeStoredDsh } from "./dsh-setup";
import { parsePendingJob } from "./pending-job";
import { appendLog, createProjectRecord, defaultReaders, isStartFrom, isStepId, pushVersion, reviewTriageOf } from "./pipeline";
import type { Locale } from "./i18n/locale";
import type { CustomApiConfig, DshModelRef, PreferredTextRoute, Project, PromptKey, ReaderProfile, StartFrom, StepId, StoredDshConnection, TextVersion } from "./types";
import { LIMITS, LOCAL_USER_ID } from "./types";

export type StoredSettings = {
  /** null 表示还没选，出字按环境默认。 */
  preferredTextRoute: PreferredTextRoute | null;
  /** 自定义 API。密钥明文留在稿库，接口响应只给掩码。 */
  customApi: CustomApiConfig;
  /** null 表示经 DSH 时沿用内核默认模型。 */
  dshModel: DshModelRef | null;
  /** 向导保存的 DSH。缺省或三项都空时出字仍读环境变量。 */
  dsh?: StoredDshConnection;
  /** 旧字段。读出来恒为 false，不再把自备 Key 送进 purge。 */
  purgeEnabled: boolean;
};

type Workspace = {
  prompts: Partial<Record<PromptKey, string>>;
  readers: ReaderProfile[];
  settings: StoredSettings;
};

type StoreData = {
  version: 3;
  /** Unset until the user picks a language in the switch. */
  locale?: Locale;
  workspaces: Record<string, Workspace>;
  projects: Project[];
};

const PROMPT_KEYS: PromptKey[] = ["outline", "draft", "polish", "reviseFromFeedback", "qualityCheck"];

function dataFile(): string {
  return process.env.GAOJIAN_DATA_FILE || path.join(process.cwd(), "data", "store.json");
}

function emptySettings(): StoredSettings {
  return {
    preferredTextRoute: null,
    customApi: { baseUrl: "", apiKey: "", model: "" },
    dshModel: null,
    dsh: emptyDshConnection(),
    purgeEnabled: false,
  };
}

function normalizeDshModel(value: unknown): DshModelRef | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const provider = asString(raw.provider).trim();
  const model = asString(raw.model).trim();
  if (!provider || !model || provider.length > 120 || model.length > 120) return null;
  if (/[\r\n]/.test(provider) || /[\r\n]/.test(model)) return null;
  return { provider, model };
}

function cloneSettings(settings: StoredSettings): StoredSettings {
  return {
    preferredTextRoute: settings.preferredTextRoute,
    customApi: { ...settings.customApi },
    dshModel: settings.dshModel ? { ...settings.dshModel } : null,
    dsh: { ...(settings.dsh ?? emptyDshConnection()) },
    purgeEnabled: false,
  };
}

function emptyWorkspace(): Workspace {
  return { prompts: {}, readers: defaultReaders(), settings: emptySettings() };
}

function emptyStore(): StoreData {
  return { version: 3, workspaces: { [LOCAL_USER_ID]: emptyWorkspace() }, projects: [] };
}

function readLocale(value: unknown): Locale | undefined {
  return value === "zh" || value === "en" ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeReader(value: unknown, index: number): ReaderProfile | null {
  const raw = asRecord(value);
  if (!raw || typeof raw.id !== "string" || !raw.id.trim()) return null;
  const name = asString(raw.name).trim();
  const prompt = asString(raw.prompt).trim();
  if (!name || !prompt) return null;
  const origin = raw.origin === "builtin" || raw.origin === "manual" || raw.origin === "from-spec" ? raw.origin : "manual";
  return {
    id: raw.id,
    name: name.slice(0, LIMITS.readerName),
    blurb: asString(raw.blurb).slice(0, LIMITS.readerBlurb),
    prompt: prompt.slice(0, LIMITS.prompt),
    blocked: raw.blocked === true,
    origin: index < 0 ? origin : origin,
  };
}

function normalizeVersion(value: unknown): TextVersion | null {
  const raw = asRecord(value);
  if (!raw || typeof raw.id !== "string") return null;
  const kind = raw.kind === "outline" || raw.kind === "draft" || raw.kind === "polish" ? raw.kind : null;
  if (!kind || typeof raw.text !== "string") return null;
  const source =
    raw.source === "generate" ||
    raw.source === "feedback" ||
    raw.source === "quality" ||
    raw.source === "manual" ||
    raw.source === "import" ||
    raw.source === "purge"
      ? raw.source
      : "manual";
  return {
    id: raw.id,
    kind,
    label: asString(raw.label, kind),
    text: raw.text,
    source,
    note: asString(raw.note),
    createdAt: asString(raw.createdAt, new Date().toISOString()),
  };
}

function isV2Project(raw: Record<string, unknown>): boolean {
  return Array.isArray(raw.versions) && (raw.startFrom === "idea" || raw.startFrom === "outline" || raw.startFrom === "manuscript" || raw.polished !== undefined);
}

function normalizeV2Project(raw: Record<string, unknown>): Project | null {
  if (typeof raw.id !== "string" || typeof raw.ownerId !== "string") return null;
  const now = asString(raw.createdAt, new Date().toISOString());
  const startFrom: StartFrom = isStartFrom(raw.startFrom) ? raw.startFrom : "idea";
  const project = createProjectRecord({
    id: raw.id,
    ownerId: raw.ownerId,
    title: asString(raw.title, "未命名"),
    startFrom: "idea",
    idea: asString(raw.idea),
    wordMin: typeof raw.wordMin === "number" ? raw.wordMin : null,
    wordMax: typeof raw.wordMax === "number" ? raw.wordMax : null,
    now,
  });
  project.startFrom = startFrom;
  project.log = [];
  project.versions = [];
  project.currentVersion = {};
  project.outline = asString(raw.outline);
  project.draft = asString(raw.draft);
  project.polished = asString(raw.polished);
  project.versions = Array.isArray(raw.versions) ? raw.versions.map(normalizeVersion).filter((item): item is TextVersion => item !== null) : [];
  const current = asRecord(raw.currentVersion) ?? {};
  for (const kind of ["outline", "draft", "polish"] as const) {
    if (typeof current[kind] === "string") project.currentVersion[kind] = current[kind];
  }
  project.reviews = Array.isArray(raw.reviews)
    ? raw.reviews.flatMap((item) => {
        const note = asRecord(item);
        if (!note || typeof note.id !== "string" || typeof note.text !== "string") return [];
        if (!isStepId(note.step)) return [];
        return [{
          id: note.id,
          readerId: asString(note.readerId),
          readerName: asString(note.readerName, "读者"),
          step: note.step,
          versionId: asString(note.versionId),
          text: note.text,
          createdAt: asString(note.createdAt, now),
          triage: reviewTriageOf(note.triage),
          discussion: asString(note.discussion).slice(0, LIMITS.feedback),
        }];
      })
    : [];
  const quality = asRecord(raw.qualityReport);
  project.qualityReport =
    quality && isStepId(quality.step) && typeof quality.text === "string"
      ? { step: quality.step, versionId: asString(quality.versionId), text: quality.text, createdAt: asString(quality.createdAt, now) }
      : null;
  const confirmed = asRecord(raw.confirmed) ?? {};
  const confirmedAt = asRecord(raw.confirmedAt) ?? {};
  for (const step of [1, 2, 3] as const) {
    project.confirmed[step] = confirmed[String(step)] === true || confirmed[step] === true;
    project.confirmedAt[step] = typeof confirmedAt[String(step)] === "string" ? (confirmedAt[String(step)] as string) : typeof confirmedAt[step] === "string" ? (confirmedAt[step] as string) : null;
  }
  project.currentStep = isStepId(raw.currentStep) ? raw.currentStep : 1;
  if (project.currentStep > 1 && !project.confirmed[1]) project.confirmed[1] = true;
  if (project.currentStep > 2 && !project.confirmed[2]) project.confirmed[2] = true;
  project.log = Array.isArray(raw.log)
    ? raw.log.flatMap((item) => {
        const entry = asRecord(item);
        if (!entry || typeof entry.id !== "string" || typeof entry.summary !== "string") return [];
        return [{
          id: entry.id,
          at: asString(entry.at, now),
          step: isStepId(entry.step) ? entry.step : null,
          type: asString(entry.type, "note"),
          summary: entry.summary,
          detail: asString(entry.detail),
          versionId: typeof entry.versionId === "string" ? entry.versionId : null,
        }];
      })
    : [];
  project.updatedAt = asString(raw.updatedAt, now);
  project.revision = typeof raw.revision === "number" && raw.revision > 0 ? raw.revision : 1;
  project.pendingJob = parsePendingJob(raw.pendingJob);
  return project;
}

function migrateV1Project(raw: Record<string, unknown>): Project | null {
  if (typeof raw.id !== "string" || typeof raw.ownerId !== "string") return null;
  const now = asString(raw.createdAt, new Date().toISOString());
  const oldStep = typeof raw.currentStep === "number" ? raw.currentStep : 1;
  const project = createProjectRecord({
    id: raw.id,
    ownerId: raw.ownerId,
    title: asString(raw.title, "未命名"),
    idea: asString(raw.idea),
    wordMin: null,
    wordMax: null,
    now,
  });
  project.log = [];
  project.outline = asString(raw.outline);
  project.draft = asString(raw.draft);
  project.polished = asString(raw.revised);
  if (project.outline.trim()) pushVersion(project, "outline", project.outline, "import", "从旧稿迁入", now);
  if (project.draft.trim()) pushVersion(project, "draft", project.draft, "import", "从旧稿迁入", now);
  if (project.polished.trim()) pushVersion(project, "polish", project.polished, "import", "从旧改稿迁入", now);
  const oldReviews = asRecord(raw.reviews) ?? {};
  const names: Record<string, string> = { r18: "R18读者", monster: "怪物Z", middle: "中年男" };
  for (const id of ["r18", "monster", "middle"]) {
    const text = oldReviews[id];
    if (typeof text !== "string" || !text.trim()) continue;
    project.reviews.push({
      id: `${raw.id}-${id}`,
      readerId: id,
      readerName: names[id] ?? id,
      step: 2,
      versionId: project.currentVersion.draft ?? "",
      text,
      createdAt: now,
      triage: "unset",
      discussion: "",
    });
  }
  const step: StepId = oldStep <= 1 ? 1 : oldStep === 2 ? 2 : 3;
  project.currentStep = step;
  project.confirmed[1] = step > 1;
  project.confirmed[2] = step > 2;
  project.confirmed[3] = raw.finalized === true;
  if (project.confirmed[1]) project.confirmedAt[1] = now;
  if (project.confirmed[2]) project.confirmedAt[2] = now;
  if (project.confirmed[3]) project.confirmedAt[3] = asString(raw.finalizedAt, now);
  project.updatedAt = asString(raw.updatedAt, now);
  project.revision = typeof raw.revision === "number" && raw.revision > 0 ? raw.revision : 1;
  appendLog(project, {
    at: now,
    step: project.currentStep,
    type: "migrate",
    summary: "从五步稿单迁到三步。旧的读者意见留在初稿这一步。",
    detail: "",
    versionId: null,
  });
  return project;
}

function normalizeProject(value: unknown): Project | null {
  const raw = asRecord(value);
  if (!raw) return null;
  if (isV2Project(raw)) return normalizeV2Project(raw);
  return migrateV1Project(raw);
}

function normalizePrompts(value: unknown): Partial<Record<PromptKey, string>> {
  const raw = asRecord(value) ?? {};
  const prompts: Partial<Record<PromptKey, string>> = {};
  for (const key of PROMPT_KEYS) {
    const text = raw[key];
    if (typeof text === "string" && text.trim()) prompts[key] = text;
  }
  if (!prompts.reviseFromFeedback && typeof raw.revise === "string" && raw.revise.trim()) {
    prompts.reviseFromFeedback = raw.revise;
  }
  return prompts;
}

function normalizeSettings(value: unknown): StoredSettings {
  const raw = asRecord(value);
  const preferred = raw?.preferredTextRoute;
  const preferredTextRoute = preferred === "dsh" || preferred === "cliproxy" || preferred === "custom" ? preferred : null;
  return {
    preferredTextRoute,
    customApi: normalizeCustomApi(raw?.customApi),
    dshModel: normalizeDshModel(raw?.dshModel),
    dsh: normalizeStoredDsh(raw?.dsh),
    purgeEnabled: false,
  };
}

function normalizeReaders(value: unknown): ReaderProfile[] {
  if (!Array.isArray(value)) return defaultReaders();
  return value.map((item, index) => normalizeReader(item, index)).filter((item): item is ReaderProfile => item !== null);
}

function normalizeWorkspace(value: unknown): Workspace {
  const raw = asRecord(value);
  return {
    prompts: normalizePrompts(raw?.prompts),
    readers: normalizeReaders(raw ? raw.readers : undefined),
    settings: normalizeSettings(raw?.settings),
  };
}

function normalize(value: unknown): StoreData {
  const raw = asRecord(value);
  if (!raw) return emptyStore();
  const projects = Array.isArray(raw.projects)
    ? raw.projects.map(normalizeProject).filter((item): item is Project => item !== null)
    : [];
  const workspacesRaw = asRecord(raw.workspaces);
  const workspaces: Record<string, Workspace> = {};
  if (workspacesRaw) {
    for (const [uid, workspace] of Object.entries(workspacesRaw)) {
      if (!uid.trim()) continue;
      workspaces[uid] = normalizeWorkspace(workspace);
    }
  }
  const hasLegacy = raw.prompts !== undefined || raw.readers !== undefined || raw.settings !== undefined;
  if (!workspaces[LOCAL_USER_ID] && (hasLegacy || !workspacesRaw)) {
    workspaces[LOCAL_USER_ID] = normalizeWorkspace({
      prompts: raw.prompts,
      readers: raw.readers,
      settings: raw.settings,
    });
  }
  const locale = readLocale(raw.locale);
  return { version: 3, ...(locale ? { locale } : {}), workspaces, projects };
}

function ensureWorkspace(store: StoreData, uid: string): Workspace {
  const existing = store.workspaces[uid];
  if (existing) return existing;
  const created = emptyWorkspace();
  store.workspaces[uid] = created;
  return created;
}

let queue: Promise<unknown> = Promise.resolve();

function locked<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function read(): Promise<StoreData> {
  try {
    const raw = await readFile(/* turbopackIgnore: true */ dataFile(), "utf8");
    if (!raw.trim()) return emptyStore();
    return normalize(JSON.parse(raw));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return emptyStore();
    throw error;
  }
}

async function write(store: StoreData): Promise<void> {
  const file = dataFile();
  await mkdir(/* turbopackIgnore: true */ path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(/* turbopackIgnore: true */ tmp, JSON.stringify(store, null, 2));
  await rename(/* turbopackIgnore: true */ tmp, /* turbopackIgnore: true */ file);
}

export async function listProjects(ownerId: string): Promise<Project[]> {
  return locked(async () => {
    const store = await read();
    return store.projects
      .filter((project) => project.ownerId === ownerId)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      .map((project) => structuredClone(project));
  });
}

export async function getProject(ownerId: string, id: string): Promise<Project | null> {
  return locked(async () => {
    const store = await read();
    const project = store.projects.find((item) => item.id === id && item.ownerId === ownerId);
    return project ? structuredClone(project) : null;
  });
}

export async function createProject(
  ownerId: string,
  input: { title: string; startFrom: StartFrom; idea?: string; outline?: string; manuscript?: string; wordMin?: number | null; wordMax?: number | null },
): Promise<Project> {
  return locked(async () => {
    const store = await read();
    const project = createProjectRecord({
      id: crypto.randomUUID(),
      ownerId,
      title: input.title,
      startFrom: input.startFrom,
      idea: input.idea,
      outline: input.outline,
      manuscript: input.manuscript,
      wordMin: input.wordMin,
      wordMax: input.wordMax,
    });
    store.projects.push(project);
    await write(store);
    return structuredClone(project);
  });
}

export async function updateProject(
  ownerId: string,
  id: string,
  mutate: (project: Project) => void,
): Promise<Project | null> {
  return locked(async () => {
    const store = await read();
    const project = store.projects.find((item) => item.id === id && item.ownerId === ownerId);
    if (!project) return null;
    mutate(project);
    project.updatedAt = new Date().toISOString();
    project.revision += 1;
    await write(store);
    return structuredClone(project);
  });
}

export async function deleteProject(ownerId: string, id: string): Promise<boolean> {
  return locked(async () => {
    const store = await read();
    const before = store.projects.length;
    store.projects = store.projects.filter((item) => !(item.id === id && item.ownerId === ownerId));
    if (store.projects.length === before) return false;
    await write(store);
    return true;
  });
}

export async function getPromptOverrides(uid = LOCAL_USER_ID): Promise<Partial<Record<PromptKey, string>>> {
  return locked(async () => ({ ...(await read()).workspaces[uid]?.prompts }));
}

export async function setPromptOverrides(
  prompts: Partial<Record<PromptKey, string>>,
  uid = LOCAL_USER_ID,
): Promise<Partial<Record<PromptKey, string>>> {
  return locked(async () => {
    const store = await read();
    const workspace = ensureWorkspace(store, uid);
    for (const key of PROMPT_KEYS) {
      if (!(key in prompts)) continue;
      const text = prompts[key];
      if (typeof text !== "string" || !text.trim()) delete workspace.prompts[key];
      else workspace.prompts[key] = text;
    }
    await write(store);
    return { ...workspace.prompts };
  });
}

export async function listReaders(uid = LOCAL_USER_ID): Promise<ReaderProfile[]> {
  return locked(async () => {
    const readers = (await read()).workspaces[uid]?.readers;
    return structuredClone(readers ?? defaultReaders());
  });
}

export async function createReader(
  input: {
    name: string;
    blurb: string;
    prompt: string;
    origin?: ReaderProfile["origin"];
  },
  uid = LOCAL_USER_ID,
): Promise<ReaderProfile> {
  return locked(async () => {
    const store = await read();
    const workspace = ensureWorkspace(store, uid);
    const reader: ReaderProfile = {
      id: crypto.randomUUID(),
      name: input.name.trim(),
      blurb: input.blurb.trim(),
      prompt: input.prompt.trim(),
      blocked: false,
      origin: input.origin === "from-spec" ? "from-spec" : "manual",
    };
    workspace.readers.push(reader);
    await write(store);
    return structuredClone(reader);
  });
}

export async function updateReader(
  id: string,
  patch: Partial<Pick<ReaderProfile, "name" | "blurb" | "prompt" | "blocked">>,
  uid = LOCAL_USER_ID,
): Promise<ReaderProfile | null> {
  return locked(async () => {
    const store = await read();
    const workspace = ensureWorkspace(store, uid);
    const reader = workspace.readers.find((item) => item.id === id);
    if (!reader) return null;
    if (typeof patch.name === "string" && patch.name.trim()) reader.name = patch.name.trim();
    if (typeof patch.blurb === "string") reader.blurb = patch.blurb;
    if (typeof patch.prompt === "string" && patch.prompt.trim()) reader.prompt = patch.prompt;
    if (typeof patch.blocked === "boolean") reader.blocked = patch.blocked;
    await write(store);
    return structuredClone(reader);
  });
}

export async function getUiLocale(): Promise<Locale | null> {
  return locked(async () => (await read()).locale ?? null);
}

export async function setUiLocale(locale: Locale): Promise<Locale> {
  return locked(async () => {
    const store = await read();
    store.locale = locale;
    await write(store);
    return locale;
  });
}

export async function getSettings(uid = LOCAL_USER_ID): Promise<StoredSettings> {
  return locked(async () => cloneSettings((await read()).workspaces[uid]?.settings ?? emptySettings()));
}

export async function setPreferredTextRoute(route: PreferredTextRoute, uid = LOCAL_USER_ID): Promise<StoredSettings> {
  return updateTextSettings({ preferredTextRoute: route }, uid);
}

export async function updateTextSettings(
  patch: {
    preferredTextRoute?: PreferredTextRoute;
    customApi?: CustomApiConfig;
    dshModel?: DshModelRef | null;
    dsh?: StoredDshConnection;
    /** 忽略。保留参数是为了旧调用不报错，写进去也是关掉。 */
    purgeEnabled?: boolean;
  },
  uid = LOCAL_USER_ID,
): Promise<StoredSettings> {
  return locked(async () => {
    const store = await read();
    const workspace = ensureWorkspace(store, uid);
    if (patch.preferredTextRoute) workspace.settings.preferredTextRoute = patch.preferredTextRoute;
    if (patch.customApi) workspace.settings.customApi = { ...patch.customApi };
    if ("dshModel" in patch) workspace.settings.dshModel = patch.dshModel ? { ...patch.dshModel } : null;
    if (patch.dsh) workspace.settings.dsh = { ...patch.dsh };
    workspace.settings.purgeEnabled = false;
    await write(store);
    return cloneSettings(workspace.settings);
  });
}

export async function deleteReader(id: string, uid = LOCAL_USER_ID): Promise<boolean> {
  return locked(async () => {
    const store = await read();
    const workspace = ensureWorkspace(store, uid);
    const before = workspace.readers.length;
    workspace.readers = workspace.readers.filter((item) => item.id !== id);
    if (workspace.readers.length === before) return false;
    await write(store);
    return true;
  });
}

/** 删除好友时清掉这个 uid 的稿子、读者、提示词和设置。站长的稿库不动。 */
export async function purgeUserData(uid: string): Promise<void> {
  if (!uid || uid === LOCAL_USER_ID) return;
  return locked(async () => {
    const store = await read();
    let changed = false;
    if (store.workspaces[uid]) {
      delete store.workspaces[uid];
      changed = true;
    }
    const before = store.projects.length;
    store.projects = store.projects.filter((item) => item.ownerId !== uid);
    if (store.projects.length !== before) changed = true;
    if (changed) await write(store);
  });
}
