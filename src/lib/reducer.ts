/**
 * Transcript state machine.
 *
 * pi's stdout stream is delta-only. `message_update` carries fragments and
 * `message_end.message` carries the authoritative final value, so every
 * streaming field is replaced on completion (`text_end`, `thinking_end`,
 * `message_end`) rather than trusted from the accumulated deltas.
 */

import {
  messageText,
  messageThinking,
  modelLabel,
  type AssistantMessageEvent,
  type PiMessage,
  type PiModel,
  type PiRecord,
  type PiResponse,
  type RpcSessionState,
  type ToolResult,
  type Usage,
} from "./protocol";

export interface UserItem {
  kind: "user";
  key: string;
  text: string;
}

export interface AssistantItem {
  kind: "assistant";
  key: string;
  text: string;
  thinking: string;
  streaming: boolean;
}

export interface ToolItem {
  kind: "tool";
  key: string;
  callId: string;
  name: string;
  args?: unknown;
  result?: ToolResult;
  isError?: boolean;
  durationMs?: number;
  status: "running" | "done" | "error";
}

export interface NoticeItem {
  kind: "notice";
  key: string;
  level: "info" | "warn" | "error";
  text: string;
}

export type Item = UserItem | AssistantItem | ToolItem | NoticeItem;

/**
 * Whether the session has anything to show beyond status messages.
 *
 * `items` also carries notices ("model switched", "extension request declined",
 * …). Those are diagnostics, not conversation, so a chat that has only ever
 * produced a notice must still render as a *new* chat — otherwise the empty
 * state, its backdrop and its "give pi a task" copy are all replaced by a
 * single grey line.
 */
export function hasConversation(items: Item[]): boolean {
  return items.some((item) => item.kind !== "notice");
}

export interface State {
  items: Item[];
  busy: boolean;
  sessionName: string | null;
  sessionId: string | null;
  /** pi's session file path; the key APIX stores per chat. */
  sessionFile: string | null;
  model: string | null;
  thinkingLevel: string | null;
  usage: Usage | null;
  queued: { steering: string[]; followUp: string[] };
}

export const initialState: State = {
  items: [],
  busy: false,
  sessionName: null,
  sessionId: null,
  sessionFile: null,
  model: null,
  thinkingLevel: null,
  usage: null,
  queued: { steering: [], followUp: [] },
};

export type Action =
  /**
   * Back to the new-session view: the transcript goes, the engine's facts stay.
   *
   * There used to be a `reset` that returned `initialState`, and both "clear the
   * pane" and "start a new session" used it. That also wiped `model`, because
   * `initialState` has no model — but the model is pi's, not the transcript's, and
   * nothing re-reads it afterwards. Opening a chat into an empty workspace went
   * through that path, and the composer's model turned into "—" while pi was
   * still holding the default. `reset` is gone rather than deprecated: the only
   * thing it could do was lose facts the UI still needed.
   */
  | { kind: "clearTranscript" }
  | { kind: "loadItems"; items: Item[] }
  | { kind: "engineReset" }
  | { kind: "record"; record: PiRecord }
  | { kind: "notice"; level: NoticeItem["level"]; text: string }
  | { kind: "sessionName"; name: string | null };

let keySeq = 0;
function nextKey(): string {
  keySeq += 1;
  return `k${keySeq}`;
}

function push(state: State, item: Item): State {
  return { ...state, items: [...state.items, item] };
}

function patchLast(
  items: Item[],
  predicate: (item: Item) => boolean,
  patch: (item: Item) => Item,
): Item[] {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (predicate(item)) {
      const copy = [...items];
      copy[index] = patch(item);
      return copy;
    }
  }
  return items;
}

function patchTool(
  items: Item[],
  callId: string,
  patch: (item: ToolItem) => ToolItem,
): Item[] {
  return patchLast(
    items,
    (item) => item.kind === "tool" && item.callId === callId,
    (item) => patch(item as ToolItem),
  );
}

function emptyAssistant(): AssistantItem {
  return { kind: "assistant", key: nextKey(), text: "", thinking: "", streaming: true };
}

/** Rebuild the transcript from pi's own message history. */
function itemsFromMessages(messages: PiMessage[]): Item[] {
  const items: Item[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      const text = messageText(message);
      if (text) items.push({ kind: "user", key: nextKey(), text });
    } else if (message.role === "assistant") {
      const text = messageText(message);
      const thinking = messageThinking(message);
      if (text || thinking) {
        items.push({ kind: "assistant", key: nextKey(), text, thinking, streaming: false });
      }
    }
  }
  return items;
}

