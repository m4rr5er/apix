/**
 * Two-phase context compaction.
 *
 * Clicking 压缩上下文 must NOT compact immediately — that would throw the
 * session away before anything was written down. The order that actually keeps
 * the work is:
 *
 *   1. ask pi to run the `apix-context-handoff` skill, which tidies the
 *      workspace, writes a handoff document and prints a ready-to-paste first
 *      prompt for the next session;
 *   2. only once that run finishes *and* the skill's completion sentinel is in
 *      the transcript, send the real `compact` command.
 *
 * The sentinel is what makes this safe: a run that errors, runs out of turns,
 * or simply forgets the marker leaves the session untouched and tells the user.
 *
 * Step 1 reads the skill's body and sends it, instead of sending pi the command
 * `/skill:apix-context-handoff`. That command only exists while the skill is
 * loaded, which made the built-in unconditional in every conversation; see
 * `skillInvocationText`.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { configApi } from "../lib/configBridge";
import { hasConversation, type Item } from "../lib/reducer";
import { skillInvocationText } from "../lib/skills";

export const HANDOFF_SKILL_ID = "apix-context-handoff";

/** Emitted by the skill as its last line; nothing else may trigger compaction. */
export const HANDOFF_SENTINEL = "[[APIX-HANDOFF-READY]]";

/** How long to wait for pi to even acknowledge the handoff prompt. */
const START_TIMEOUT_MS = 90_000;

export type HandoffPhase = "idle" | "running";

export function useHandoff({
  items,
  busy,
  engineRunning,
  send,
  compact,
  notify,
}: {
  items: Item[];
  busy: boolean;
  engineRunning: boolean;
  send: (text: string) => Promise<void>;
  compact: () => Promise<void>;
  notify: (level: "info" | "warn" | "error", text: string) => void;
}) {
  const [phase, setPhase] = useState<HandoffPhase>("idle");
  const hasStarted = useRef(false);
  /** Only records added after the handoff began count, so a sentinel left over
   *  from a previous handoff can never trigger an immediate compact. */
  const baseline = useRef(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const start = useCallback(async () => {
    if (!engineRunning || phase === "running") return;
    // Second gate. The toolbar already disables the button on a session that has
    // not been used, so this is not the user-facing check: it is here so no
    // future caller can start a handoff that would tidy an empty workspace and
    // write a handoff document with nothing in it.
    if (!hasConversation(itemsRef.current)) return;

    // Read the skill before touching any state: if the built-in cannot be read
    // there is no handoff to run, and reporting that is better than putting the
    // session into a phase that can only end in "交接没有开始".
    let prompt: string;
    try {
      const [manifestPath, raw] = await Promise.all([
        configApi.skillBuiltinPath(HANDOFF_SKILL_ID),
        configApi.skillRead("agent", HANDOFF_SKILL_ID),
      ]);
      prompt = skillInvocationText({ name: HANDOFF_SKILL_ID, manifestPath, raw });
    } catch (error) {
      notify("error", `读不到内置 skill「${HANDOFF_SKILL_ID}」，无法开始交接：${String(error)}`);
      return;
    }

    baseline.current = itemsRef.current.length;
    hasStarted.current = false;
    setPhase("running");
    notify("info", "开始上下文交接：整理文件 → 写交接文档 → 输出首轮提示词");
    await send(prompt);
  }, [engineRunning, notify, phase, send]);

  // Give up if pi never picks the prompt up.
  useEffect(() => {
    if (phase !== "running") return;
    const timer = window.setTimeout(() => {
      if (hasStarted.current) return;
      setPhase("idle");
      notify("warn", "交接没有开始（pi 在 90 秒内没有响应），已取消。");
    }, START_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [notify, phase]);

  // Once the run settles, decide whether compacting is safe.
  useEffect(() => {
    if (phase !== "running") {
      hasStarted.current = false;
      return;
    }
    if (busy) {
      hasStarted.current = true;
      return;
    }
    // "Not busy" only means something after the run has actually begun.
    if (!hasStarted.current) return;

    const ready = items
      .slice(baseline.current)
      .some((item) => item.kind === "assistant" && item.text.includes(HANDOFF_SENTINEL));

    setPhase("idle");
    if (ready) {
      notify("info", "交接完成，正在压缩上下文…");
      void compact();
    } else {
      notify(
        "warn",
        "没检测到交接完成标记，已跳过压缩——会话原样保留，可以先看看对话里的说明。",
      );
    }
  }, [busy, compact, items, notify, phase]);

  return { phase, start };
}
