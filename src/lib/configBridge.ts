/**
 * Typed wrapper over the Rust config commands.
 *
 * These read and write pi's own files (`~/.pi/agent/*`). Nothing is cached
 * locally, so a change made here is visible to the `pi` CLI immediately and
 * vice versa.
 */

import { invoke } from "@tauri-apps/api/core";

export type ConfigFile = "models" | "settings" | "mcp";

export interface ConfigPaths {
  agentDir: string;
  models: string;
  settings: string;
  mcp: string;
  auth: string;
  skillsDir: string;
  sharedSkillsDir: string;
}

// ---------------------------------------------------------------- providers
//
// These mirror pi's own `models.json` schema (core/model-config.d.ts). Every
// key pi accepts has a slot here, so nothing has to fall back to hand-editing.
// `[key: string]: unknown` stays on each level so a key we do not surface yet
// survives a round trip through the editor.

/** Per-million-token price above a token threshold. */
export interface ModelCostTier {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  inputTokensAbove: number;
}

/** USD per million tokens. `tiers` overrides the flat price past a threshold. */
export interface ModelCost {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  tiers?: ModelCostTier[];
}

export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/**
 * Maps pi's own levels onto whatever strings the provider uses.
 *
 * Three states per level, and the difference matters: absent means "let pi
 * decide", a string means "send this", and `null` means "this model has no such
 * level" — which is what removes it from the picker.
 */
export type ThinkingLevelMap = Partial<Record<ThinkingLevel, string | null>>;

export interface ImageResizeLimits {
  maxWidth?: number;
  maxHeight?: number;
  maxBytes?: number;
  jpegQuality?: number;
}

export interface ImageLimits {
  resize?: ImageResizeLimits;
  maxPerMessage?: number;
  maxPerRequest?: number;
}

export interface InputLimits {
  maxRequestBytes?: number;
  images?: ImageLimits;
}

/** Best-effort prompt-cache lifetime in seconds, per retention tier. */
export interface PromptCacheLifetime {
  short?: number;
  long?: number;
}

export interface ProviderCompat {
  // OpenAI chat-completions family
  supportsStore?: boolean;
  supportsDeveloperRole?: boolean;
  supportsReasoningEffort?: boolean;
  supportsUsageInStreaming?: boolean;
  supportsFinishReason?: boolean;
  maxTokensField?: "max_completion_tokens" | "max_tokens";
  requiresToolResultName?: boolean;
  requiresAssistantAfterToolResult?: boolean;
  requiresThinkingAsText?: boolean;
  requiresReasoningContentOnAssistantMessages?: boolean;
  thinkingFormat?: CompatThinkingFormat;
  chatTemplateKwargs?: Record<string, unknown>;
  chatTemplateArgs?: Record<string, unknown>;
  cacheControlFormat?: "anthropic";
  openRouterRouting?: Record<string, unknown>;
  vercelGatewayRouting?: Record<string, unknown>;
  supportsOpenAIGrammarTools?: boolean;
  supportsStrictMode?: boolean;
  sendSessionAffinityHeaders?: boolean;
  sessionAffinityFormat?: CompatSessionAffinity;
  supportsLongCacheRetention?: boolean;
  vllmPriority?: number;
  // OpenAI responses family
  supportsMaxOutputTokens?: boolean;
  // Anthropic messages family
  supportsEagerToolInputStreaming?: boolean;
  supportsCacheControlOnTools?: boolean;
  supportsTemperature?: boolean;
  forceAdaptiveThinking?: boolean;
  allowEmptySignature?: boolean;
  supportsStrictTools?: boolean;
  supportsMidConvoEffort?: boolean;
  allowedFallbackModels?: unknown[];
  [key: string]: unknown;
}

export type CompatThinkingFormat =
  | "openai"
  | "openrouter"
  | "together"
  | "baseten"
  | "deepseek"
  | "zai"
  | "qwen"
  | "chat-template"
  | "qwen-chat-template"
  | "string-thinking"
  | "ant-ling";

export type CompatSessionAffinity = "openai" | "openai-nosession" | "openrouter";

/** One entry of a provider's `models` array. */
export interface ProviderModel {
  id: string;
  name?: string;
  /** Overrides the provider's protocol for this one model. */
  api?: string;
  baseUrl?: string;
  reasoning?: boolean;
  thinkingLevelMap?: ThinkingLevelMap;
  input?: Array<"text" | "image">;
  inputLimits?: InputLimits;
  cost?: ModelCost;
  promptCache?: PromptCacheLifetime;
  contextWindow?: number;
  maxTokens?: number;
  samplingParams?: Record<string, unknown>;
  samplingParamsByThinkingLevel?: Partial<Record<ThinkingLevel, Record<string, unknown>>>;
  headers?: Record<string, string>;
  compat?: ProviderCompat;
  [key: string]: unknown;
}

