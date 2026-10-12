/**
 * The workspace and chat index.
 *
 * pi has no `list_sessions` RPC command, and its own session files are
 * zstd-compressed, so APIX keeps its own index instead: workspace (a directory,
 * which is pi's cwd) → chats → the pi session file each chat is bound to.
 * The engine stays the source of truth for message content; this is only the
 * table of contents.
 *
 * Every mutation goes through `commit`, which reads the latest list from a ref
 * rather than from the render closure. That matters because callers routinely
 * await an engine round trip between two writes:
 *
 *     const chat = ws.addChat(path);          // write 1
 *     const info = await pi.newSession();     // suspend
 *     ws.bindSession(path, chat.id, ...);     // write 2
 *
 * Reading `workspaces` from the closure made write 2 rebuild the list from the
 * pre-write-1 snapshot, which silently deleted the chat that had just been
 * created. That is exactly the "the workspace shows 0 sessions" symptom.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  baseName,
  configApi,
  type AppStateDocument,
  type ChatSkillState,
  type ArchivedChat,
  type ChatEntry,
  type WorkspaceEntry,
} from "../lib/configBridge";

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** A persisted skills block, keeping only real on/off decisions. */
function skillState(raw: unknown): ChatSkillState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: ChatSkillState = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "boolean") out[key] = value;
  }
  return out;
}

export function newChat(name = "新会话"): ChatEntry {
  return {
    id: makeId(),
    name,
    sessionFile: null,
    createdAt: Date.now(),
    archivedAt: null,
    // No opinion yet: global skills are on by default, everything else is off.
    skills: {},
  };
}

/**
 * The chats a workspace actually shows.
 *
 * Archived chats stay in `chats` — they still own their session file, and the
 * recovery pass has to keep counting them as claimed — but they are not part of
 * the rail, and they cannot be the workspace's active chat.
 */
export function liveChats(workspace: WorkspaceEntry): ChatEntry[] {
  return workspace.chats.filter((chat) => !chat.archivedAt);
}

function newWorkspace(path: string, name?: string): WorkspaceEntry {
  // No placeholder chat: a workspace starts empty and shows nothing in the rail
  // until a session is actually created in it.
  return { path, name: name?.trim() || baseName(path), chats: [], activeChat: null };
}

/**
 * A workspace's active chat, or `null` when it has none to show.
 *
 * Archived chats cannot be active, and a state file can name a chat that no
 * longer exists — both collapse to "nothing is open", which is a legitimate
 * state rather than something to repair by inventing a chat. Inventing one is
 * what used to put a "新会话" row under every freshly added workspace.
 */
function resolveActiveChat(
  chats: ChatEntry[],
  wanted: string | null,
): string | null {
  const live = chats.filter((chat) => !chat.archivedAt);
  if (wanted && live.some((chat) => chat.id === wanted)) return wanted;
  return live[0]?.id ?? null;
}

/**
 * Coerce a persisted `workspaces` array into the shapes the app relies on.
 *
 * Exported for the persistence test: this is the whole "load" half of the
 * save/load/restore round trip, and the rules it enforces (archived chats are
 * not active, an unknown active chat becomes null rather than inventing one) are
 * exactly what a stale state file gets wrong.
 */
export function normalize(raw: unknown): WorkspaceEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: WorkspaceEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Partial<WorkspaceEntry>;
    if (typeof entry.path !== "string" || !entry.path.trim()) continue;
    const chats: ChatEntry[] = Array.isArray(entry.chats)
      ? entry.chats
          .filter((chat): chat is ChatEntry => Boolean(chat) && typeof chat.id === "string")
          .map((chat) => ({
            id: chat.id,
            name: typeof chat.name === "string" && chat.name ? chat.name : "新会话",
            sessionFile: typeof chat.sessionFile === "string" ? chat.sessionFile : null,
            createdAt: typeof chat.createdAt === "number" ? chat.createdAt : Date.now(),
            // Absent in state files written before archiving existed.
            archivedAt: typeof chat.archivedAt === "number" ? chat.archivedAt : null,
            // Absent in state files written before per-chat skills existed; and
            // a value that is not a boolean is not a switch position.
            skills: skillState(chat.skills),
          }))
      : [];
    out.push({
      path: entry.path,
      name: typeof entry.name === "string" && entry.name ? entry.name : baseName(entry.path),
      chats,
      activeChat: resolveActiveChat(
        chats,
        typeof entry.activeChat === "string" ? entry.activeChat : null,
      ),
    });
  }
  return out;
}

