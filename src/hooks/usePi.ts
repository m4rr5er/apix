/**
 * Owns the connection to the pi engine: subscriptions, lifecycle calls and the
 * transcript state machine.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import {
  ENGINE_RESTARTED,
  isRestartCancellation,
  onLog,
  onRecord,
  onStatus,
  pi,
  type EngineStatus,
} from "../lib/bridge";
import {
  THINKING_LEVELS,
  configApi,
  type SkillEntry,
  type ThinkingLevelMap,
} from "../lib/configBridge";
import {
  filterModels,
  modelKey,
  type ExtensionUiRequest,
  type ForkMessage,
  type ModelOption,
  type PiRecord,
  type RpcSessionState,
  type SessionStats,
} from "../lib/protocol";
import { initialState, reduce } from "../lib/reducer";
import { sameSessionPath } from "../lib/sessionRecovery";

export interface LogEntry {
  id: number;
  stream: "app" | "record" | "stdout" | "stderr" | "ui";
  text: string;
}

/** Result of trying to reopen a chat's recorded session file. */
export type SwitchOutcome =
  | { opened: true; cancelled: false; reason: "" }
  | { opened: false; cancelled: boolean; reason: string };

const LOG_LIMIT = 400;

export function usePi(extraVisibleProviders: readonly string[] = []) {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [engine, setEngine] = useState<EngineStatus>({ state: "stopped" });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [workdir, setWorkdir] = useState<string>("");
  const [location, setLocation] = useState<{ node: string; entry: string } | null>(null);

  const logSeq = useRef(0);
  const requestSeq = useRef(0);
  /** Bumped on every successful engine start, so callers can react once. */
  const [engineGeneration, setEngineGeneration] = useState(0);
  /**
   * The same counter, readable synchronously.
   *
   * `start` bumps it the moment the engine is up, but React state does not
   * update until the next render — and a caller that awaits `newSession()` has
   * to know whether a restart happened *while it was waiting*, so it can throw
   * away a session belonging to a process that no longer exists. Reading the
   * state variable there would give a stale number.
   */
  const engineGenerationRef = useRef(0);
  /**
   * Token for the most recently *started* session operation.
   *
   * `newSession` / `switchSession` / `rewindToTurn` each take a token on entry
   * and drop their result if a newer one has begun, so only the latest caller
   * may report a session path. Without this, two overlapping chains that both
   * create a session — a workspace switch restarting the engine while an
   * earlier chain is still awaiting — both pass the generation check, and the
   * slower one overwrites the correct `sessionFile` with a path pi has already
   * superseded and will never write. That dead path is what made a chat reopen
   * as a blank page.
   */
  const sessionOpRef = useRef(0);
  /** Session totals from pi, used by the status bar. */
  const [stats, setStats] = useState<SessionStats | null>(null);
  /**
   * Everything pi reports, before the picker's filter runs, plus the ids
   * `models.json` declares. Both are kept raw so the Settings page can show what
   * exists and re-filter without another round trip.
   */
  const [rawModels, setRawModels] = useState<ModelOption[]>([]);
  const [declaredModels, setDeclaredModels] = useState<Record<string, string[]>>({});
  /**
   * Levels pi will accept for the *current* model.
   *
   * pi answers `get_available_thinking_levels` per selected model, so this has
   * to be refetched on every model change — and it is then narrowed by the
   * model's own `thinkingLevelMap`, because a level mapped to `null` means the
   * model has no such mode even when the protocol allows the value.
   */
  const [thinkingLevels, setThinkingLevels] = useState<string[]>([]);
  /** `provider/id` → that model's `thinkingLevelMap`, from models.json. */
  const [thinkingMaps, setThinkingMaps] = useState<Record<string, ThinkingLevelMap>>({});
  /**
   * The skill library, and whether it has been read yet.
   *
   * The composer needs it to render its switches, and the engine start needs it
   * to resolve the on/off set into `--skill` paths — so the first start waits for
   * `skillsLoaded`, otherwise the engine would come up with an empty allowlist
   * and then be restarted a moment later.
   */
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [skillsLoaded, setSkillsLoaded] = useState(false);
  /**
   * Signature of the allowlist the running engine was started with.
   *
   * `syncSkills` compares against it so a restart happens only when the set of
   * enabled skills actually changed — switching between two conversations with
   * the same switches costs nothing.
   */
  const appliedSkillsRef = useRef<string | null>(null);
  /**
   * The session file the engine currently has open, as this side named it.
   *
   * `start` can hand pi a session with `--session`, so after a restart the
   * conversation is already open. Comparing against this is what lets
   * `openSession` skip a `switch_session` — and `switch_session` is not cheap:
   * it tears the runtime down and rebuilds it, which measures at ~1.2s on a real
   * workspace.
   */
  const openSessionRef = useRef<string | null>(null);
  /**
   * The engine generation the UI currently accepts events from. The host bumps
   * it with the `running` status before that process can emit any record, so a
   * record stamped with an older generation is a late arrival from a dead
   * process (the old stdout pipe flushes as it dies) and must not touch state —
   * a stale `agent_start` would otherwise pin `busy` on an idle engine forever,
   * because the process that owes the matching `agent_settled` no longer
   * exists.
   */
  const engineGenRef = useRef(0);
  /** Responses we are waiting for, keyed by the command id we sent. */
  const pending = useRef(
    new Map<
      string,
      { resolve: (value: unknown) => void; reject: (error: Error) => void }
    >(),
  );

  const settlePending = useCallback((record: PiRecord) => {
    const id = typeof record.id === "string" ? record.id : undefined;
    if (!id) return;
    const waiter = pending.current.get(id);
    if (!waiter) return;
    pending.current.delete(id);
    if (record.success) {
      waiter.resolve(record.data);
    } else {
      waiter.reject(new Error(String(record.error ?? "pi 拒绝了该命令")));
    }
  }, []);

  const addLog = useCallback((stream: LogEntry["stream"], text: string) => {
    logSeq.current += 1;
    const entry: LogEntry = { id: logSeq.current, stream, text };
    setLogs((prev) => {
      const next = [...prev, entry];
      return next.length > LOG_LIMIT ? next.slice(next.length - LOG_LIMIT) : next;
    });
  }, []);

  const clearLogs = useCallback(() => setLogs([]), []);

  // ---------------------------------------------------------------- events
  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    let disposed = false;

    const keep = (fn: () => void) => {
      if (disposed) fn();
      else unlisteners.push(fn);
    };

    const handleRecord = (record: PiRecord, gen: number) => {
      if (gen < engineGenRef.current) return;
      addLog("record", JSON.stringify(record));

      if (record.type === "response") {
        settlePending(record);
      }

      if (record.type === "extension_ui_request") {
        const ui = record as unknown as ExtensionUiRequest;
        handleExtensionUi(ui, dispatch, addLog);
        return;
      }

      dispatch({ kind: "record", record });
    };

    void onRecord(handleRecord).then(keep);
    void onStatus((status) => {
      if (typeof status.gen === "number" && status.gen > engineGenRef.current) {
        engineGenRef.current = status.gen;
      }
      setEngine(status);
      if (status.location) setLocation(status.location);
      // Keep the rail in sync with the directory pi actually received.
      if (status.cwd) setWorkdir(status.cwd);
      if (status.state === "running") {
        addLog("app", `pi 已启动（cwd: ${status.cwd ?? "?"}）`);
      } else if (status.state === "exited") {
        addLog("app", `pi 进程已退出（code: ${status.code ?? "unknown"}）`);
      } else if (status.state === "stopped") {
        addLog("app", "pi 进程已停止");
      }
    }).then(keep);
    void onLog((line) => addLog(line.stream, line.line ?? line.error ?? "")).then(keep);

    return () => {
      disposed = true;
      for (const fn of unlisteners) fn();
    };
  }, [addLog, settlePending]);

  /**
   * Send a command with a caller-owned id and resolve with its response data.
   * Used by the settings panel and the composer to ask pi for live state.
   */
  const request = useCallback(
    <T,>(command: Record<string, unknown>): Promise<T> => {
      requestSeq.current += 1;
      const id = `ui-${requestSeq.current}`;

      return new Promise<T>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          if (pending.current.delete(id)) {
            reject(new Error("pi 在 20 秒内没有响应"));
          }
        }, 20000);

        pending.current.set(id, {
          resolve: (value) => {
            window.clearTimeout(timer);
            resolve(value as T);
          },
          reject: (error) => {
            window.clearTimeout(timer);
            reject(error);
          },
        });

        void pi.send({ ...command, id }).catch((error: unknown) => {
          window.clearTimeout(timer);
          pending.current.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      });
    },
    [],
  );

  /**
   * Pull session totals whenever a run settles, the session changes, or the
   * model changes — the window comes from the model, so switching it has to
   * re-read the number rather than keep showing the previous model's limit.
   */
  useEffect(() => {
    if (engine.state !== "running" || state.busy) return;
    let alive = true;
    void request<SessionStats>({ type: "get_session_stats" })
      .then((data) => {
        if (alive) setStats(data);
      })
      .catch(() => {
        /* the engine may have restarted mid-flight */
      });
    return () => {
      alive = false;
    };
  }, [
    engine.state,
    state.busy,
    state.sessionFile,
    state.model,
    state.thinkingLevel,
    engineGeneration,
    request,
  ]);

  /** The picker's model list, narrowed to what models.json declares. */
  useEffect(() => {
    if (engine.state !== "running") {
      setRawModels([]);
      setDeclaredModels({});
      return;
    }
    let alive = true;
    void (async () => {
      let configured: Record<string, string[]> = {};
      try {
        configured = await configApi.modelsSummary();
      } catch {
        configured = {};
      }
      try {
        const data = await request<{
          models?: Array<{ provider?: string; id?: string; name?: string }>;
        }>({ type: "get_available_models" });
        if (!alive) return;
        setDeclaredModels(configured);
        setRawModels(
          (data?.models ?? [])
            .filter((entry) => Boolean(entry.provider && entry.id))
            .map((entry) => ({
              provider: entry.provider as string,
              id: entry.id as string,
              name: entry.name,
            })),
        );
      } catch {
        if (alive) setRawModels([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [engine.state, engineGeneration, state.sessionFile, request]);

  /**
   * Filtering happens here rather than at fetch time, so toggling a provider's
   * visibility in Settings re-filters instantly instead of waiting on an RPC.
   */
  const availableModels = useMemo(
    () => filterModels(rawModels, declaredModels, extraVisibleProviders),
    [rawModels, declaredModels, extraVisibleProviders],
  );

  /**
   * Snapshot every model's `thinkingLevelMap`.
   *
   * Read from models.json rather than the running engine: pi reports which
   * levels the protocol accepts, but only the file says which ones this
   * particular model actually implements.
   */
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const doc = await configApi.modelsRead();
        if (!alive) return;
        const maps: Record<string, ThinkingLevelMap> = {};
        for (const [provider, config] of Object.entries(doc.providers ?? {})) {
          for (const model of config.models ?? []) {
            if (model.thinkingLevelMap) {
              maps[`${provider}/${model.id}`] = model.thinkingLevelMap;
            }
          }
        }
        setThinkingMaps(maps);
      } catch {
        if (alive) setThinkingMaps({});
      }
    })();
    return () => {
      alive = false;
    };
  }, [engineGeneration]);

  /**
   * The skill library, reloaded whenever the settings page may have changed it.
   *
   * Not tied to the engine: skills are files on disk, so this can be read before
   * pi ever starts — which is what lets the first start already know the
   * allowlist.
   */
  const reloadSkills = useCallback(async () => {
    try {
      setSkills(await configApi.skillsList());
    } catch {
      // A failed read is not fatal: it means "no skills", which is also what an
      // empty library does, and the settings page reports the real error.
      setSkills([]);
    } finally {
      setSkillsLoaded(true);
    }
  }, []);

  useEffect(() => {
    void reloadSkills();
  }, [reloadSkills]);

  /** Levels to offer for the current model. */
  useEffect(() => {
    if (engine.state !== "running" || !state.model) {
      setThinkingLevels([]);
      return;
    }
    let alive = true;
    void request<{ levels?: string[] }>({ type: "get_available_thinking_levels" })
      .then((data) => {
        if (!alive) return;
        setThinkingLevels(resolveThinkingLevels(data?.levels, thinkingMaps[state.model ?? ""]));
      })
      .catch(() => {
        // The engine may be mid-restart; fall back to what the file declares.
        if (alive) setThinkingLevels(resolveThinkingLevels(undefined, thinkingMaps[state.model ?? ""]));
      });
    return () => {
      alive = false;
    };
  }, [engine.state, state.model, thinkingMaps, engineGeneration, request]);

  /**
   * pi takes its startup model from `settings.json`, and a new session resets
   * to it — so a stale `defaultProvider` there (a built-in provider the user no
   * longer configures) quietly comes back on every new chat. Move the session
   * onto a model `models.json` actually declares.
   *
   * The notice is once per app run, not once per engine start: switching
   * workspaces restarts pi, and repeating the same line every time turned it
   * into permanent furniture in the transcript.
   */
  const modelNoticeShown = useRef(false);
  useEffect(() => {
    if (engine.state !== "running" || state.busy) return;
    const current = state.model;
    if (!current || availableModels.length === 0) return;
    if (availableModels.some((model) => modelKey(model) === current)) return;

    const fallback = availableModels[0];
    if (!modelNoticeShown.current) {
      modelNoticeShown.current = true;
      dispatch({
        kind: "notice",
        level: "info",
        text: `settings.json 里的默认模型 ${current} 不在 models.json 中，已改用 ${modelKey(fallback)}。可以在「设置 → 模型供应商」里用星标把想用的那家设为默认，之后就不会再出现这条提示。`,
      });
    }
    void pi.send({ type: "set_model", provider: fallback.provider, modelId: fallback.id });
  }, [availableModels, engine.state, engineGeneration, state.busy, state.model]);

  // ------------------------------------------------------------- lifecycle
  const start = useCallback(
    async (cwd: string | null, skillPaths: string[] = [], session: string | null = null) => {
      for (const waiter of pending.current.values()) {
        waiter.reject(new Error(ENGINE_RESTARTED));
      }
      pending.current.clear();
      // Invalidate in-flight session operations: their session belongs to a
      // process that is about to be replaced.
      sessionOpRef.current += 1;

      setEngine({ state: "starting" });
      // A new process has no turn in flight: drop `busy` here rather than wait
      // for an `agent_settled` that a killed process will never send.
      dispatch({ kind: "engineReset" });
      try {
        const result = await pi.start(cwd, skillPaths, session);
        // What the running engine was actually built with, for `syncSkills`.
        appliedSkillsRef.current = skillPaths.join("\n");
        // What it has open, so `openSession` can skip a redundant switch.
        openSessionRef.current = session;
        setLocation(result);
        // Deliberately no transcript reset here. A start is almost always a
        // restart — a workspace switch, a settings change, a skills change — and
        // clearing would blank the pane and then refill it, which reads as a
        // stutter. The session that is opened next replaces the items anyway
        // (`switchSession` reloads them), and the one case that genuinely has
        // nothing to show — a workspace with no conversations — is cleared by
        // the caller that decides it.
        addLog("app", `pi 就绪\n  node  ${result.node}\n  entry ${result.entry}`);
        // Ask pi for its own view of the world so the UI never guesses.
        void pi.send({ type: "get_state" });
        void pi.send({ type: "get_messages" });
        engineGenerationRef.current += 1;
        setEngineGeneration(engineGenerationRef.current);
      } catch (error) {
        dispatch({ kind: "notice", level: "error", text: String(error) });
        setEngine({ state: "exited" });
        addLog("app", `启动失败：${String(error)}`);
      }
    },
    [addLog],
  );

  useEffect(() => {
    return () => {
      pending.current.clear();
    };
  }, []);

  const restart = useCallback(
    async (cwd?: string) => {
      // Reuse the allowlist the engine already had: a manual restart must not
      // silently drop the conversation's skills.
      const paths = (appliedSkillsRef.current ?? "").split("\n").filter(Boolean);
      await start(cwd ?? workdir ?? null, paths);
    },
    [start, workdir],
  );

  /**
   * Make the running engine match a conversation's skill allowlist.
   *
   * pi can only be told which skills exist at start-up (`--no-skills --skill …`),
   * so a change means a restart. `appliedSkillsRef` makes that conditional: two
   * conversations with the same switches cost nothing, and a conversation whose
   * switches differ is one restart. The caller reopens the session afterwards —
   * the generation effect already does that.
   *
   * @returns whether the engine was actually restarted.
   */
  const syncSkills = useCallback(
    async (cwd: string | null, skillPaths: string[]): Promise<boolean> => {
      if (appliedSkillsRef.current === skillPaths.join("\n")) return false;
      await start(cwd, skillPaths);
      return true;
    },
    [start],
  );

  /**
   * Mirrors `state.busy`, so a reload can wait for the current turn rather than
   * pulling the model and the tool registry out from under it.
   */
  const busyRef = useRef(false);
  useEffect(() => {
    busyRef.current = state.busy;
  }, [state.busy]);

  /** Resolve once no turn is running, or after `timeoutMs` either way. */
  const waitUntilIdle = useCallback(async (timeoutMs = 20000) => {
    const deadline = Date.now() + timeoutMs;
    while (busyRef.current && Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 120));
    }
  }, []);

  /** The reload in flight, so a burst of writes costs one reload, not several. */
  const reloadRef = useRef<Promise<boolean> | null>(null);

  /**
   * Make the running engine re-read its configuration, without replacing it.
   *
   * A settings write used to demand a restart: ~5.6s to respawn pi, plus the
   * pane losing its session while it came back. A running pi can instead re-read
   * `models.json`, `settings.json`, `mcp.json` and the skills directory in place
   * — `ctx.reload()` replays the session-start work against the files as they
   * now are (~1.1s once warm) and leaves the open session and its transcript
   * alone.
   *
   * It is requested as a command because that is the only form in which
   * `ctx.reload()` is reachable (see `APIX_RELOAD_EXTENSION`); pi answers
   * `disposition: "handled"`, so nothing is appended to the conversation.
   *
   * Bumping the generation afterwards is what makes the rest of the app
   * re-derive from the new runtime — the model list, the thinking levels, and
   * the active chat's session, which reload did not disturb.
   */
  const reloadConfig = useCallback(async (): Promise<boolean> => {
    if (reloadRef.current) return reloadRef.current;

    const run = (async () => {
      try {
        await waitUntilIdle();
        await request({ type: "prompt", message: "/apix-reload" });
        // The library on disk may be what changed, and the composer reads it.
        await reloadSkills();
        engineGenerationRef.current += 1;
        setEngineGeneration(engineGenerationRef.current);
        return true;
      } catch (error) {
        addLog("app", `配置重读失败：${String(error)}`);
        return false;
      } finally {
        reloadRef.current = null;
      }
    })();

    reloadRef.current = run;
    return run;
  }, [addLog, reloadSkills, request, waitUntilIdle]);

  const stop = useCallback(async () => {
    try {
      await pi.stop();
    } catch (error) {
      addLog("app", `停止失败：${String(error)}`);
    }
  }, [addLog]);

  const send = useCallback(
    async (text: string, behavior?: "steer" | "followUp") => {
      const trimmed = text.trim();
      if (!trimmed) return;
      try {
        await pi.prompt(trimmed, behavior);
      } catch (error) {
        dispatch({ kind: "notice", level: "error", text: String(error) });
      }
    },
    [],
  );

  const abort = useCallback(async () => {
    try {
      await pi.abort();
    } catch (error) {
      addLog("app", `中断失败：${String(error)}`);
    }
  }, [addLog]);

  const refreshHistory = useCallback(async () => {
    try {
      await pi.send({ type: "get_state" });
      await pi.send({ type: "get_messages" });
    } catch (error) {
      addLog("app", `读取历史失败：${String(error)}`);
    }
  }, [addLog]);

  /**
   * Push a get_state payload through the reducer without a round trip.
   *
   * Also the one place `openSessionRef` learns the engine's current session:
   * every operation that changes it (`new_session`, `switch_session`, `fork`)
   * applies its `get_state` through here, and a ref left behind makes the next
   * `openSession` re-switch a session that is already open — whose trailing
   * `setStats(null)` then lands after the stats effect's refill and sticks,
   * blanking the context meter for good.
   */
  const applyState = useCallback((data: RpcSessionState) => {
    if (data?.sessionFile) openSessionRef.current = data.sessionFile;
    dispatch({
      kind: "record",
      record: {
        type: "response",
        command: "get_state",
        success: true,
        data,
      } as unknown as PiRecord,
    });
  }, []);

  const reloadMessages = useCallback(async () => {
    try {
      await pi.send({ type: "get_messages" });
    } catch (error) {
      addLog("app", `读取历史失败：${String(error)}`);
    }
  }, [addLog]);

  /**
   * Drop the transcript without touching the engine.
   *
   * Needed because a start no longer clears it: when the workspace on screen has
   * nothing to open, this is what puts the pane back to the new-session view.
   *
   * Clears the transcript only. `reset` would also drop the model, the thinking
   * level and the session id — all of which pi still holds, and none of which
   * anything re-reads afterwards, so the composer was left showing "—" for a
   * model that was still in force.
   */
  const clearTranscript = useCallback(() => {
    dispatch({ kind: "clearTranscript" });
  }, []);

  /**
   * Start a fresh pi session and return its state, `sessionFile` included.
   *
   * Returns `null` when a newer session operation has started in the meantime,
   * so a superseded chain never hands back a path for the caller to bind.
   */
  const newSession = useCallback(async (): Promise<RpcSessionState | null> => {
    sessionOpRef.current += 1;
    const token = sessionOpRef.current;
    try {
      // Not `reset`: a new session keeps the engine's model and thinking level
      // (pi carries them over — only the transcript is new), and this call can
      // bail out below without ever applying state. A `reset` would have thrown
      // those away first, leaving nothing to restore them.
      dispatch({ kind: "clearTranscript" });
      setStats(null);
      await pi.send({ type: "new_session" });
      const data = await request<RpcSessionState>({ type: "get_state" });
      if (sessionOpRef.current !== token) return null;
      applyState(data);
      await reloadMessages();
      if (sessionOpRef.current !== token) return null;
      return data;
    } catch (error) {
      // A workspace switch cancels this on purpose; stay quiet about it.
      if (isRestartCancellation(error)) return null;
      dispatch({ kind: "notice", level: "error", text: `新建会话失败：${String(error)}` });
      return null;
    }
  }, [addLog, applyState, reloadMessages, request]);

  /**
   * Resume an existing pi session by the file path we stored for it.
   *
   * Reports *what happened* instead of just failing, because the caller has a
   * sensible recovery: pi hands out a session path before it writes the file
   * (the file appears with the first message), so a chat that was created and
   * then abandoned keeps a pointer to something that never existed. With the
   * outcome in hand the caller can open a fresh session instead of leaving the
   * chat dead — and say so, rather than showing an empty transcript next to a
   * bare error.
   *
   * Deliberately does not dispatch its own notice: only the caller knows
   * whether it recovered.
   *
   * Also drops the result when a newer session operation has started, reporting
   * it as a cancellation so the caller stays quiet instead of reacting to a
   * session that is already gone.
   */
  const switchSession = useCallback(
    async (sessionPath: string): Promise<SwitchOutcome> => {
      sessionOpRef.current += 1;
      const token = sessionOpRef.current;
      const superseded: SwitchOutcome = {
        opened: false,
        cancelled: true,
        reason: "已被更新的会话操作取代",
      };
      try {
        const result = await request<{ cancelled?: boolean }>({
          type: "switch_session",
          sessionPath,
        });
        if (sessionOpRef.current !== token) return superseded;
        if (result?.cancelled) return { opened: false, cancelled: true, reason: "已取消" };
        const data = await request<RpcSessionState>({ type: "get_state" });
        if (sessionOpRef.current !== token) return superseded;
        applyState(data);
        setStats(null);
        await reloadMessages();
        if (sessionOpRef.current !== token) return superseded;
        return { opened: true, cancelled: false, reason: "" };
      } catch (error) {
        if (isRestartCancellation(error)) {
          return { opened: false, cancelled: true, reason: ENGINE_RESTARTED };
        }
        return { opened: false, cancelled: false, reason: String(error) };
      }
    },
    [applyState, reloadMessages, request],
  );

  /**
   * Open a chat's session, skipping the round trip when it is already open.
   *
   * `start` is normally given the session to open (`--session`), so the common
   * case after a restart is "already there — just re-read the messages". That is
   * one runtime rebuild instead of two.
   */
  const openSession = useCallback(
    async (sessionPath: string): Promise<SwitchOutcome> => {
      if (openSessionRef.current && sameSessionPath(openSessionRef.current, sessionPath)) {
        try {
          await reloadMessages();
          return { opened: true, cancelled: false, reason: "" };
        } catch (error) {
          return { opened: false, cancelled: false, reason: String(error) };
        }
      }
      return switchSession(sessionPath);
    },
    [reloadMessages, switchSession],
  );

  const renameSession = useCallback(
    async (name: string) => {
      try {
        await pi.send({ type: "set_session_name", name });
      } catch (error) {
        addLog("app", `重命名会话失败：${String(error)}`);
      }
    },
    [addLog],
  );

  const setModel = useCallback(
    async (provider: string, modelId: string) => {
      try {
        await request({ type: "set_model", provider, modelId });
        // pi clamps the thinking level to what the new model supports, so read
        // the session back instead of assuming the old level survived.
        const data = await request<RpcSessionState>({ type: "get_state" });
        applyState(data);
      } catch (error) {
        if (isRestartCancellation(error)) return;
        dispatch({ kind: "notice", level: "error", text: `切换模型失败：${String(error)}` });
      }
    },
    [applyState, request],
  );

  /**
   * Set the thinking level for the current model.
   *
   * `set_thinking_level` replies with no payload — the old code sent it and
   * stopped, which is why the picker looked broken: nothing ever wrote the new
   * value back into state. Read `get_state` afterwards so the label shows what
   * pi actually accepted (it clamps unsupported levels rather than erroring).
   */
  const setThinkingLevel = useCallback(
    async (level: string) => {
      try {
        await request({ type: "set_thinking_level", level });
        const data = await request<RpcSessionState>({ type: "get_state" });
        applyState(data);
      } catch (error) {
        if (isRestartCancellation(error)) return;
        dispatch({
          kind: "notice",
          level: "error",
          text: `切换思考等级失败：${String(error)}`,
        });
      }
    },
    [applyState, request],
  );

  /**
   * The user prompts pi can rewind to.
   *
   * pi returns these from its session tree in order, each with the `entryId`
   * that `fork` needs. It is the only handle APIX has on individual messages —
   * the RPC has no edit or delete command.
   */
  const listTurns = useCallback(async (): Promise<ForkMessage[]> => {
    try {
      const data = await request<{ messages?: ForkMessage[] }>({ type: "get_fork_messages" });
      return Array.isArray(data?.messages) ? data.messages : [];
    } catch (error) {
      if (!isRestartCancellation(error)) {
        addLog("app", `读取提问列表失败：${String(error)}`);
      }
      return [];
    }
  }, [addLog, request]);

  /**
   * Rewind the session to just before one prompt, and hand back its text.
   *
   * This is pi's own `/fork`: the branch is cut at that entry, so the prompt and
   * everything after it leave the *active* branch while the original stays on
   * disk in pi's session tree. Because that produces a new session file, the
   * caller must rebind the chat to the path returned here.
   *
   * Returning the text is what makes "edit and ask again" work; returning
   * nothing and dropping the tail is what makes "delete" work.
   */
  const rewindToTurn = useCallback(
    async (entryId: string): Promise<{ text: string; sessionFile: string | null } | null> => {
      sessionOpRef.current += 1;
      const token = sessionOpRef.current;
      try {
        const result = await request<{ text?: string; cancelled?: boolean }>({
          type: "fork",
          entryId,
        });
        if (sessionOpRef.current !== token) return null;
        if (result?.cancelled) return null;
        const data = await request<RpcSessionState>({ type: "get_state" });
        if (sessionOpRef.current !== token) return null;
        applyState(data);
        setStats(null);
        await reloadMessages();
        if (sessionOpRef.current !== token) return null;
        return { text: result?.text ?? "", sessionFile: data?.sessionFile ?? null };
      } catch (error) {
        if (isRestartCancellation(error)) return null;
        const message = String(error);
        dispatch({
          kind: "notice",
          level: "error",
          text: /not been saved yet/i.test(message)
            ? "这个会话还没落盘（pi 需要先有一轮完整对话），暂时不能回退。"
            : `回退到这一轮失败：${message}`,
        });
        return null;
      }
    },
    [applyState, reloadMessages, request],
  );

  /** Push a message into the transcript, for callers outside the event stream. */
  const notify = useCallback(
    (level: "info" | "warn" | "error", text: string) => {
      dispatch({ kind: "notice", level, text });
    },
    [],
  );

  /** Ask pi to compact the session's context. */
  const compactContext = useCallback(async () => {
    try {
      await pi.send({ type: "compact" });
    } catch (error) {
      dispatch({ kind: "notice", level: "error", text: `压缩上下文失败：${String(error)}` });
    }
  }, []);

  return {
    state,
    engine,
    engineGeneration,
    /** Synchronous mirror of `engineGeneration`; see the declaration. */
    engineGenerationRef,
    stats,
    availableModels,
    /** Everything pi reports, for the Settings visibility list. */
    allModels: rawModels,
    thinkingLevels,
    logs,
    workdir,
    setWorkdir,
    location,
    start,
    restart,
    stop,
    /** The skill library, for the composer's switches and the settings page. */
    skills,
    skillsLoaded,
    reloadSkills,
    /** Aligns the engine's skill allowlist with a conversation. */
    syncSkills,
    /** Make the engine re-read its configuration in place, without restarting. */
    reloadConfig,
    /** Open a session, skipping the round trip when the engine is already on it. */
    openSession,
    /** Put the pane back to the new-session view without an engine round trip. */
    clearTranscript,
    send,
    abort,
    refreshHistory,
    newSession,
    switchSession,
    renameSession,
    setModel,
    setThinkingLevel,
    listTurns,
    rewindToTurn,
    notify,
    compactContext,
    defaultCwd: pi.defaultCwd,
    clearLogs,
    addLog,
    request,
  };
}