/** `modelOverrides` entries patch a model without replacing the list. */
export type ProviderModelOverride = Omit<ProviderModel, "id" | "api" | "baseUrl">;

export interface ProviderConfig {
  name?: string;
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  /** pi's only built-in OAuth flow. */
  oauth?: "radius";
  headers?: Record<string, string>;
  compat?: ProviderCompat;
  /** Swap the preset apiKey header for a bare `Authorization`. */
  authHeader?: boolean;
  models?: ProviderModel[];
  modelOverrides?: Record<string, ProviderModelOverride>;
  [key: string]: unknown;
}

export interface ModelsDocument {
  providers: Record<string, ProviderConfig>;
  [key: string]: unknown;
}

/** Protocol implementations pi can talk. */
export const PI_APIS = [
  "openai-completions",
  "openai-responses",
  "azure-openai-responses",
  "anthropic-messages",
  "google-generative-ai",
  "google-vertex",
  "mistral-conversations",
  "bedrock-converse",
];

export const PI_OAUTH = ["radius"] as const;

export const COMPAT_THINKING_FORMATS: CompatThinkingFormat[] = [
  "openai",
  "openrouter",
  "together",
  "baseten",
  "deepseek",
  "zai",
  "qwen",
  "chat-template",
  "qwen-chat-template",
  "string-thinking",
  "ant-ling",
];

export const COMPAT_SESSION_AFFINITY: CompatSessionAffinity[] = [
  "openai",
  "openai-nosession",
  "openrouter",
];

/** Values seen in the wild, offered as suggestions for `thinkingLevelMap`. */
export const THINKING_VALUE_HINTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "max",
  "xhigh",
  "on",
  "think",
  "true",
];

export interface CompatField {
  key: keyof ProviderCompat & string;
  label: string;
  kind: "bool" | "select" | "number";
  options?: readonly string[];
  hint?: string;
}

export interface CompatFamily {
  id: string;
  label: string;
  hint: string;
  fields: CompatField[];
}

/**
 * `compat` is a union of three shapes in pi's schema, so the editor groups the
 * keys by the API family they belong to. Object-valued keys are deliberately
 * absent here — they live in the raw JSON box.
 */
export const COMPAT_FAMILIES: CompatFamily[] = [
  {
    id: "openai",
    label: "OpenAI 兼容（chat completions）",
    hint: "openai-completions / azure-openai-responses 使用这一组。",
    fields: [
      { key: "supportsStore", label: "支持 store", kind: "bool", hint: "请求里是否接受 store 字段" },
      { key: "supportsDeveloperRole", label: "支持 developer 角色", kind: "bool" },
      { key: "supportsReasoningEffort", label: "支持 reasoning_effort", kind: "bool" },
      { key: "supportsUsageInStreaming", label: "流式返回 usage", kind: "bool" },
      { key: "supportsFinishReason", label: "返回 finish_reason", kind: "bool" },
      {
        key: "maxTokensField",
        label: "最大输出字段名",
        kind: "select",
        options: ["max_completion_tokens", "max_tokens"],
      },
      { key: "requiresToolResultName", label: "工具结果需带 name", kind: "bool" },
      { key: "requiresAssistantAfterToolResult", label: "工具结果后需补 assistant", kind: "bool" },
      { key: "requiresThinkingAsText", label: "思考按文本下发", kind: "bool" },
      {
        key: "requiresReasoningContentOnAssistantMessages",
        label: "assistant 消息需带 reasoning_content",
        kind: "bool",
      },
      {
        key: "thinkingFormat",
        label: "思考字段格式",
        kind: "select",
        options: COMPAT_THINKING_FORMATS,
      },
      { key: "cacheControlFormat", label: "cache_control 格式", kind: "select", options: ["anthropic"] },
      { key: "supportsOpenAIGrammarTools", label: "支持 grammar 工具", kind: "bool" },
      { key: "supportsStrictMode", label: "支持 strict 模式", kind: "bool" },
      { key: "sendSessionAffinityHeaders", label: "发送会话粘性头", kind: "bool" },
      {
        key: "sessionAffinityFormat",
        label: "会话粘性格式",
        kind: "select",
        options: COMPAT_SESSION_AFFINITY,
      },
      { key: "supportsLongCacheRetention", label: "支持长效缓存", kind: "bool" },
      { key: "vllmPriority", label: "vLLM 路由优先级", kind: "number" },
    ],
  },
  {
    id: "responses",
    label: "OpenAI responses",
    hint: "openai-responses 使用这一组。",
    fields: [
      { key: "supportsDeveloperRole", label: "支持 developer 角色", kind: "bool" },
      {
        key: "sessionAffinityFormat",
        label: "会话粘性格式",
        kind: "select",
        options: COMPAT_SESSION_AFFINITY,
      },
      { key: "supportsLongCacheRetention", label: "支持长效缓存", kind: "bool" },
      { key: "supportsStrictMode", label: "支持 strict 模式", kind: "bool" },
      { key: "supportsOpenAIGrammarTools", label: "支持 grammar 工具", kind: "bool" },
      { key: "supportsMaxOutputTokens", label: "支持 max_output_tokens", kind: "bool" },
    ],
  },
  {
    id: "anthropic",
    label: "Anthropic messages",
    hint: "anthropic-messages 使用这一组。",
    fields: [
      { key: "supportsEagerToolInputStreaming", label: "工具入参提前流式", kind: "bool" },
      { key: "supportsLongCacheRetention", label: "支持长效缓存", kind: "bool" },
      { key: "sendSessionAffinityHeaders", label: "发送会话粘性头", kind: "bool" },
      { key: "supportsCacheControlOnTools", label: "工具上也支持 cache_control", kind: "bool" },
      { key: "supportsTemperature", label: "支持 temperature", kind: "bool" },
      { key: "forceAdaptiveThinking", label: "强制自适应思考", kind: "bool" },
      { key: "allowEmptySignature", label: "允许空签名", kind: "bool" },
      { key: "supportsStrictTools", label: "支持 strict 工具", kind: "bool" },
      { key: "supportsMidConvoEffort", label: "对话中途可改 effort", kind: "bool" },
    ],
  },
];

