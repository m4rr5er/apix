/**
 * Pi RPC protocol types.
 *
 * Mirrors `packages/coding-agent/src/modes/rpc/rpc-types.ts` and
 * `docs/json.md` from earendil-works/pi. Records arrive as JSONL on stdout;
 * the Rust host parses them and forwards each one as the `pi://record` event.
 *
 * We keep `PiRecord` deliberately loose (a string `type` plus unknown fields)
 * so an unfamiliar record from a newer pi can never crash the UI. Named
 * interfaces exist for the shapes we actually read.
 */

export interface Usage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  cost?: { total?: number };
}

export interface ToolResult {
  content?: Array<{ type?: string; text?: string }>;
  details?: unknown;
}

export interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  toolName?: string;
  arguments?: unknown;
}

export interface PiMessage {
  role: "user" | "assistant" | "system" | string;
  content: string | ContentBlock[];
  timestamp?: number;
  stopReason?: string;
}

export interface ToolCall {
  id?: string;
  name?: string;
  toolName?: string;
  arguments?: unknown;
  args?: unknown;
}

export type AssistantMessageEvent =
  | { type: "start" }
  | { type: "text_start"; contentIndex?: number }
  | { type: "text_delta"; contentIndex?: number; delta: string }
  | { type: "text_end"; contentIndex?: number; content: string }
  | { type: "thinking_start"; contentIndex?: number }
  | { type: "thinking_delta"; contentIndex?: number; delta: string }
  | { type: "thinking_end"; contentIndex?: number; content: string }
  | { type: "toolcall_start"; contentIndex?: number; id: string; toolName: string }
  | { type: "toolcall_delta"; contentIndex?: number; delta: string }
  | { type: "toolcall_end"; contentIndex?: number; toolCall: ToolCall }
  | { type: "done"; reason?: string }
  | { type: "error"; reason?: string; error?: unknown };

