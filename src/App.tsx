import { useCallback, useEffect, useRef, useState } from "react";

import { Composer, type ComposerSeed } from "./components/Composer";
import { CommandBar } from "./components/CommandBar";
import { NewChatBackdrop } from "./components/backdrops";
import { QueueDock } from "./components/QueueDock";
import { Settings } from "./components/settings/Settings";
import { CONTEXT_HEAT_THRESHOLD, StatusBar } from "./components/StatusBar";
import { Toolbar } from "./components/Toolbar";
import { Transcript } from "./components/Transcript";
import { WorkspaceRail } from "./components/WorkspaceRail";
import { ConfirmDialog } from "./components/ui/kit";
import { useAppearance } from "./hooks/useAppearance";
import { useHandoff } from "./hooks/useHandoff";
import { usePi } from "./hooks/usePi";
import { liveChats, useWorkspaces } from "./hooks/useWorkspaces";
import { copyText } from "./lib/clipboard";
import { pi as piBridge } from "./lib/bridge";
import { configApi, type ChatEntry, type SessionListing } from "./lib/configBridge";
import type { ForkMessage, RpcSessionState } from "./lib/protocol";
import { hasConversation } from "./lib/reducer";
import { freshReasonText, resolveChatSession } from "./lib/sessionRecovery";
import { enabledSkillPaths } from "./lib/skills";