/** Object-valued compat keys, kept for the raw JSON box. */
export const COMPAT_JSON_KEYS = [
  "chatTemplateKwargs",
  "chatTemplateArgs",
  "openRouterRouting",
  "vercelGatewayRouting",
  "allowedFallbackModels",
];

// ----------------------------------------------------------------- settings

export interface SettingsDocument {
  defaultProvider?: string;
  defaultModel?: string;
  defaultThinkingLevel?: string;
  enabledModels?: string[];
  shellPath?: string;
  theme?: string;
  httpProxy?: string;
  defaultTools?: string[];
  hideThinkingBlock?: boolean;
  showCacheMissNotices?: boolean;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------- mcp

export type McpExposure = "codemode" | "deferred" | "direct" | "hidden";

export const MCP_EXPOSURES: McpExposure[] = [
  "codemode",
  "deferred",
  "direct",
  "hidden",
];

export interface McpServerConfig {
  type?: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  exposure?: McpExposure;
  description?: string;
  enabled?: boolean;
  timeout?: number;
  [key: string]: unknown;
}

export interface McpDocument {
  mcpServers: Record<string, McpServerConfig>;
  autoEnableCodemode?: boolean;
  [key: string]: unknown;
}

/** A server uses stdio when it has a command, HTTP when it has a url. */
export function mcpTransport(config: McpServerConfig): "stdio" | "http" {
  if (config.type === "http" || (!config.command && config.url)) return "http";
  return "stdio";
}

// -------------------------------------------------------------------- skills

export interface SkillEntry {
  id: string;
  name: string;
  description: string;
  source: "agent" | "agents";
  path: string;
  writable: boolean;
  disableModelInvocation: boolean;
  /**
   * Shipped by APIX itself — part of the app rather than the user's own skill.
   *
   * Built-ins live in the same skills directory as everything else, so this is
   * decided by the marker in their SKILL.md. They cannot be deleted (the host
   * refuses too, not just the button) and they are labelled 内置 in Settings.
   */
  builtin: boolean;
}

/** Stable identity for a skill: it can live under either skills root. */
export function skillKey(skill: Pick<SkillEntry, "source" | "id">): string {
  return `${skill.source}/${skill.id}`;
}

// -------------------------------------------------------------------- state

/**
 * Per-conversation skill switches.
 *
 * A key that is present is an explicit decision — `true` on, `false` off. A key
 * that is absent has no opinion and falls back to the default, which is "on" for
 * a global skill and "off" for everything else. That is what makes a skill added
 * to this conversation start switched off while a global one starts switched on,
 * without the composer having to write a row for every skill in the library.
 *
 * This map is also what makes the feature conversation-scoped: it lives on the
 * chat, so two conversations of the same workspace can disagree.
 */
export type ChatSkillState = Record<string, boolean>;

/** One conversation, mapped onto a pi session file. */
export interface ChatEntry {
  id: string;
  name: string;
  /** pi's session path, filled in once the session exists. */
  sessionFile: string | null;
  createdAt: number;
  /**
   * When the chat was archived (ms epoch), or `null` while it is live.
   *
   * Archiving is APIX's own bookkeeping, not a pi concept: the session file
   * stays exactly where it is and stays resumable, the chat just leaves the
   * rail and appears under Settings → 已归档会话 instead of being deleted.
   */
  archivedAt: number | null;
  /** Which skills this conversation may trigger. See {@link ChatSkillState}. */
  skills: ChatSkillState;
}

/** An archived chat plus the workspace it belongs to, for the settings list. */
export interface ArchivedChat {
  workspacePath: string;
  workspaceName: string;
  chat: ChatEntry;
}

/** A workspace is just a directory: pi's cwd. */
export interface WorkspaceEntry {
  path: string;
  name: string;
  chats: ChatEntry[];
  activeChat: string | null;
}

export interface AppStateDocument {
  workspaces: WorkspaceEntry[];
  /** UI preferences: theme, motion. */
  ui?: UiPreferences;
  lastWorkdir?: string | null;
  /**
   * Set by the host when `state.json` was unparseable: the path the damaged file
   * was moved to. The index restarts empty; nothing was deleted.
   */
  recoveredFrom?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------- pi session files

/** One `.jsonl` session file pi wrote for a workspace. */
export interface SessionFileInfo {
  path: string;
  fileName: string;
  /** File mtime, ms since the epoch. */
  modifiedMs: number;
  size: number;
}

/** What the host can say about a workspace's session files. */
export interface SessionListing {
  dir: string;
  files: SessionFileInfo[];
  /**
   * Whether the recorded session path is a real file.
   *
   * pi will "successfully" open a path that does not exist — `switch_session`
   * returns no error and zero messages — so this flag is the only way to tell
   * a real resume from a resume into nothing.
   */
  recordedExists: boolean;
}

// ------------------------------------------------------------------- ui prefs

export type ThemePreference = "system" | "light" | "dark";

export interface UiPreferences {
  theme: ThemePreference;
  reduceMotion: boolean;
  /** Multiplier applied to every font-size and line-height in the UI. */
  fontScale: number;
  /**
   * The skills every conversation starts with, switched on, by {@link skillKey}.
   *
   * Configured in Settings → Skills ("全局 skills"). A skill listed here is
   * offered to the model in *every* conversation without being added by hand —
   * which is the point for the ones worth their tokens. It still gets a switch
   * in the composer, so one conversation can turn it off without changing the
   * default.
   *
   * Named `globalSkills` rather than the old `favouriteSkills`: the product
   * concept is "每个对话默认开启", and `normalizeUi` migrates the old key once.
   */
  globalSkills: string[];
  /**
   * Providers to keep in the model picker even though `models.json` does not
   * declare them.
   *
   * The picker is deliberately narrowed to what `models.json` declares, so a
   * built-in provider the user never configured cannot leak in and add noise.
   * That rule also hides providers that arrive some other way — a pi extension
   * registering its own, or a plain `/login`. This list is the escape hatch.
   */
  visibleProviders: string[];
}

export const DEFAULT_UI: UiPreferences = {
  theme: "system",
  reduceMotion: false,
  fontScale: 1,
  globalSkills: [],
  visibleProviders: [],
};

/** Steps offered by the appearance settings, smallest first. */
export const FONT_SCALES = [
  { value: 0.9, label: "小" },
  { value: 1, label: "标准" },
  { value: 1.12, label: "大" },
  { value: 1.25, label: "特大" },
] as const;

const MIN_SCALE = 0.8;
const MAX_SCALE = 1.6;

export function normalizeUi(raw: unknown): UiPreferences {
  const value = (raw ?? {}) as Partial<UiPreferences> & { favouriteSkills?: unknown };
  const scale = typeof value.fontScale === "number" ? value.fontScale : DEFAULT_UI.fontScale;
  // `favouriteSkills` is what this key was called before the concept got its real
  // name. Reading it keeps a settings file written by an older APIX working —
  // the alternative is silently dropping the user's global list on upgrade,
  // which looks exactly like "my settings were reset".
  const globalSkills =
    value.globalSkills !== undefined ? value.globalSkills : value.favouriteSkills;
  return {
    theme:
      value.theme === "light" || value.theme === "dark" || value.theme === "system"
        ? value.theme
        : DEFAULT_UI.theme,
    reduceMotion: value.reduceMotion === true,
    fontScale: Number.isFinite(scale)
      ? Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
      : DEFAULT_UI.fontScale,
    globalSkills: uniqueStrings(globalSkills),
    visibleProviders: uniqueStrings(value.visibleProviders),
  };
}

/** Non-empty, trimmed, de-duplicated strings from a value that may be anything. */
function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter((item): item is string => typeof item === "string" && item.trim() !== ""),
    ),
  ];
}