export function useWorkspaces() {
  const [workspaces, setWorkspaces] = useState<WorkspaceEntry[]>([]);
  const [activePath, setActivePathState] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  /** Non-null when the index could not be read or had to be recovered. */
  const [stateWarning, setStateWarning] = useState<string | null>(null);
  const hydrated = useRef(false);

  /** Mirrors `workspaces`, so a mutation never rebuilds from a stale snapshot. */
  const listRef = useRef<WorkspaceEntry[]>([]);
  const pathRef = useRef<string | null>(null);
  /**
   * True when the initial read failed.
   *
   * A failed read means the on-disk index was never seen, so writing would
   * replace whatever is there with a list built from nothing. Edits still apply
   * in memory; they just never reach the disk on their own.
   */
  const readFailed = useRef(false);

  const setActivePath = useCallback((path: string | null) => {
    pathRef.current = path;
    setActivePathState(path);
  }, []);

  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    void (async () => {
      try {
        const [state, lastWorkdir]: [AppStateDocument, string | null] = await Promise.all([
          configApi.stateRead(),
          configApi.lastWorkdir().catch(() => null),
        ]);
        if (typeof state.recoveredFrom === "string" && state.recoveredFrom) {
          setStateWarning(
            `会话索引文件无法解析，已原样备份到 ${state.recoveredFrom}，本次以空索引启动（pi 的会话文件都没有被改动）。`,
          );
        }
        const list = normalize(state.workspaces);
        listRef.current = list;
        setWorkspaces(list);
        const preferred =
          (lastWorkdir && list.some((w) => w.path === lastWorkdir) ? lastWorkdir : null) ??
          list[0]?.path ??
          null;
        pathRef.current = preferred;
        setActivePathState(preferred);
      } catch (error) {
        // Deliberately does not pretend the index is empty: `readFailed` keeps
        // this session read-only so a transient read error cannot wipe the file.
        readFailed.current = true;
        setStateWarning(
          `读取会话索引失败（${String(error)}）。为避免覆盖磁盘上的文件，本次不会写入索引；重启 APIX 后再试。`,
        );
        listRef.current = [];
        setWorkspaces([]);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  /**
   * Apply a mutation and persist it.
   *
   * Returns the write, so a caller that must be durable before it proceeds can
   * await it — `bindSession` on the path that is about to send the first
   * message, for instance. Callers that do not care simply ignore it.
   */
  const commit = useCallback(
    (updater: (current: WorkspaceEntry[]) => WorkspaceEntry[]): Promise<void> => {
      const next = updater(listRef.current);
      listRef.current = next;
      setWorkspaces(next);
      if (readFailed.current) return Promise.resolve();
      return configApi.writeWorkspaces(next).then(
        () => undefined,
        () => undefined, // the in-memory list stays usable when the write fails
      );
    },
    [],
  );

  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.path === activePath) ?? workspaces[0] ?? null,
    [workspaces, activePath],
  );

  const activeChat = useMemo(() => {
    if (!activeWorkspace) return null;
    return activeWorkspace.chats.find((c) => c.id === activeWorkspace.activeChat) ?? null;
  }, [activeWorkspace]);

  /** Every archived chat, flattened with its workspace, for the settings list. */
  const archivedChats = useMemo<ArchivedChat[]>(() => {
    const out: ArchivedChat[] = [];
    for (const workspace of workspaces) {
      for (const chat of workspace.chats) {
        if (!chat.archivedAt) continue;
        out.push({ workspacePath: workspace.path, workspaceName: workspace.name, chat });
      }
    }
    return out;
  }, [workspaces]);

  /** Add a workspace (idempotent) and return the resulting entry. */
  const addWorkspace = useCallback(
    (path: string, name?: string): WorkspaceEntry | null => {
      const trimmed = path.trim();
      if (!trimmed) return null;
      const existing = listRef.current.find((w) => w.path === trimmed);
      if (existing) {
        setActivePath(trimmed);
        return existing;
      }
      const entry = newWorkspace(trimmed, name);
      commit((current) => [...current, entry]);
      setActivePath(trimmed);
      return entry;
    },
    [commit, setActivePath],
  );

  const removeWorkspace = useCallback(
    (path: string) => {
      commit((current) => current.filter((w) => w.path !== path));
      if (pathRef.current === path) {
        const next = listRef.current.find((w) => w.path !== path);
        setActivePath(next?.path ?? null);
      }
    },
    [commit, setActivePath],
  );

  const renameWorkspace = useCallback(
    (path: string, name: string) => {
      commit((current) =>
        current.map((w) => (w.path === path ? { ...w, name: name.trim() || baseName(path) } : w)),
      );
    },
    [commit],
  );

  const addChat = useCallback(
    (workspacePath: string): ChatEntry => {
      const chat = newChat();
      commit((current) =>
        current.map((w) =>
          w.path === workspacePath ? { ...w, chats: [chat, ...w.chats], activeChat: chat.id } : w,
        ),
      );
      return chat;
    },
    [commit],
  );

  const selectChat = useCallback(
    (workspacePath: string, chatId: string) => {
      commit((current) =>
        current.map((w) => (w.path === workspacePath ? { ...w, activeChat: chatId } : w)),
      );
    },
    [commit],
  );

  const renameChat = useCallback(
    (workspacePath: string, chatId: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      commit((current) =>
        current.map((w) =>
          w.path === workspacePath
            ? { ...w, chats: w.chats.map((c) => (c.id === chatId ? { ...c, name: trimmed } : c)) }
            : w,
        ),
      );
    },
    [commit],
  );

  /**
   * Remove a chat. Removing the last one leaves the workspace genuinely empty —
   * no replacement is invented, so the rail shows nothing under it and the pane
   * falls back to the new-session view.
   */
  const removeChat = useCallback(
    (workspacePath: string, chatId: string) => {
      commit((current) =>
        current.map((w) => {
          if (w.path !== workspacePath) return w;
          const remaining = w.chats.filter((c) => c.id !== chatId);
          const live = remaining.filter((c) => !c.archivedAt);
          return {
            ...w,
            chats: remaining,
            activeChat: w.activeChat === chatId ? (live[0]?.id ?? null) : w.activeChat,
          };
        }),
      );
    },
    [commit],
  );

  /**
   * Move a chat out of the rail without touching its session file.
   *
   * Handing the pane to a sibling keeps the rail highlight and the transcript in
   * agreement; when there is no sibling left, `activeChat` becomes null and the
   * workspace goes back to showing nothing — the caller clears the pane.
   */
  const archiveChat = useCallback(
    (workspacePath: string, chatId: string) => {
      const at = Date.now();
      commit((current) =>
        current.map((w) => {
          if (w.path !== workspacePath) return w;
          const chats = w.chats.map((c) => (c.id === chatId ? { ...c, archivedAt: at } : c));
          const live = chats.filter((c) => !c.archivedAt);
          return {
            ...w,
            chats,
            activeChat: w.activeChat === chatId ? (live[0]?.id ?? null) : w.activeChat,
          };
        }),
      );
    },
    [commit],
  );

  /** Bring an archived chat back into the rail. */
  const unarchiveChat = useCallback(
    (workspacePath: string, chatId: string) => {
      commit((current) =>
        current.map((w) =>
          w.path === workspacePath
            ? {
                ...w,
                chats: w.chats.map((c) => (c.id === chatId ? { ...c, archivedAt: null } : c)),
              }
            : w,
        ),
      );
    },
    [commit],
  );

  /**
   * Record which pi session file a chat maps to.
   *
   * Returns the write so the caller can wait for it: the binding has to be on
   * disk before the first message is sent, otherwise quitting between the two
   * loses the only pointer to that conversation.
   */
  const bindSession = useCallback(
    (workspacePath: string, chatId: string, sessionFile: string): Promise<void> => {
      return commit((current) =>
        current.map((w) =>
          w.path === workspacePath
            ? {
                ...w,
                chats: w.chats.map((c) => (c.id === chatId ? { ...c, sessionFile } : c)),
              }
            : w,
        ),
      );
    },
    [commit],
  );

  /**
   * Set one skill's switch for a conversation.
   *
   * Written as an explicit boolean, including `false`: "off here" has to be
   * recorded, otherwise the skill would fall back to its global default.
   */
  const setChatSkill = useCallback(
    (workspacePath: string, chatId: string, key: string, on: boolean) => {
      commit((current) =>
        current.map((w) =>
          w.path === workspacePath
            ? {
                ...w,
                chats: w.chats.map((c) =>
                  c.id === chatId ? { ...c, skills: { ...c.skills, [key]: on } } : c,
                ),
              }
            : w,
        ),
      );
    },
    [commit],
  );

  /**
   * Drop a conversation's own switch, so the skill goes back to its default.
   *
   * Only used for skills the user added by hand — a global skill's row comes
   * from Settings and is removed there, not here.
   */
  const forgetChatSkill = useCallback(
    (workspacePath: string, chatId: string, key: string) => {
      commit((current) =>
        current.map((w) => {
          if (w.path !== workspacePath) return w;
          return {
            ...w,
            chats: w.chats.map((c) => {
              if (c.id !== chatId) return c;
              const next = { ...c.skills };
              delete next[key];
              return { ...c, skills: next };
            }),
          };
        }),
      );
    },
    [commit],
  );

  return {
    loaded,
    /** Non-null when the index was recovered or could not be read. */
    stateWarning,
    workspaces,
    activePath,
    setActivePath,
    activeWorkspace,
    activeChat,
    archivedChats,
    addWorkspace,
    removeWorkspace,
    renameWorkspace,
    addChat,
    selectChat,
    renameChat,
    removeChat,
    archiveChat,
    unarchiveChat,
    setChatSkill,
    forgetChatSkill,
    bindSession,
  };
}
