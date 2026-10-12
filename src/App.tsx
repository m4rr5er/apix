import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
import type { ForkMessage } from "./lib/protocol";
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
  // `--skill` per enabled skill), so the conversation's switches are resolved
  // into a path list and handed to the engine. A skill that is not on is not in
  // the session at all, which is what "只有开启的才会被触发" means in practice.

  const globalSkills = appearance.prefs.globalSkills;
  const chatSkills = ws.activeChat?.skills ?? {};
  const activeSkillPaths = useMemo(
    () => enabledSkillPaths(pi.skills, globalSkills, chatSkills),
    [pi.skills, globalSkills, chatSkills],
  );
  /** Kept in a ref so the engine-start paths read the newest set, not a closure. */
  const skillPathsRef = useRef<string[]>(activeSkillPaths);
  skillPathsRef.current = activeSkillPaths;
  /** Signature of the set the running engine was started with. */
  const skillSignature = activeSkillPaths.join("\n");
  const appliedSkillSignature = useRef<string | null>(null);

  /**
   * Keep the engine's allowlist in step with the conversation.
   *
   * A restart is the only way to change it, so it happens only when the set
   * really differs — moving between two conversations with the same switches
   * costs nothing. The session is reopened by the generation effect, so the
   * conversation survives the restart.
   */
  useEffect(() => {
    if (!ready || !pi.skillsLoaded) return;
    if (appliedSkillSignature.current === null) {
      // The engine was just started with this set by the bootstrap effect.
      appliedSkillSignature.current = skillSignature;
      return;
    }
    if (appliedSkillSignature.current === skillSignature) return;
    appliedSkillSignature.current = skillSignature;
    void pi.syncSkills(ws.activePath, activeSkillPaths).then((restarted) => {
      if (restarted) {
        pi.notify(
          "info",
          activeSkillPaths.length === 0
            ? "已按当前会话停用全部 skill，并重启引擎。"
            : `已按当前会话启用 ${activeSkillPaths.length} 个 skill，并重启引擎。`,
        );
      }
    });
  }, [activeSkillPaths, skillSignature, ready, pi, ws.activePath]);

  /**
   * Flip one skill's switch for the conversation on screen.
   *
   * The new-session view has no chat yet, and the old wiring dropped the click
   * on the floor there — configuring skills is itself a creation, the same way
   * the first message adds and binds a chat (see `handleSend`).
   */
  const handleSetChatSkill = useCallback(
    async (key: string, on: boolean) => {
      const workspace = ws.activeWorkspace;
      if (!workspace) return;
      let chat = ws.activeChat;
      if (!chat) {
        chat = ws.addChat(workspace.path);
        await openChat(workspace.path, chat);
      }
      ws.setChatSkill(workspace.path, chat.id, key, on);
    },
    [ws, openChat],
  );

  const handleForgetChatSkill = useCallback(
    (key: string) => {
      const workspace = ws.activeWorkspace;
      const chat = ws.activeChat;
      if (!workspace || !chat) return;
      ws.forgetChatSkill(workspace.path, chat.id, key);
    },
    [ws],
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
        // Same trick as a workspace switch: find the conversation first, so a
        // cold start opens it in one rebuild instead of two.
        const entry = ws.workspaces.find((item) => item.path === path);
        const chat = entry?.chats.find((item) => item.id === entry.activeChat);
        const hint = chat ? await sessionHintFor(path, chat) : null;
        await pi.start(path, skillPathsRef.current, hint);
      }
    })();
  }, [pi, sessionHintFor, ws]);

  /**
   * Each engine start restores the active chat: resume its session file, or
   * adopt the session pi just created when the chat has none yet.
   *
   * The generation check before binding is not defensive padding — it is the
   * fix for a real corruption. Switching workspaces restarts pi, so two starts
   * can overlap; each one calls `newSession`, and each new session belongs to
   * the process that created it. If the *earlier* chain finishes last, it
   * writes a session file path that its process never got to persist, and the
   * chat ends up bound to a file that does not exist. Clicking that chat then
   * asks pi to open a missing file, which fails and shows an empty chat — the
   * conversation looks lost even though it is sitting in the other session
   * file on disk.
   *
   * Comparing the generation makes the outcome order-independent: only the
   * newest start may bind.
   */
  useEffect(() => {
    const generation = pi.engineGeneration;
    if (generation === 0 || handledGeneration.current === generation) return;
    handledGeneration.current = generation;

    const workspace = ws.activeWorkspace;
    const chat = ws.activeChat;
    if (!workspace || !chat) {
      // Nothing to open: the workspace has no conversations (or none is
      // active). `start` no longer clears the transcript, so this is where the
      // pane is dropped back to the new-session view — otherwise the previous
      // workspace's conversation would sit there with no session behind it.
      clearTranscript();
      return;
    }

    void openChat(workspace.path, chat);
  }, [clearTranscript, pi.engineGeneration, ws.activeWorkspace?.path, ws.activeChat?.id, openChat]);

  // ------------------------------------------------------------- rail wiring

  /**
   * Coalesce engine restarts. Clicking three workspaces in a second must end
   * up starting pi once, in the last one clicked — otherwise the intermediate
   * starts cancel each other's session commands.
   */
  const wantedWorkspace = useRef<string | null>(null);
  const switchingWorkspace = useRef(false);

  const applyWorkspace = useCallback(
    async (path: string) => {
      wantedWorkspace.current = path;
      if (switchingWorkspace.current) return;
      switchingWorkspace.current = true;
      try {
        while (wantedWorkspace.current) {
          const target = wantedWorkspace.current;
          wantedWorkspace.current = null;
          // Resolve the conversation first, so the engine can come up already on
          // it instead of building a runtime and then throwing it away for a
          // `switch_session`.
          const entry = ws.workspaces.find((item) => item.path === target);
          const chat = entry?.chats.find((item) => item.id === entry.activeChat);
          const hint = chat ? await sessionHintFor(target, chat) : null;
          // The allowlist goes in too, so the switch state survives the change.
          await pi.start(target, skillPathsRef.current, hint);
        }
      } finally {
        wantedWorkspace.current = null;
        switchingWorkspace.current = false;
      }
    },
    [pi],
  );

  const handleAddWorkspace = (path: string) => {
    const entry = ws.addWorkspace(path);
    if (!entry) return;
    void applyWorkspace(entry.path);
  };

  const handleSelectWorkspace = (path: string) => {
    if (path === ws.activePath) return;
    ws.setActivePath(path);
    void applyWorkspace(path);
  };

  const handleRemoveWorkspace = (path: string) => {
    ws.removeWorkspace(path);
    if (path !== ws.activePath) return;
    const next = ws.workspaces.find((entry) => entry.path !== path);
    if (next) void applyWorkspace(next.path);
  };

  /**
   * Every rail action now addresses a (workspace, chat) pair, because the rail
   * lists all workspaces' chats at once.
   *
   * Opening a chat that lives in another workspace restarts the engine in that
   * workspace's cwd first, and leaves the actual reopen to the generation
   * effect: starting pi and opening in the same tick would run two session
   * creations for one click — which is precisely how a chat ended up bound to
   * a session file pi never wrote.
   */
  const handleAddChat = async (workspacePath: string) => {
    const chat = ws.addChat(workspacePath);
    if (workspacePath !== ws.activePath) {
      ws.selectChat(workspacePath, chat.id);
      await applyWorkspace(workspacePath);
      return;
    }
    // No sessionFile yet, so this takes the open-a-new-session path.
    await openChat(workspacePath, chat);
  };

  /**
   * Send a prompt.
   *
   * A workspace with nothing open has no session for the prompt to belong to, so
   * the first message is itself the creation: a chat is added and bound before
   * the prompt goes out. Without that the turn would land in pi's unbound
   * startup session — visible on screen but unrepresented in the rail, and gone
   * the moment the workspace is left. It is also why the composer stays usable
   * in a workspace that has no sessions yet.
   */
  const handleSend = async (text: string, behavior?: "steer" | "followUp") => {
    const workspace = ws.activeWorkspace;
    if (workspace && liveChats(workspace).length === 0) {
      const chat = ws.addChat(workspace.path);
      await openChat(workspace.path, chat);
    }
    await pi.send(text, behavior);
  };

  const handleSelectChat = async (workspacePath: string, chatId: string) => {
    const workspace = ws.workspaces.find((entry) => entry.path === workspacePath);
    const chat = workspace?.chats.find((entry) => entry.id === chatId);
    if (!chat) return;

    if (workspacePath !== ws.activePath) {
      ws.setActivePath(workspacePath);
      ws.selectChat(workspacePath, chatId);
      await applyWorkspace(workspacePath);
      return;
    }
    if (chatId === ws.activeChat?.id) return;
    ws.selectChat(workspacePath, chatId);
    await openChat(workspacePath, chat);
  };

  const handleRenameChat = (workspacePath: string, chatId: string, name: string) => {
    ws.renameChat(workspacePath, chatId, name);
    if (workspacePath === ws.activePath && chatId === ws.activeChat?.id) {
      void pi.renameSession(name);
    }
  };

  /**
   * Empty a workspace's pane when its last session goes away.
   *
   * pi keeps running with whatever session it had, so without this the removed
   * conversation would stay on screen next to a now-empty workspace. Starting a
   * fresh *unbound* session clears the transcript and drops the pane back to the
   * new-session view; the next message adopts it through `handleSend`.
   */
  const clearPaneIfEmptied = (workspacePath: string, removedId: string) => {
    // Only the pane on screen needs clearing, and only when the engine can
    // answer — a stopped engine would turn this into a spurious error notice.
    if (!ready || workspacePath !== ws.activePath) return;
    const workspace = ws.workspaces.find((entry) => entry.path === workspacePath);
    const leftLive = (workspace?.chats ?? []).some(
      (chat) => chat.id !== removedId && !chat.archivedAt,
    );
    if (!leftLive) void pi.newSession();
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
               document for an empty workspace. */
            disabled={!ready || !conversation}
            disabledReason={!ready ? "引擎还没就绪" : "这个会话还没有对话内容"}
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
                onCopyTurn={(text) => void handleCopyTurn(text)}
                onEditTurn={(entryId) => void handleEditTurn(entryId)}
                onDeleteTurn={handleDeleteTurn}
              />

              <div className="composer-area">
                {/* Queued work sits directly above the input it will be appended to. */}
                <QueueDock
                  steering={pi.state.queued.steering}
                  followUp={pi.state.queued.followUp}
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
