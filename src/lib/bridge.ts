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
  cwd?: string;
  code?: number | null;
  location?: PiLocation;
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
   * Start the engine.
   *
   * `skills` is the conversation's skill allowlist as SKILL.md paths. Passing it
   * switches pi to "only these skills exist" (`--no-skills` + `--skill`), which
   * is what makes a switched-off skill untriggerable; an empty array is a real
   * instruction — nothing enabled. `null` leaves pi's own discovery alone.
   */
  start: (cwd?: string | null, skills?: string[] | null, session?: string | null) =>
    invoke<PiLocation>("pi_start", {
      cwd: cwd ?? null,
      skills: skills ?? null,
      session: session ?? null,
    }),

  stop: () => invoke<void>("pi_stop"),

  /** Escape hatch for any RPC command record. */
  send: (command: Record<string, unknown>) =>
    invoke<void>("pi_send", { command }),

  prompt: (message: string, streamingBehavior?: "steer" | "followUp") =>
    invoke<void>("pi_prompt", {
      message,
      streamingBehavior: streamingBehavior ?? null,
    }),

  abort: () => invoke<void>("pi_abort"),

  status: () => invoke<PiRuntimeStatus>("pi_status"),

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
  handler: (record: PiRecord) => void,
): Promise<UnlistenFn> {
  return listen<PiRecord>("pi://record", (event) => handler(event.payload));
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

export function isRestartCancellation(error: unknown): boolean {
  return error instanceof Error && error.message.includes(ENGINE_RESTARTED);
}