/** Last path segment, for a readable default workspace / chat label. */
export function baseName(path: string): string {
  const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

// ------------------------------------------------------------------ commands

export const configApi = {
  paths: () => invoke<ConfigPaths>("config_paths"),

  readRaw: (which: ConfigFile) => invoke<string>("config_read_raw", { which }),
  writeRaw: (which: ConfigFile, content: string) =>
    invoke<unknown>("config_write_raw", { which, content }),

  modelsRead: () => invoke<ModelsDocument>("models_read"),
  modelsWrite: (document: ModelsDocument) =>
    invoke<void>("models_write", { document }),
  modelsSummary: () => invoke<Record<string, string[]>>("models_summary"),

  settingsRead: () => invoke<SettingsDocument>("settings_read"),
  settingsPatch: (patch: Record<string, unknown>) =>
    invoke<SettingsDocument>("settings_patch", { patch }),

  mcpRead: () => invoke<McpDocument>("mcp_read"),
  mcpWrite: (document: McpDocument) => invoke<void>("mcp_write", { document }),

  skillsList: () => invoke<SkillEntry[]>("skills_list"),
  skillRead: (source: string, id: string) =>
    invoke<string>("skill_read", { source, id }),
  skillWrite: (source: string, id: string, content: string) =>
    invoke<void>("skill_write", { source, id, content }),
  skillCreate: (id: string, name: string, description: string) =>
    invoke<SkillEntry>("skill_create", { id, name, description }),
  skillDelete: (id: string) => invoke<string>("skill_delete", { id }),
  /** Materialises APIX's built-in skill and returns its absolute path. */
  skillBuiltinPath: (id: string) => invoke<string>("skill_builtin_path", { id }),

  probeModels: (baseUrl: string, apiKey: string) =>
    invoke<string[]>("config_probe_models", { baseUrl, apiKey }),

  /** Last workspace pi was started in, when it still exists. */
  lastWorkdir: () => invoke<string | null>("state_last_workdir"),

  /** APIX's own state: the workspace and chat index. */
  stateRead: () => invoke<AppStateDocument>("state_read"),
  writeWorkspaces: (workspaces: WorkspaceEntry[]) =>
    invoke<AppStateDocument>("state_write_workspaces", { workspaces }),
  writeUi: (ui: UiPreferences) => invoke<AppStateDocument>("state_write_ui", { ui }),

  /**
   * pi's session files for a workspace, plus whether `recorded` still exists.
   * Read-only; the recovery decision is made in `lib/sessionRecovery.ts`.
   */
  sessionsList: (cwd: string, recorded?: string | null) =>
    invoke<SessionListing>("sessions_list", { cwd, recorded: recorded ?? null }),

  openPath: (path: string) => invoke<void>("open_path", { path }),
};

// ------------------------------------------------------------------ helpers

export const SKILL_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** Provider keys end up as JSON object keys and in `/model` breadcrumbs. */
export const PROVIDER_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/i;

/**
 * A model entry with the fields people actually set. Everything else in pi's
 * schema is left absent so it inherits from the provider or the catalog.
 */
export function emptyModel(id: string): ProviderModel {
  return {
    id,
    name: id,
    contextWindow: 128000,
    maxTokens: 16384,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

export function emptyProvider(): ProviderConfig {
  return {
    baseUrl: "",
    api: "openai-completions",
    apiKey: "",
    models: [],
  };
}

/** True for a value that would round-trip as a blank field. */
export function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

/**
 * Drops keys whose value is blank, recursing into plain objects and arrays.
 *
 * `models.json` is read by a strict schema, and an empty string is not the same
 * as an absent key: `""` fails validation where omission falls back to the
 * catalog. `false` and `0` are kept — they are real choices.
 */
export function pruneBlank<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => pruneBlank(item)).filter((item) => !isRecordEmpty(item)) as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const cleaned = pruneBlank(item);
      if (isBlank(cleaned) || isRecordEmpty(cleaned)) continue;
      out[key] = cleaned;
    }
    return out as T;
  }
  return value;
}

function isRecordEmpty(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value as Record<string, unknown>).length === 0;
}

/** Reads the `provider/model` pair shown in the composer, for the default row. */
export function providerModelRef(provider: string, model: string): string {
  return `${provider}/${model}`;
}
