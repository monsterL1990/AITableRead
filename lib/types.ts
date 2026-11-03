export type StepId = 1 | 2 | 3;

export type StartFrom = "idea" | "outline" | "manuscript";

export type VersionKind = "outline" | "draft" | "polish";

export type VersionSource = "generate" | "feedback" | "quality" | "manual" | "import" | "purge";

/** 出字实际走的路。custom 是设置里保存的 OpenAI 兼容接口。默认不经 DSH；打开 purge 后仍记这条偏好，提交改走 DSH 临时 provider。 */
export type TextRoute = "dsh" | "cliproxy" | "custom" | "demo";

/** 用户希望走的路。稿库没存过时按环境默认：配齐 DSH 则 dsh，否则环境里的 OpenAI 兼容接口（cliproxy）。custom 只能手选。 */
export type PreferredTextRoute = "dsh" | "cliproxy" | "custom";

/** 经 DSH 时改用目录里的某一对。null 表示新开会话沿用内核默认。 */
export type DshModelRef = {
  provider: string;
  model: string;
};

/** 实拉到的一条可选模型。name 是目录里的展示名。 */
export type DshCatalogOption = DshModelRef & {
  providerName: string;
  name: string;
};

export type DshCatalogFailure = {
  provider: string;
  name: string;
  message: string;
};

/** 设置页上的 DSH 模型目录。loaded 为 false 时不要编造选项。 */
export type DshCatalogView = {
  loaded: boolean;
  error: string;
  defaultModel: DshCatalogOption | null;
  options: DshCatalogOption[];
  failures: DshCatalogFailure[];
};

/** 设置页保存的 OpenAI 兼容接口。apiKey 只留在稿库，接口响应里用掩码。 */
export type CustomApiConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

/** 下发给页面的自定义 API。没有 apiKey 字段。 */
export type PublicCustomApi = {
  baseUrl: string;
  model: string;
  apiKeyMask: string;
  configured: boolean;
  missing: string[];
};

export type PromptKey = "outline" | "draft" | "polish" | "reviseFromFeedback" | "qualityCheck";

export type GenerateTask =
  | "outline"
  | "draft"
  | "polish"
  | "review"
  | "revise-from-feedback"
  | "quality-check"
  | "amend-review";

export type FeedbackSource = "user" | "readers" | "quality";

/** builtin 是预置，manual 是手加，from-spec 是用一句话需求生成的，文档可选。 */
export type ReaderOrigin = "builtin" | "manual" | "from-spec";

export type TextVersion = {
  id: string;
  kind: VersionKind;
  label: string;
  text: string;
  source: VersionSource;
  note: string;
  createdAt: string;
};

export type ReaderProfile = {
  id: string;
  name: string;
  blurb: string;
  /** 系统提示词。硬性成年规则在调用时另附，不写进这里。 */
  prompt: string;
  blocked: boolean;
  origin: ReaderOrigin;
};

/** 新意见默认未定。只有采纳的会进入「按已有读者意见改一版」。 */
export type ReviewTriage = "unset" | "adopted" | "ignored";

export type ReviewNote = {
  id: string;
  readerId: string;
  readerName: string;
  step: StepId;
  versionId: string;
  text: string;
  createdAt: string;
  triage: ReviewTriage;
  /** 作者对这条意见的讨论。非空时，采纳后会作为「讨论增订」一起送去改稿。 */
  discussion: string;
};

export type QualityReport = {
  step: StepId;
  versionId: string;
  text: string;
  createdAt: string;
};

export type LogEntry = {
  id: string;
  at: string;
  step: StepId | null;
  type: string;
  summary: string;
  detail: string;
  versionId: string | null;
};

/**
 * 服务端正在跑的一轮出字。刷新、关标签都靠它恢复，不靠浏览器内存。
 * 结束、失败、超时、用户取消后清掉。
 */
export type PendingJob = {
  task: GenerateTask;
  step: StepId;
  startedAt: string;
  requestId?: string;
  /** 页面对应的按钮，例如 quality-revise、读者 id。 */
  label: string;
  feedbackSource?: FeedbackSource;
  readerId?: string;
};