function handleResponse(state: State, response: PiResponse): State {
  if (!response.success) {
    return push(state, {
      kind: "notice",
      key: nextKey(),
      level: "error",
      text: `${response.command} 失败：${response.error ?? "未知错误"}`,
    });
  }

  switch (response.command) {
    case "get_state": {
      const data = (response.data ?? {}) as RpcSessionState;
      return {
        ...state,
        model: modelLabel(data.model) ?? state.model,
        sessionName: data.sessionName ?? state.sessionName,
        sessionId: data.sessionId ?? state.sessionId,
        sessionFile: data.sessionFile ?? state.sessionFile,
        thinkingLevel: data.thinkingLevel ?? state.thinkingLevel,
        busy: Boolean(data.isStreaming),
      };
    }
    case "get_messages": {
      const data = (response.data ?? {}) as { messages?: PiMessage[] };
      if (Array.isArray(data.messages)) {
        return { ...state, items: itemsFromMessages(data.messages) };
      }
      return state;
    }
    case "set_model":
    case "cycle_model": {
      // `set_model` responds with the Model itself; `cycle_model` wraps it.
      const data = response.data;
      if (!data || typeof data !== "object") return state;
      const model = "model" in data ? (data as { model?: PiModel }).model : (data as PiModel);
      return { ...state, model: modelLabel(model) ?? state.model };
    }
    default:
      return state;
  }
}

function handleAssistantChunk(
  state: State,
  event: AssistantMessageEvent,
): State {
  let items = state.items;
  const hasAssistant = items.some((item) => item.kind === "assistant" && item.streaming);
  if (!hasAssistant) {
    items = [...items, emptyAssistant()];
  }

  switch (event.type) {
    case "text_delta":
      items = patchLast(
        items,
        (item) => item.kind === "assistant",
        (item) => ({ ...(item as AssistantItem), text: (item as AssistantItem).text + event.delta }),
      );
      break;
    case "text_end":
      items = patchLast(
        items,
        (item) => item.kind === "assistant",
        (item) => ({ ...(item as AssistantItem), text: event.content }),
      );
      break;
    case "thinking_delta":
      items = patchLast(
        items,
        (item) => item.kind === "assistant",
        (item) => ({
          ...(item as AssistantItem),
          thinking: (item as AssistantItem).thinking + event.delta,
        }),
      );
      break;
    case "thinking_end":
      items = patchLast(
        items,
        (item) => item.kind === "assistant",
        (item) => ({ ...(item as AssistantItem), thinking: event.content }),
      );
      break;
    case "error":
      items = patchLast(
        items,
        (item) => item.kind === "assistant",
        (item) => ({ ...(item as AssistantItem), streaming: false }),
      );
      items = [
        ...items,
        {
          kind: "notice",
          key: nextKey(),
          level: "error",
          text: `模型流中断：${event.reason ?? "unknown"}`,
        },
      ];
      break;
    default:
      break;
  }

  return { ...state, items };
}