export interface PiResponse {
  id?: string;
  type: "response";
  command: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface PiModel {
  id?: string;
  name?: string;
  provider?: string;
}

/** A model the picker may offer, already narrowed to the user's configuration. */
export interface ModelOption {
  provider: string;
  id: string;
  name?: string;
}

export function modelKey(model: ModelOption): string {
  return `${model.provider}/${model.id}`;
}

/**
 * Narrow pi's model list to what `models.json` declares.
 *
 * pi also reports models for providers the user never configured — a built-in
 * `deepseek` sitting next to their own gateway — and those only add noise to
 * the picker. Once `models.json` declares anything it is the whole answer.
 *
 * Two escape hatches keep that from being a cage:
 * - `extraProviders` names providers to pass through in full, for models that
 *   arrive some other way (a pi extension registering its own provider, or a
 *   plain `/login`). The user opts in per provider from Settings.
 * - With nothing declared at all we fall back to whatever pi reports, so a
 *   plain `/login` setup still works out of the box.
 */
export function filterModels(
  models: Array<{ provider?: string; id?: string; name?: string }>,
  configured: Record<string, string[]>,
  extraProviders: readonly string[] = [],
): ModelOption[] {
  const restrict = Object.keys(configured).length > 0;
  const allowed = new Set(extraProviders);
  const seen = new Set<string>();
  const out: ModelOption[] = [];

  for (const entry of models) {
    if (!entry.provider || !entry.id) continue;
    if (restrict && !allowed.has(entry.provider)) {
      const declared = configured[entry.provider];
      if (!declared) continue;
      // An empty list means the entry only overrides endpoint settings.
      if (declared.length > 0 && !declared.includes(entry.id)) continue;
    }
    const key = `${entry.provider}/${entry.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ provider: entry.provider, id: entry.id, name: entry.name });
  }

  return out;
}

/** Provider names present in a raw pi model list, in first-seen order. */
export function providerNames(
  models: Array<{ provider?: string }>,
): string[] {
  const out: string[] = [];
  for (const entry of models) {
    if (entry.provider && !out.includes(entry.provider)) out.push(entry.provider);
  }
  return out;
}

export interface RpcSessionState {
  model?: PiModel;
  thinkingLevel?: string;
  isStreaming?: boolean;
  isCompacting?: boolean;
  sessionFile?: string;
  sessionId?: string;
  sessionName?: string;
  messageCount?: number;
  pendingMessageCount?: number;
}

/**
 * One user prompt as pi records it in the session tree.
 *
 * pi's `get_fork_messages` returns these so a client can rewind: passing
 * `entryId` to `fork` drops that prompt and everything after it, and hands the
 * text back so it can be edited and sent again.
 */
export interface ForkMessage {
  entryId: string;
  text: string;
}

/** `get_session_stats` response — session-level totals and context pressure. */
export interface SessionStats {  sessionFile?: string;
  sessionId?: string;
  userMessages?: number;
  assistantMessages?: number;
  toolCalls?: number;
  toolResults?: number;
  totalMessages?: number;
  tokens?: Usage;
  cost?: number;
  contextUsage?: ContextUsage;
}

export interface ContextUsage {
  /** Estimated context tokens, or null when unknown. */
  tokens: number | null;
  contextWindow: number;
  /** Share of the window in use, 0–100, or null when `tokens` is unknown. */
  percent: number | null;
}

/**
 * Share of prompt tokens served from the provider's prompt cache.
 *
 * `input` counts tokens billed as fresh input and `cacheRead` counts tokens
 * replayed from cache, so together they are the whole prompt.
 */
export function cacheHitRate(tokens: Usage | undefined | null): number | null {
  const fresh = tokens?.input ?? 0;
  const cached = tokens?.cacheRead ?? 0;
  const total = fresh + cached;
  return total > 0 ? cached / total : null;
}

/** Compact token counts: `167K`, `1M`, `12.4K`. */
export function formatTokens(value: number | undefined | null): string {
  if (!value || value <= 0) return "0";
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${Number((value / 1000).toFixed(1))}K`;
  return `${Number((value / 1_000_000).toFixed(2))}M`;
}

/**
 * Shorthand for a token budget: exact multiples print as `1M` / `256K`, and
 * anything with a remainder keeps the full digit string rather than rounding
 * a limit the user typed by hand.
 */
export function tokenShorthand(value: number | undefined | null): string {
  if (value === undefined || value === null) return "";
  if (value === 0) return "0";
  if (value % 1_000_000 === 0) return `${value / 1_000_000}M`;
  if (value % 1000 === 0) return `${value / 1000}K`;
  return String(value);
}

/**
 * Reads a token budget written either in full or with a K/M suffix.
 *
 * LLM limits are decimal — 1M is 1000000, not 1048576 — so this deliberately
 * does not use the binary interpretation the rest of computing uses for bytes.
 * Returns `undefined` for anything that is not a number, so a half-typed field
 * clears the value instead of writing a guess.
 */
export function parseTokenShorthand(text: string): number | undefined {
  const raw = text.trim().replace(/[\s,_]/g, "").toLowerCase();
  if (!raw) return undefined;
  const match = /^(\d+(?:\.\d+)?)(k|m)?$/.exec(raw);
  if (!match) return undefined;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return undefined;
  const scale = match[2] === "m" ? 1_000_000 : match[2] === "k" ? 1000 : 1;
  const total = Math.round(base * scale);
  return total > 0 ? total : undefined;
}

export interface ExtensionUiRequest {
  type: "extension_ui_request";
  id: string;
  method: string;
  title?: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  notifyType?: "info" | "warning" | "error";
  statusKey?: string;
  statusText?: string;
  prefill?: string;
  text?: string;
}

/** Any record emitted by pi on stdout. */
export type PiRecord = { type: string } & Record<string, unknown>;

// ---------------------------------------------------------------------------
// Small readers
// ---------------------------------------------------------------------------

export function messageText(message: PiMessage | undefined | null): string {
  if (!message) return "";
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("");
}

export function messageThinking(message: PiMessage | undefined | null): string {
  if (!message) return "";
  const content = message.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "thinking" && typeof block.thinking === "string")
    .map((block) => block.thinking as string)
    .join("");
}

export function resultText(result: ToolResult | undefined | null): string {
  if (!result) return "";
  const content = result.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => typeof block?.text === "string")
    .map((block) => block.text as string)
    .join("");
}

export function modelLabel(model: PiModel | undefined | null): string | null {
  if (!model) return null;
  const name = model.id ?? model.name;
  if (!name) return null;
  return model.provider ? `${model.provider}/${name}` : name;
}