/**
 * Which thinking levels to offer for the active model.
 *
 * pi answers with the levels the model's protocol accepts. The file's
 * `thinkingLevelMap` is the finer filter, because the map is where "this model
 * has no `minimal` mode" is recorded — a level mapped to `null` has to
 * disappear from the picker, otherwise the user can select something that
 * silently does nothing.
 */
function resolveThinkingLevels(
  reported: string[] | undefined,
  map: ThinkingLevelMap | undefined,
): string[] {
  const rank = (level: string) => {
    const index = THINKING_LEVELS.indexOf(level as (typeof THINKING_LEVELS)[number]);
    return index === -1 ? THINKING_LEVELS.length : index;
  };

  let levels = Array.isArray(reported) ? [...reported] : [];

  if (levels.length === 0 && map) {
    // No engine answer (mid-restart): fall back to whatever the file declares.
    levels = ["off", ...THINKING_LEVELS.filter((level) => map[level] !== undefined && map[level] !== null)];
  }

  if (map) levels = levels.filter((level) => map[level as keyof ThinkingLevelMap] !== null);

  return Array.from(new Set(levels)).sort((a, b) => rank(a) - rank(b));
}

/**
 * pi extensions can drive the UI. P2 only handles notifications; interactive
 * requests are declined explicitly so the extension never hangs waiting for a
 * reply that will not come.
 */
function handleExtensionUi(
  request: ExtensionUiRequest,
  dispatch: (action: { kind: "notice"; level: "info" | "warn" | "error"; text: string }) => void,
  addLog: (stream: LogEntry["stream"], text: string) => void,
) {
  switch (request.method) {
    case "notify":
      dispatch({
        kind: "notice",
        level:
          request.notifyType === "error"
            ? "error"
            : request.notifyType === "warning"
              ? "warn"
              : "info",
        text: request.message ?? "",
      });
      return;
    case "setTitle":
    case "setStatus":
    case "setWidget":
    case "set_editor_text":
      addLog("ui", `${request.method} ${request.title ?? request.statusText ?? ""}`.trim());
      return;
    default: {
      const label = request.title ?? request.message ?? request.method;
      addLog("ui", `${request.method}: ${label} → 自动取消（P2 无对话框）`);
      dispatch({
        kind: "notice",
        level: "warn",
        text: `扩展请求「${request.method}」暂未实现交互，已自动取消。`,
      });
      void pi.send({ type: "extension_ui_response", id: request.id, cancelled: true });
    }
  }
}