export default function App() {
  const appearance = useAppearance();
  // Declared before usePi because the picker filter needs it. The array comes
  // from state, so its identity is stable and the filter does not churn.
  const pi = usePi(appearance.prefs.visibleProviders);
  const ws = useWorkspaces();

  const [view, setView] = useState<"chat" | "settings">("chat");
  const ready = pi.engine.state === "running";

  // ------------------------------------------------------------------ turns
  //
  // pi owns the session tree; APIX keeps only a positional copy of the prompts
  // so the transcript can offer copy / edit / delete. It is refreshed whenever
  // the branch could have moved.

  const [turns, setTurns] = useState<ForkMessage[] | null>(null);
  const [seed, setSeed] = useState<ComposerSeed | null>(null);
  /** Bumped on every rewind so the transcript re-pins to its new end. */
  const [rewindNonce, setRewindNonce] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<{
    entryId: string;
    position: number;
    total: number;
  } | null>(null);

  const { listTurns, rewindToTurn, notify, engineGeneration, clearTranscript } = pi;
  const sessionFile = pi.state.sessionFile;
  const streaming = pi.state.busy;

  useEffect(() => {
    if (!ready) {
      setTurns(null);
      return;
    }
    let alive = true;
    void listTurns().then((list) => {
      if (alive) setTurns(list);
    });
    return () => {
      alive = false;
    };
  }, [ready, engineGeneration, sessionFile, streaming, listTurns]);

  /**
   * Put a chat on screen: resume its session, recover it, or open a new one.
   *
   * Resuming is not just "ask pi to open the recorded path", because that
   * cannot fail: pi accepts a path that does not exist, opens an empty session
   * under it and reports success, so the chat renders a blank transcript as
   * though the conversation had been lost. The recorded path is therefore
   * resolved against what is actually on disk first:
   *
   *   - `resume` — the recorded file is real, open it;
   *   - `adopt`  — it is gone, but one unclaimed sibling session file is
   *                unambiguously this chat's (its name timestamp sits next to
   *                the chat's own creation time), so rebind and open that —
   *                this is the case that actually gives the conversation back;
   *   - `fresh`  — there is genuinely nothing to resume; say so and open a new
   *                session rather than presenting an empty page as a success.
   */
  /**
   * Which pi session a chat should open — decided without touching the engine.
   *
   * Split out of `openChat` because the engine start needs the answer *before*
   * it spawns: handing pi the session with `--session` saves a full runtime
   * rebuild, and a rebuild measures at ~1.2s.
   */
  const resolveChatFor = useCallback(
    async (workspacePath: string, chat: ChatEntry) => {
      const workspace = ws.workspaces.find((entry) => entry.path === workspacePath);
      // The host answers with the workspace's real session files. A failure here
      // degrades to the unverified recorded path rather than refusing to open the
      // chat.
      let listing: SessionListing | null = null;
      try {
        listing = await configApi.sessionsList(workspacePath, chat.sessionFile);
      } catch {
        listing = null;
      }
      return resolveChatSession({
        chat,
        // Siblings compete for the same session files, and resolution happens one
        // chat at a time, so each call has to see them to decide who owns what.
        siblings: (workspace?.chats ?? []).filter((entry) => entry.id !== chat.id),
        listing,
      });
    },
    [ws.workspaces],
  );

  /**
   * The session path an engine start can be given, or `null`.
   *
   * Only a file that exists: `--session` means "use this file", so a chat that
   * was created but never used must not be handed over as one.
   */
  const sessionHintFor = useCallback(
    async (workspacePath: string, chat: ChatEntry): Promise<string | null> => {
      const target = await resolveChatFor(workspacePath, chat);
      return target.kind === "resume" || target.kind === "adopt" ? target.path : null;
    },
    [resolveChatFor],
  );

  const openChat = useCallback(
    async (workspacePath: string, chat: ChatEntry) => {
      const target = await resolveChatFor(workspacePath, chat);

      // `reopen` is the ordinary "created, never used" chat: the recorded file
      // does not exist yet, and pi keeps an explicit session path, so opening it
      // is correct and leaves the binding exactly as recorded.
      if (target.kind === "resume" || target.kind === "reopen" || target.kind === "adopt") {
        // Skips the round trip when the engine was started on this very session.
        const outcome = await pi.openSession(target.path);
        if (outcome.opened) {
          if (target.kind === "adopt") {
            await ws.bindSession(workspacePath, chat.id, target.path);
            pi.notify(
              "info",
              "这个会话登记的记录文件已不在，已按创建时间就近找回同一工作区下的会话记录并重新绑定。",
            );
          }
          return;
        }
        // A superseded or restarted engine is not the chat's problem.
        if (outcome.cancelled) return;
        pi.notify(
          "warn",
          `这个会话的记录打不开（${outcome.reason}），已作为新会话打开。原来的记录文件仍保留在磁盘上：${target.path}`,
        );
      } else if (target.kind === "fresh" && target.reason !== "unbound") {
        pi.notify("warn", freshReasonText(target.reason));
      }

      // An unbound chat on a just-spawned engine needs no `new_session` — the
      // engine *is* the new session, and pi has already named its file. Adopt
      // that name rather than tearing the fresh runtime down to build a second
      // one; `newSession` stays on the path for the recovery cases below,
      // where the engine really is on someone else's session.
      if (target.kind === "fresh" && target.reason === "unbound") {
        const data = await pi.request<RpcSessionState>({ type: "get_state" });
        if (data?.sessionFile) {
          await ws.bindSession(workspacePath, chat.id, data.sessionFile);
          return;
        }
      }

      // `null` means a newer session operation took over, so this chain must
      // not bind anything.
      const info = await pi.newSession();
      if (!info?.sessionFile) return;
      // The ambiguous case keeps the recorded path. Rebinding would replace the
      // only route back to a conversation that may well be sitting in one of
      // those sibling files — and this is exactly how the index lost a chat
      // before: two chats competed for one recoverable record, the loser was
      // handed a fresh session and its pointer to the real file was overwritten.
      if (target.kind === "fresh" && target.reason === "ambiguous") return;
      // Awaited: this binding is the only pointer to the conversation that is
      // about to be written, so it has to be on disk before the prompt goes out.
      await ws.bindSession(workspacePath, chat.id, info.sessionFile);
    },
    [pi, ws],
  );

  /** A rewind produces a new session file; the chat index has to follow it. */
  const rebindActiveChat = useCallback(
    (sessionPath: string | null) => {
      const workspace = ws.activeWorkspace;
      const chat = ws.activeChat;
      if (!workspace || !chat || !sessionPath) return;
      ws.bindSession(workspace.path, chat.id, sessionPath);
    },
    [ws],
  );

  const handleCopyTurn = useCallback(
    async (text: string) => {
      const ok = await copyText(text);
      notify(ok ? "info" : "warn", ok ? "已复制这一轮提问" : "复制失败：剪贴板不可用");
    },
    [notify],
  );

  const handleEditTurn = useCallback(
    async (entryId: string) => {
      const result = await rewindToTurn(entryId);
      if (!result) return;
      rebindActiveChat(result.sessionFile);
      setRewindNonce((value) => value + 1);
      setSeed({ text: result.text, nonce: Date.now() });
      notify("info", "已回退到这一轮提问之前，改好后再发送。");
    },
    [notify, rebindActiveChat, rewindToTurn],
  );

  const handleDeleteTurn = useCallback(
    (entryId: string, position: number, total: number) => {
      setPendingDelete({ entryId, position, total });
    },
    [],
  );

  // Stable props for the memoised transcript rows. `React.memo` compares props
  // by identity, and an inline arrow is a new function every render — which
  // would throw the memoisation away exactly while a turn streams and every
  // row is re-diffed several times a second.
  const handleCopyTurnStable = useCallback(
    (text: string) => {
      void handleCopyTurn(text);
    },
    [handleCopyTurn],
  );
  const handleEditTurnStable = useCallback(
    (entryId: string) => {
      void handleEditTurn(entryId);
    },
    [handleEditTurn],
  );

  const confirmDeleteTurn = useCallback(async () => {
    const target = pendingDelete;
    if (!target) return;
    setPendingDelete(null);
    const result = await rewindToTurn(target.entryId);
    if (!result) return;
    rebindActiveChat(result.sessionFile);
    setRewindNonce((value) => value + 1);
    const dropsTail = target.position < target.total - 1;
    notify(
      "info",
      `已删除第 ${target.position + 1} 轮提问${dropsTail ? "，以及它之后的全部对话" : ""}。原分支仍保留在 pi 的会话树里。`,
    );
  }, [notify, pendingDelete, rebindActiveChat, rewindToTurn]);


  // A handoff is deliberately two-phase: pi does the tidying and the writing,
  // APIX only sends the compaction once the skill reports it is done.
  const handoff = useHandoff({
    items: pi.state.items,
    busy: pi.state.busy,
    engineRunning: ready,
    send: pi.send,
    compact: pi.compactContext,
    notify: pi.notify,
  });

  const contextPercent = pi.stats?.contextUsage?.percent ?? null;
  const contextHot = contextPercent !== null && contextPercent >= CONTEXT_HEAT_THRESHOLD;
  /** Whether the pane has anything to show. Drives the backdrop *and* gating. */
  const conversation = hasConversation(pi.state.items);

  // ------------------------------------------------------------------ skills
  //
  // pi can only be told which skills exist at start-up (`--no-skills` plus one
  // `--skill` per enabled skill). With one engine per conversation, that is no
  // longer a restart problem: the allowlist belongs to the conversation, it is
  // decided when that conversation's engine is spawned (`focus`), and switching
  // between conversations never changes anyone else's. Toggling a switch on a
  // live, idle conversation respawns just that conversation's engine.

  const globalSkills = appearance.prefs.globalSkills;
  const chatSkills = ws.activeChat?.skills ?? {};

  /**
   * Put the view on a conversation: its own engine, in its workspace's cwd,
   * with its own skill allowlist, already on its session file.
   *
   * This replaced the single-engine `applyWorkspace`, whose whole job was
   * restarting one shared process onto the next chat's directory and session —
   * and whose coalescing loop existed only because those restarts cancelled
   * each other. With a process per conversation, a switch is either an attach
   * to an engine that never stopped (background turns) or one cold start, and
   * leaving a busy chat costs that chat nothing.
   */
  const focus = useCallback(
    async (workspacePath: string, chat: ChatEntry | null) => {
      const slot = chat ? chat.id : `ws:${workspacePath}`;
      const skills = enabledSkillPaths(pi.skills, globalSkills, chat?.skills ?? {});
      const hint = chat ? await sessionHintFor(workspacePath, chat) : null;
      const wasLive = await pi.attach(slot, { cwd: workspacePath, skills, session: hint });
      // A live engine kept whatever session its last operation opened. Normal
      // switches re-attach to exactly that (the hint matched), but a rebind
      // since then — an adopt, a rewind — means the engine is on the old file,
      // and only `openChat` knows how to reconcile the two.
      if (wasLive && chat) void openChat(workspacePath, chat);
    },
    [pi, sessionHintFor, globalSkills, openChat],
  );

  /**
   * Re-spawn the active conversation's engine so it sees the allowlist its
   * switches now say. Only when it is safe: the chat on screen, not mid-turn.
   * A busy conversation keeps its current allowlist — the switch is recorded
   * and takes effect the next time its engine comes up, which is the same
   * promise `--skill` has always made, just without killing anyone's turn.
   */
  const respawnIfIdle = useCallback(async () => {
    const workspace = ws.activeWorkspace;
    const chat = ws.activeChat;
    if (!workspace || !chat || pi.state.busy) return;
    if (pi.engine.state !== "running") return;
    await pi.stop();
    await focus(workspace.path, chat);
  }, [pi, ws, focus]);

  /**
   * Flip one skill's switch for the conversation on screen.
   *
   * The new-session view has no chat yet, and configuring its skills is
   * itself a creation — the same promise the first message makes: a chat is
   * added and bound before anything is written to it.
   */
  const handleSetChatSkill = useCallback(
    async (key: string, on: boolean) => {
      const workspace = ws.activeWorkspace;
      if (!workspace) return;
      let chat = ws.activeChat;
      if (!chat) {
        chat = ws.addChat(workspace.path);
        await focus(workspace.path, chat);
      }
      ws.setChatSkill(workspace.path, chat.id, key, on);
      await respawnIfIdle();
    },
    [ws, focus, respawnIfIdle],
  );

  const handleForgetChatSkill = useCallback(
    async (key: string) => {
      const workspace = ws.activeWorkspace;
      const chat = ws.activeChat;
      if (!workspace || !chat) return;
      ws.forgetChatSkill(workspace.path, chat.id, key);
      await respawnIfIdle();
    },
    [ws, respawnIfIdle],
  );

  /**
   * Put a skill in (or take it out of) the global list — Settings → Skills.
   *
   * Membership *is* the default: a global skill is on in every conversation
   * unless that conversation says otherwise, so there is no separate on/off for
   * it to disagree with.
   */
  const handleSetGlobalSkill = useCallback(
    (key: string, global: boolean) => {
      const next = global
        ? [...new Set([...globalSkills, key])]
        : globalSkills.filter((item) => item !== key);
      appearance.update({ globalSkills: next });
    },
    [appearance, globalSkills],
  );

  /**
   * Surface a damaged or unreadable session index — once.
   *
   * Otherwise it is invisible: the rail simply looks empty, which reads as "my
   * sessions are gone" rather than "the index file was recovered, here is the
   * backup".
   */
  const stateWarningShown = useRef(false);
  useEffect(() => {
    if (!ws.stateWarning || stateWarningShown.current) return;
    stateWarningShown.current = true;
    pi.notify("warn", ws.stateWarning);
  }, [pi, ws.stateWarning]);

  /**
   * Pay for the first in-place reload before anyone asks for one.
   *
   * The first `ctx.reload()` in a process costs ~4s — it is where the extension
   * module and the resource loader are exercised for the first time — and every
   * one after it costs ~1.1s. Doing it here, once the engine is up and no turn
   * is running, means the reload that follows a settings change is the fast
   * kind. Failure is ignored: this is an optimisation, and the reload path
   * reports its own errors when a setting is actually written.
   *
   * Deliberately once per engine *process*, not per generation: a reload bumps
   * the generation, so keying on that would schedule the next warm-up forever.
   */
  const warmUpTimer = useRef<number | null>(null);
  const warmedReload = useRef(false);

  useEffect(() => {
    if (pi.engine.state !== "running") {
      // A new process has its own first-reload cost to pay.
      warmedReload.current = false;
      if (warmUpTimer.current !== null) {
        window.clearTimeout(warmUpTimer.current);
        warmUpTimer.current = null;
      }
      return;
    }
    if (warmedReload.current || warmUpTimer.current !== null || pi.state.busy) return;
    warmUpTimer.current = window.setTimeout(() => {
      warmUpTimer.current = null;
      warmedReload.current = true;
      void pi.reloadConfig();
    }, 2500);
  }, [pi, pi.engine.state, pi.state.busy]);

  useEffect(
    () => () => {
      if (warmUpTimer.current !== null) window.clearTimeout(warmUpTimer.current);
    },
    [],
  );

  /**
   * Re-read the skill library when leaving Settings.
   *
   * The page creates, edits and deletes skills, and the composer's switches are
   * resolved against this list — so one read on the way out keeps the two in
   * step without watching the filesystem.
   */
  const { reloadSkills } = pi;
  useEffect(() => {
    if (view !== "settings") return;
    return () => {
      void reloadSkills();
    };
  }, [view, reloadSkills]);

  const bootstrapped = useRef(false);
  const handledGeneration = useRef(0);

  // Seed a workspace on first run, then bring the engine up in it.
  useEffect(() => {
    // Waits for the skill library as well: the allowlist is only known once it
    // has been read, and starting without it would enable nothing and then force
    // an immediate restart.
    if (bootstrapped.current || !ws.loaded || !pi.skillsLoaded) return;
    bootstrapped.current = true;
    void (async () => {
      // `ws.activePath`, not `workspaces[0]`: the remembered workspace is the
      // one the UI will show, and pi's cwd is what its tools operate on. Starting
      // in the first workspace instead would leave the engine in the wrong
      // directory whenever the session that opened does not carry its own cwd —
      // which is always the case for a workspace with no sessions.
      let path = ws.activePath ?? ws.workspaces[0]?.path ?? "";
      if (!path) {
        let seed = "";
        try {
          seed = (await configApi.lastWorkdir()) ?? "";
        } catch {
          seed = "";
        }
        if (!seed) {
          try {
            seed = await pi.defaultCwd();
          } catch {
            seed = "";
          }
        }
        if (seed) {
          ws.addWorkspace(seed);
          path = seed;
        }
      }
      if (path) {
        // Open the remembered conversation in its own engine — the same call
        // every later switch makes; there is no separate cold-start path any
        // more.
        const entry = ws.workspaces.find((item) => item.path === path);
        const chat = entry?.chats.find((item) => item.id === entry.activeChat) ?? null;
        await focus(path, chat);
      }
    })();
  }, [pi, focus, ws]);

  /**
   * Adopt a session pi just created for a chat that had none yet.
   *
   * The generation check before binding is not defensive padding — it is the
   * fix for a real corruption: two overlapping chains that both create a
   * session can finish out of order, and the slower one would otherwise bind a
   * path its own process never got to persist. Only the newest generation may
   * bind. With per-conversation engines the chains barely overlap any more,
   * but an in-place settings reload still bumps the generation, so the rule
   * stays.
   */
  useEffect(() => {
    const generation = pi.engineGeneration;
    if (generation === 0 || handledGeneration.current === generation) return;
    handledGeneration.current = generation;

    const workspace = ws.activeWorkspace;
    const chat = ws.activeChat;
    if (!workspace || !chat) {
      // Nothing open: the pane drops back to the new-session view — otherwise
      // the previous conversation would sit there with no session behind it.
      clearTranscript();
      return;
    }
    if (!chat.sessionFile && pi.state.sessionFile) {
      void ws.bindSession(workspace.path, chat.id, pi.state.sessionFile);
    }
  }, [clearTranscript, pi.engineGeneration, pi.state.sessionFile, ws]);

  // ------------------------------------------------------------- rail wiring

  /**
   * Coalesce engine restarts. Clicking three workspaces in a second must end
   * up starting pi once, in the last one clicked — otherwise the intermediate
   * starts cancel each other's session commands.
   */
  const handleAddWorkspace = (path: string) => {
    const entry = ws.addWorkspace(path);
    if (!entry) return;
    void focus(entry.path, null);
  };

  const handleSelectWorkspace = (path: string) => {
    if (path === ws.activePath) return;
    ws.setActivePath(path);
    // Open the workspace's remembered chat, not an empty pane: what the user
    // clicked is "that project", and the project's last conversation is its
    // face. A busy one is never interrupted — `attach` re-joins its engine.
    const entry = ws.workspaces.find((item) => item.path === path);
    const chat = entry?.chats.find((item) => item.id === entry.activeChat) ?? null;
    void focus(path, chat);
  };

  const handleRemoveWorkspace = (path: string) => {
    ws.removeWorkspace(path);
    if (path !== ws.activePath) return;
    const next = ws.workspaces.find((entry) => entry.path !== path);
    if (next) {
      const entry = ws.workspaces.find((item) => item.path === next.path);
      const chat = entry?.chats.find((item) => item.id === entry.activeChat) ?? null;
      void focus(next.path, chat);
    }
  };

  /**
   * Every rail action addresses a (workspace, chat) pair, because the rail
   * lists all workspaces' chats at once — and opening any chat is now the same
   * one call wherever it lives: focus moves the view, and the chat's own
   * engine (spawned, or already running in the background) comes with it.
   */
  const handleAddChat = async (workspacePath: string) => {
    const chat = ws.addChat(workspacePath);
    if (workspacePath !== ws.activePath) ws.setActivePath(workspacePath);
    await focus(workspacePath, chat);
  };

  /**
   * Send a prompt.
   *
   * A workspace with nothing open has no conversation for the prompt to belong
   * to, so the first message is itself the creation: a chat is added and its
   * engine spawned before the prompt goes out. Without that the turn would
   * land in the throwaway `ws:` engine's session — visible on screen but
   * unrepresented in the rail, and gone the moment the workspace is left. It
   * is also why the composer stays usable in a workspace that has no
   * sessions yet.
   */
  const handleSend = async (text: string, behavior?: "steer" | "followUp") => {
    const workspace = ws.activeWorkspace;
    if (workspace && (!ws.activeChat || liveChats(workspace).length === 0)) {
      const chat = ws.addChat(workspace.path);
      await focus(workspace.path, chat);
    }
    await pi.send(text, behavior);
  };

  const handleSelectChat = async (workspacePath: string, chatId: string) => {
    const workspace = ws.workspaces.find((entry) => entry.path === workspacePath);
    const chat = workspace?.chats.find((entry) => entry.id === chatId);
    if (!chat) return;
    if (workspacePath !== ws.activePath) ws.setActivePath(workspacePath);
    if (chatId === ws.activeChat?.id && workspacePath === ws.activePath) return;
    ws.selectChat(workspacePath, chatId);
    await focus(workspacePath, chat);
  };

  const handleRenameChat = (workspacePath: string, chatId: string, name: string) => {
    ws.renameChat(workspacePath, chatId, name);
    if (workspacePath === ws.activePath && chatId === ws.activeChat?.id) {
      void pi.renameSession(name);
    }
  };

  /**
   * Empty a workspace's pane when its last session goes away, and retire the
   * removed chat's engine if it had one.
   *
   * The pane moves to the workspace's own `ws:` slot — a throwaway engine
   * whose session nothing is bound to, which is what the new-session view
   * shows and what the next message adopts through `handleSend`. A removed
   * chat whose turn was still running in the background loses its engine too:
   * nobody will ever read that transcript again.
   */
  const clearPaneIfEmptied = (workspacePath: string, removedId: string) => {
    void pi.stopSlot(removedId);
    if (workspacePath !== ws.activePath) return;
    const workspace = ws.workspaces.find((entry) => entry.path === workspacePath);
    const leftLive = (workspace?.chats ?? []).some(
      (chat) => chat.id !== removedId && !chat.archivedAt,
    );
    if (!leftLive) void focus(workspacePath, null);
  };

  const handleRemoveChat = (workspacePath: string, chatId: string) => {
    clearPaneIfEmptied(workspacePath, chatId);
    ws.removeChat(workspacePath, chatId);
  };

  /**
   * Archiving is the reversible alternative to removing: the chat leaves the
   * rail but keeps its session file and its binding, so it can be restored from
   * Settings and resumed exactly where it was. Archived chats are forgotten by
   * the rail only — the recovery pass still counts them as owning their files,
   * so archiving can never make another chat steal their session.
   */
  const handleArchiveChat = (workspacePath: string, chatId: string) => {
    clearPaneIfEmptied(workspacePath, chatId);
    ws.archiveChat(workspacePath, chatId);
  };

  const handleUnarchiveChat = (workspacePath: string, chatId: string) => {
    ws.unarchiveChat(workspacePath, chatId);
  };

  const handleRenameWorkspace = (path: string, name: string) => {
    ws.renameWorkspace(path, name);
  };

  /**
   * Polish the composer's draft and hand the rewrite back.
   *
   * Deliberately rejects rather than dispatching a notice: the failure belongs
   * to the input the user is editing, and the composer renders it there (a
   * transcript notice would scroll away and read as something pi said).
   */
  const handleEnhancePrompt = useCallback(
    async (text: string): Promise<string> => {
      const model = pi.state.model ?? null;
      const cwd = ws.activePath ?? pi.workdir ?? null;
      return piBridge.promptEnhance(text, model, cwd);
    },
    [pi, ws.activePath],
  );

  return (
    <div className="app">
      <Toolbar
        workspaceName={ws.activeWorkspace?.name ?? null}
        chatName={ws.activeChat?.name ?? null}
        settingsOpen={view === "settings"}
        actions={
          <CommandBar
            phase={handoff.phase}
            hot={contextHot}
            /* Nothing to compact on a session that has not been used yet, and
               starting a handoff there would burn a turn on tidy-up + a handoff
               document for an empty workspace. Mid-turn is also no-go: pi takes
               one prompt per run, so the handoff text would be rejected and the
               button would sit in 「交接中」 until the 90s timeout. */
            disabled={!ready || !conversation || pi.state.busy}
            disabledReason={
              !ready
                ? "引擎还没就绪"
                : !conversation
                  ? "这个会话还没有对话内容"
                  : "等当前回合结束后再交接"
            }
            onCompact={() => void handoff.start()}
          />
        }
      />

      {/* The chat pane stays mounted while Settings is open, and Settings is
          laid over it. Unmounting the pane instead would re-roll the backdrop,
          drop an unsent draft, reset the scroll position and rebuild every
          message card — the stutter this wrapper exists to remove. */}
      <div className="stage">
          <div className="body">
            <WorkspaceRail
              workspaces={ws.workspaces}
              activePath={ws.activePath}
              activeChatId={ws.activeChat?.id ?? null}
              backgroundBusy={pi.backgroundBusy}
              engineRunning={ready}
              onAddWorkspace={handleAddWorkspace}
              onSelectWorkspace={handleSelectWorkspace}
              onRemoveWorkspace={handleRemoveWorkspace}
              onRenameWorkspace={handleRenameWorkspace}
              onAddChat={(path) => void handleAddChat(path)}
              onSelectChat={(path, chatId) => void handleSelectChat(path, chatId)}
              onRenameChat={handleRenameChat}
              onRemoveChat={handleRemoveChat}
              onArchiveChat={handleArchiveChat}
              onOpenSettings={() => setView("settings")}
              onRestartEngine={() => void pi.restart()}
            />

            <main className="center">
              {!conversation ? (
                <NewChatBackdrop
                  theme={appearance.resolved}
                  /*
                   * Keyed by the workspace, deliberately not by the chat.
                   *
                   * The chat id used to be in here, and creating a chat changes
                   * it — so pressing "+" while the empty view was already on
                   * screen remounted this element and drew a second random
                   * backdrop over the first, which read as the background
                   * "jumping twice" for a click that changed nothing visible.
                   *
                   * Variety is not lost: the backdrop is unmounted whenever a
                   * conversation is shown, so coming back to an empty view
                   * always rerolls. All that is given up is two *different*
                   * empty chats sharing one workspace drawing different
                   * artwork.
                   */
                  key={ws.activePath ?? "none"}
                />
              ) : null}

              <Transcript
                items={pi.state.items}
                busy={pi.state.busy}
                turns={turns}
                actionsEnabled={ready && !pi.state.busy}
                resetNonce={rewindNonce}
                onCopyTurn={handleCopyTurnStable}
                onEditTurn={handleEditTurnStable}
                onDeleteTurn={handleDeleteTurn}
              />

              <div className="composer-area">
                {/* Queued work sits directly above the input it will be appended to. */}
                <QueueDock
                  steering={pi.state.queued.steering}
                  followUp={pi.state.queued.followUp}
                  onInject={(kind, index) => {
                    void pi.queueOp(kind, index, "inject").catch((error: unknown) => {
                      pi.notify("warn", `插入失败：${String(error instanceof Error ? error.message : error)}`);
                    });
                  }}
                  onEdit={(kind, index) => {
                    void pi
                      .queueOp(kind, index, "edit")
                      .then((text) => {
                        if (text !== null) setSeed({ text, nonce: Date.now() });
                      })
                      .catch((error: unknown) => {
                        pi.notify("warn", `取回失败：${String(error instanceof Error ? error.message : error)}`);
                      });
                  }}
                  onDelete={(kind, index) => {
                    void pi.queueOp(kind, index, "delete").catch((error: unknown) => {
                      pi.notify("warn", `删除失败：${String(error instanceof Error ? error.message : error)}`);
                    });
                  }}
                />

                {/* Reserved for the quick-command strip. Intentionally empty for now. */}

                <Composer
                  busy={pi.state.busy}
                  disabled={!ready}
                  model={pi.state.model}
                  thinkingLevel={pi.state.thinkingLevel}
                  models={pi.availableModels}
                  levels={pi.thinkingLevels}
                  seed={seed}
                  onSend={(text, behavior) => void handleSend(text, behavior)}
                  onAbort={() => void pi.abort()}
                  onEnhance={handleEnhancePrompt}
                  skills={pi.skills}
                  chatSkills={chatSkills}
                  globalSkills={globalSkills}
                  onSetChatSkill={handleSetChatSkill}
                  onForgetChatSkill={handleForgetChatSkill}
                  onSetModel={(provider, modelId) => void pi.setModel(provider, modelId)}
                  onSetThinkingLevel={(level) => void pi.setThinkingLevel(level)}
                />
              </div>
            </main>
          </div>
        {view === "settings" ? (
          <div className="settings-layer">
          <Settings
            onClose={() => setView("chat")}
            appearance={appearance}
            allModels={pi.allModels}
            archived={ws.archivedChats}
            onUnarchive={handleUnarchiveChat}
            onRemoveArchived={handleRemoveChat}
            onSetGlobalSkill={handleSetGlobalSkill}
            onApplyConfig={pi.reloadConfig}
            onRestartEngine={() => {
              setView("chat");
              void pi.restart();
            }}
          />
          </div>
        ) : null}
      </div>

      <StatusBar stats={pi.stats} busy={pi.state.busy} model={pi.state.model} />

      <ConfirmDialog
        open={pendingDelete !== null}
        tone="danger"
        title="删除这一轮提问？"
        confirmLabel="删除"
        message={
          pendingDelete ? (
            <>
              <p>
                会话会回退到这一轮提问之前，<b>第 {pendingDelete.position + 1} 轮提问</b>
                {pendingDelete.position < pendingDelete.total - 1
                  ? "以及它之后的全部对话都会移出当前会话。"
                  : "和它的回答都会移出当前会话。"}
              </p>
              <p className="confirm-note">
                pi 的会话文件是树状结构，被移出的分支仍保留在磁盘上，只是不再属于当前对话。
              </p>
            </>
          ) : null
        }
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDeleteTurn()}
      />
    </div>
  );
}