export type Project = {
  id: string;
  /** 稿子所属账号。站长是 local。好友账号各自一份，互不可见。 */
  ownerId: string;
  title: string;
  startFrom: StartFrom;
  idea: string;
  outline: string;
  draft: string;
  polished: string;
  wordMin: number | null;
  wordMax: number | null;
  versions: TextVersion[];
  currentVersion: Partial<Record<VersionKind, string>>;
  reviews: ReviewNote[];
  qualityReport: QualityReport | null;
  confirmed: Record<StepId, boolean>;
  confirmedAt: Record<StepId, string | null>;
  currentStep: StepId;
  log: LogEntry[];
  /** 有值表示这一轮出字还在服务器上跑。空闲时为 null。 */
  pendingJob: PendingJob | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
};

export type ProjectSummary = {
  id: string;
  title: string;
  currentStep: StepId;
  polishConfirmed: boolean;
  startFrom: StartFrom;
  updatedAt: string;
  createdAt: string;
  archivePath: string;
};

export type PublicConfig = {
  demoMode: boolean;
  missing: string[];
  model: string | null;
  baseUrl: string | null;
  devPasswordHint: boolean;
  authConfigured: boolean;
  /** 出字实际走的路。页面和流程记录按这个显示。 */
  textRoute: TextRoute;
  /** DSH 三项环境变量是否都在。 */
  dshConfigured: boolean;
  /** DSH 未配齐时缺哪些变量。配齐时为空。 */
  dshMissing: string[];
  /** 稿库里的选择；没存过时是按环境算出的默认。 */
  preferredTextRoute: PreferredTextRoute;
  /** 偏好没法按原样生效时的说明。能对上时为空字符串。 */
  textRouteNote: string;
  /** 自定义 API 的公开字段。密钥只有掩码。 */
  customApi: PublicCustomApi;
  /** 经 DSH 时保存的模型。null 表示沿用内核默认。 */
  dshModel: DshModelRef | null;
  /**
   * 稿库里的「经 DSH purge」。预设账号恒为 false（他们本来就强制走站点 DSH）。
   * 非预设为 true 时，自定义 API 改经 DSH 临时 provider。站长只有选了自定义 API 才因此改道。
   */
  purgeEnabled?: boolean;
  /** 当前登录账号。未登录时不带。 */
  accountType?: AccountType | null;
  /** 设置页能看见哪一块。未登录时不带。 */
  settingsVisibility?: SettingsVisibility;
};

/** preset-grok / preset-ds 都强制经 DSH purge，没有设置页。旧稿库里的 preset 读入时当成 preset-grok。 */
export type AccountType = "owner" | "preset-grok" | "preset-ds" | "custom";

/** full：站长，路由和模型都在。custom-only：只留自定义 API。hidden：两种预设都不进设置。 */
export type SettingsVisibility = "full" | "custom-only" | "hidden";

export type TextRouteSettings = Pick<
  PublicConfig,
  "textRoute" | "dshConfigured" | "dshMissing" | "preferredTextRoute" | "textRouteNote" | "customApi"
>;

/** 设置页。模型目录只在这里实拉，不放进未登录也能读的 /api/config。 */
export type SettingsResponse = TextRouteSettings & {
  dshModel: DshModelRef | null;
  dshCatalog: DshCatalogView;
  accountType: AccountType;
  settingsVisibility: SettingsVisibility;
  /** 自定义 API 是否经 DSH purge。预设账号进不了设置页。 */
  purgeEnabled: boolean;
};

export type GenerateSnapshot = {
  idea?: string;
  outline?: string;
  draft?: string;
  polished?: string;
  wordMin?: number | null;
  wordMax?: number | null;
};

export const LOCAL_USER_ID = "local";

export const LIMITS = {
  title: 80,
  idea: 20_000,
  outline: 40_000,
  draft: 80_000,
  polished: 80_000,
  review: 40_000,
  feedback: 20_000,
  prompt: 20_000,
  readerName: 40,
  readerBlurb: 200,
} as const;