function handleRecord(state: State, record: PiRecord): State {
  switch (record.type) {
    case "response":
      return handleResponse(state, record as unknown as PiResponse);

    case "agent_start":
      return { ...state, busy: true };

    case "agent_end": {
      const willRetry = Boolean(record.willRetry);
      if (!willRetry) return state;
      return push(state, {
        kind: "notice",
        key: nextKey(),
        level: "warn",
        text: "本轮流结束，pi 将自动重试。",
      });
    }

    case "agent_settled":
      // pi will not continue automatically: nothing is queued, retrying or
      // compacting. This is the only safe "idle" signal.
      return {
        ...state,
        busy: false,
        queued: { steering: [], followUp: [] },
        items: state.items.map((item) =>
          item.kind === "assistant" && item.streaming
            ? { ...item, streaming: false }
            : item,
        ),
      };

    case "message_start": {
      const message = record.message as PiMessage | undefined;
      if (!message) return state;
      if (message.role === "user") {
        const text = messageText(message);
        return text ? push(state, { kind: "user", key: nextKey(), text }) : state;
      }
      if (message.role === "assistant") {
        return push(state, emptyAssistant());
      }
      return state;
    }

    case "message_update": {
      const event = record.assistantMessageEvent as AssistantMessageEvent | undefined;
      const usage = record.usage as Usage | undefined;
      const withUsage = usage ? { ...state, usage } : state;
      return event ? handleAssistantChunk(withUsage, event) : withUsage;
    }

    case "message_end": {
      const message = record.message as PiMessage | undefined;
      if (!message) return state;
      if (message.role !== "assistant") return state;

      const text = messageText(message);
      const thinking = messageThinking(message);
      return {
        ...state,
        items: patchLast(
          state.items,
          (item) => item.kind === "assistant",
          (item) => {
            const current = item as AssistantItem;
            return {
              ...current,
              text: text || current.text,
              thinking: thinking || current.thinking,
              streaming: false,
            };
          },
        ),
      };
    }

    case "tool_execution_start":
      return push(state, {
        kind: "tool",
        key: nextKey(),
        callId: String(record.toolCallId ?? ""),
        name: String(record.toolName ?? "tool"),
        args: record.args,
        status: "running",
      });

    case "tool_execution_update":
      return {
        ...state,
        items: patchTool(state.items, String(record.toolCallId ?? ""), (item) => ({
          ...item,
          result: (record.partialResult as ToolResult | undefined) ?? item.result,
        })),
      };

    case "tool_execution_end":
      return {
        ...state,
        items: patchTool(state.items, String(record.toolCallId ?? ""), (item) => ({
          ...item,
          result: (record.result as ToolResult | undefined) ?? item.result,
          isError: Boolean(record.isError),
          durationMs:
            typeof record.durationMs === "number" ? record.durationMs : undefined,
          status: record.isError ? "error" : "done",
        })),
      };

    case "session_info_changed":
      return { ...state, sessionName: (record.name as string) ?? null };

    case "thinking_level_changed":
      return { ...state, thinkingLevel: (record.level as string) ?? null };

    case "queue_update":
      return {
        ...state,
        queued: {
          steering: (record.steering as string[]) ?? [],
          followUp: (record.followUp as string[]) ?? [],
        },
      };

    case "compaction_start":
      return push(state, {
        kind: "notice",
        key: nextKey(),
        level: "info",
        text: `上下文压缩中（${String(record.reason ?? "threshold")}）…`,
      });

    case "compaction_end": {
      if (record.errorMessage) {
        return push(state, {
          kind: "notice",
          key: nextKey(),
          level: "error",
          text: `压缩失败：${String(record.errorMessage)}`,
        });
      }
      if (record.aborted) {
        return push(state, {
          kind: "notice",
          key: nextKey(),
          level: "warn",
          text: "压缩已中止。",
        });
      }
      return push(state, {
        kind: "notice",
        key: nextKey(),
        level: "info",
        text: "上下文压缩完成。",
      });
    }

    case "auto_retry_start":
      return push(state, {
        kind: "notice",
        key: nextKey(),
        level: "warn",
        text: `重试 ${String(record.attempt ?? "?")}/${String(record.maxAttempts ?? "?")}：${String(record.errorMessage ?? "")}`,
      });

    case "auto_retry_end":
      return record.success
        ? state
        : push(state, {
            kind: "notice",
            key: nextKey(),
            level: "error",
            text: `重试最终失败：${String(record.finalError ?? "unknown")}`,
          });

    case "extension_error":
      return push(state, {
        kind: "notice",
        key: nextKey(),
        level: "error",
        text: `扩展异常（${String(record.event ?? "")}）：${String(record.error ?? "")}`,
      });

    default:
      return state;
  }
}

export function reduce(state: State, action: Action): State {
  switch (action.kind) {
    case "clearTranscript":
      // `usage` and `busy` are engine readings too (the last turn's token counts,
      // whether pi is mid-turn), and `setStats(null)` already drops the meter.
      return { ...state, items: [], queued: { steering: [], followUp: [] } };
    case "loadItems":
      // Render a conversation's cached transcript the instant the view switches
      // to it. The engine for that chat is still starting (or being re-joined),
      // and showing the new-session page for a chat full of history was the
      // whole complaint. Nothing else is touched: the engine's own readings
      // (model, session, busy) arrive a moment later and stay authoritative.
      // Streaming flags are dropped — a cached mid-turn row must not pulse
      // forever if that turn has since ended.
      return {
        ...state,
        items: action.items.map((item) =>
          item.kind === "assistant" && item.streaming ? { ...item, streaming: false } : item,
        ),
        queued: { steering: [], followUp: [] },
      };
    case "engineReset":
      // A fresh pi process cannot have a turn in flight. `busy` is otherwise
      // cleared only by `agent_settled`, which a killed process will never
      // send — so without this, a restart mid-turn sticks the spinner on
      // forever and 中断 has nothing to abort. Content stays: a restart is a
      // stutter to survive, not a reason to blank the pane.
      return {
        ...state,
        busy: false,
        queued: { steering: [], followUp: [] },
        items: state.items.map((item) =>
          item.kind === "assistant" && item.streaming
            ? { ...item, streaming: false }
            : item,
        ),
      };
    case "notice":
      return push(state, {
        kind: "notice",
        key: nextKey(),
        level: action.level,
        text: action.text,
      });
    case "sessionName":
      return { ...state, sessionName: action.name };
    case "record":
      return handleRecord(state, action.record);
    default:
      return state;
  }
}
