/**
 * Thin typed wrapper over the Tauri commands and events exposed by the Rust
 * host. The frontend never touches the pi process directly — it only invokes
 * commands and listens for events.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { PiRecord } from "./protocol";

export interface PiLocation {
  node: string;
  entry: string;
}

export interface EngineStatus {
  /** `starting` is an optimistic UI state; `running` is emitted by the host. */
  state: "starting" | "running" | "exited" | "stopped";
  /** Which conversation slot this status belongs to. */
  slot?: string;
  cwd?: string;
  code?: number | null;
  location?: PiLocation;
  /** Spawn counter — see {@link PiRecordEnvelope}. */
  gen?: number;
}

/**
 * What the host puts on `pi://record`: the parsed stdout line, stamped with
 * the slot of the conversation that owns the process and the generation of
 * the process itself. Events from a backgrounded or replaced engine keep
 * arriving while the UI looks at another chat, so both tags must be checked
 * before anything touches the live view — a stale `agent_start` would
 * otherwise pin `busy` on an idle engine forever, and a background chat's
 * streaming text would bleed into the chat on screen.
 */
export interface PiRecordEnvelope {
  slot: string;
  gen: number;
  record: PiRecord;
}

export interface PiLogLine {
  stream: "stdout" | "stderr";
  line?: string;
  error?: string;
}

export interface PiRuntimeStatus {
  running: boolean;
  cwd?: string | null;
  location?: PiLocation | null;
}

export const pi = {
  /**
   * Start the engine for one conversation slot.
   *
   * `skills` is the conversation's skill allowlist as SKILL.md paths. Passing it
   * switches pi to "only these skills exist" (`--no-skills` + `--skill`), which
   * is what makes a switched-off skill untriggerable; an empty array is a real
   * instruction — nothing enabled. `null` leaves pi's own discovery alone.
   */
  start: (slot: string, cwd?: string | null, skills?: string[] | null, session?: string | null) =>
    invoke<PiLocation>("pi_start", {
      slot,
      cwd: cwd ?? null,
      skills: skills ?? null,
      session: session ?? null,
    }),

  stop: (slot: string) => invoke<void>("pi_stop", { slot }),

  /** Escape hatch for any RPC command record, addressed to one slot. */
  send: (slot: string, command: Record<string, unknown>) =>
    invoke<void>("pi_send", { slot, command }),

  prompt: (slot: string, message: string, streamingBehavior?: "steer" | "followUp") =>
    invoke<void>("pi_prompt", {
      slot,
      message,
      streamingBehavior: streamingBehavior ?? null,
    }),

  abort: (slot: string) => invoke<void>("pi_abort", { slot }),

  status: (slot: string) => invoke<PiRuntimeStatus>("pi_status", { slot }),

  defaultCwd: () => invoke<string>("pi_default_cwd"),

  /**
   * Polish a prompt draft with the session's own model and return the rewrite.
   *
   * Runs as a separate throwaway `pi --print --no-session` process, so it never
   * touches the live conversation's session file. Rejects with the provider's
   * own message on failure.
   */
  promptEnhance: (text: string, model: string | null, cwd: string | null) =>
    invoke<string>("prompt_enhance", { text, model, cwd }),
};

export function onRecord(
  handler: (record: PiRecord, gen: number, slot: string) => void,
): Promise<UnlistenFn> {
  return listen<PiRecordEnvelope>("pi://record", (event) =>
    handler(event.payload.record, event.payload.gen, event.payload.slot),
  );
}

export function onStatus(
  handler: (status: EngineStatus) => void,
): Promise<UnlistenFn> {
  return listen<EngineStatus>("pi://status", (event) => handler(event.payload));
}

export function onLog(handler: (line: PiLogLine) => void): Promise<UnlistenFn> {
  return listen<PiLogLine>("pi://log", (event) => handler(event.payload));
}

/**
 * Push the resolved page background to the native window, so a resize never
 * reveals WebView2's white default behind the app.
 */
export function setWindowBackground(color: string): void {
  void invoke("window_set_background", { color }).catch(() => {
    /* cosmetic only; nothing to surface */
  });
}

/**
 * Rejection message used when a pending command is dropped because the engine
 * was restarted. Rapidly clicking between workspaces cancels in-flight session
 * commands by design, so callers check for this instead of reporting an error.
 */
export const ENGINE_RESTARTED = "引擎已重启，命令已取消";

/**
 * Rejection message used when a pending command is dropped because the user
 * left its conversation while it was in flight. The engine itself keeps
 * running in the background — only the UI's wait is over, so callers treat it
 * like {@link ENGINE_RESTARTED}: quietly, without an error notice.
 */
export const SLOT_DETACHED = "已切走，该会话转入后台";

export function isRestartCancellation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes(ENGINE_RESTARTED) || error.message.includes(SLOT_DETACHED);
}
