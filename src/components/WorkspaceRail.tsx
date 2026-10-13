/**
 * Left rail: one grouped tree of workspaces and their sessions.
 *
 * Structure and metrics follow dsh's workspace browser
 * (`packages/client/ui-workspace/src/client/rows/`):
 *
 *   - one section per workspace: a 34px header row, then its session rows at
 *     32px, each row separated by 2px and each section by 4px;
 *   - every row shares a 16px leading slot, so a header's folder glyph and a
 *     session's state dot line up in the same column;
 *   - roaming over the header swaps its folder for the expand arrow (in place,
 *     so nothing shifts), and the trailing actions only appear on hover or
 *     while that row's menu is open;
 *   - session rows sit one nesting step (12px) in from their workspace, which
 *     is the reference's own group indent, so the hierarchy reads as a tree.
 *
 * Behaviour is unchanged from the previous two-section rail: a workspace is a
 * directory (pi's cwd), so selecting one restarts the engine there; a session
 * maps to a pi session file, so selecting one resumes it.
 */

import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import type { WorkspaceEntry } from "../lib/configBridge";
import { liveChats } from "../hooks/useWorkspaces";
import {
  IconArchive,
  IconClose,
  IconFolder,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconTriangleRight,
} from "./ui/Icons";
import { IconButton } from "./ui/kit";
import { Tooltip } from "./ui/Tooltip";

/** Per-workspace expanded state, so a collapse survives a restart. */
const GROUPS_KEY = "apix.rail.groups";

function readExpanded(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(GROUPS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

/** What a row is currently being renamed, if any. */
type RenameTarget = { kind: "workspace" | "chat"; path: string; id: string };

export function WorkspaceRail({
  workspaces,
  activePath,
  activeChatId,
  backgroundBusy,
  engineRunning,
  onAddWorkspace,
  onSelectWorkspace,
  onRemoveWorkspace,
  onRenameWorkspace,
  onAddChat,
  onSelectChat,
  onRenameChat,
  onRemoveChat,
  onArchiveChat,
  onOpenSettings,
  onRestartEngine,
}: {
  workspaces: WorkspaceEntry[];
  activePath: string | null;
  activeChatId: string | null;
  /** Chat ids whose engine is mid-turn while off screen. */
  backgroundBusy: string[];
  engineRunning: boolean;
  onAddWorkspace: (path: string) => void;
  onSelectWorkspace: (path: string) => void;
  onRemoveWorkspace: (path: string) => void;
  onRenameWorkspace: (path: string, name: string) => void;
  onAddChat: (workspacePath: string) => void;
  onSelectChat: (workspacePath: string, chatId: string) => void;
  onRenameChat: (workspacePath: string, chatId: string, name: string) => void;
  onRemoveChat: (workspacePath: string, chatId: string) => void;
  /** Move a chat out of the rail; it stays under Settings → 已归档会话. */
  onArchiveChat: (workspacePath: string, chatId: string) => void;
  onOpenSettings: () => void;
  onRestartEngine: () => void;
}) {
  // Absent means expanded; only a deliberate collapse is stored.
  const [expanded, setExpanded] = useState<Record<string, boolean>>(readExpanded);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualPath, setManualPath] = useState("");
  const [pickError, setPickError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<RenameTarget | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    try {
      window.localStorage.setItem(GROUPS_KEY, JSON.stringify(expanded));
    } catch {
      /* collapse state is a convenience; losing it is harmless */
    }
  }, [expanded]);

  const isOpen = (path: string) => expanded[path] !== false;

  /**
   * Toggling a header also makes that workspace current, because pi's cwd is
   * the workspace — the previous rail switched on click, and losing that would
   * take away the only way to move the engine to a workspace with no sessions.
   */
  const toggleGroup = (workspace: WorkspaceEntry) => {
    if (workspace.path !== activePath) onSelectWorkspace(workspace.path);
    setExpanded((current) => ({ ...current, [workspace.path]: isOpen(workspace.path) ? false : true }));
  };

  const beginRename = (target: RenameTarget, value: string) => {
    setDraft(value);
    setRenaming(target);
  };

  const commitRename = () => {
    const target = renaming;
    setRenaming(null);
    if (!target) return;
    const next = draft.trim();
    if (!next) return;
    const workspace = workspaces.find((entry) => entry.path === target.path);
    if (!workspace) return;
    if (target.kind === "workspace") {
      if (next !== workspace.name) onRenameWorkspace(target.path, next);
      return;
    }
    const chat = workspace.chats.find((entry) => entry.id === target.id);
    if (chat && next !== chat.name) onRenameChat(target.path, target.id, next);
  };

  const pickFolder = async () => {
    setPickError(null);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择工作区目录",
      });
      if (typeof selected === "string" && selected) {
        onAddWorkspace(selected);
        setManualOpen(false);
      }
    } catch (error) {
      setPickError(String(error));
      setManualOpen(true);
    }
  };

  const addManual = () => {
    const path = manualPath.trim();
    if (path) onAddWorkspace(path);
    setManualPath("");
    setManualOpen(false);
  };

  const renameInput = (className: string) => (
    <input
      className={className}
      autoFocus
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commitRename}
      onKeyDown={(event) => {
        if (event.key === "Enter") commitRename();
        if (event.key === "Escape") setRenaming(null);
      }}
    />
  );

  return (
    <aside className="rail">
      <div className="rail-head">
        <span className="rail-section-label">工作区</span>
        <span className="spacer" />
        <IconButton title="选择目录添加工作区" onClick={() => void pickFolder()}>
          <IconPlus size={13} />
        </IconButton>
      </div>

      <div className="rail-list" role="tree" aria-label="工作区与会话">
        {workspaces.map((workspace) => {
          const isActive = workspace.path === activePath;
          const open = isOpen(workspace.path);
          // Archived chats are not rail content; they live under Settings.
          const chats = liveChats(workspace);
          const renamingWorkspace =
            renaming?.kind === "workspace" && renaming.path === workspace.path;
          return (
            <div className="rail-group" key={workspace.path}>
              <div
                className={`rail-group-head${isActive ? " is-active" : ""}${
                  renamingWorkspace ? " is-renaming" : ""
                }`}
                role="treeitem"
                aria-expanded={open}
                aria-selected={isActive}
                onClick={() => {
                  if (!renamingWorkspace) toggleGroup(workspace);
                }}
              >
                <span className="rail-slot rail-folder" aria-hidden="true">
                  <IconFolder size={14} />
                </span>
                <span className="rail-slot rail-arrow" aria-hidden="true">
                  <IconTriangleRight
                    size={10}
                    className={`rail-arrow-glyph${open ? " is-open" : ""}`}
                  />
                </span>
                {renamingWorkspace ? (
                  renameInput("rail-input rail-rename")
                ) : (
                  <Tooltip label={workspace.path} side="right" delay={500}>
                    <span
                      className="rail-group-title"
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        beginRename(
                          { kind: "workspace", path: workspace.path, id: workspace.path },
                          workspace.name,
                        );
                      }}
                    >
                      {workspace.name}
                    </span>
                  </Tooltip>
                )}
                <span className="rail-row-actions" onClick={(event) => event.stopPropagation()}>
                  <IconButton
                    title={`重命名工作区 ${workspace.name}`}
                    onClick={() =>
                      beginRename(
                        { kind: "workspace", path: workspace.path, id: workspace.path },
                        workspace.name,
                      )
                    }
                  >
                    <IconPencil size={12} />
                  </IconButton>
                  <IconButton
                    title={`移除工作区 ${workspace.name}`}
                    tone="danger"
                    onClick={() => onRemoveWorkspace(workspace.path)}
                  >
                    <IconClose size={12} />
                  </IconButton>
                  <IconButton
                    title={`在 ${workspace.name} 新建会话`}
                    disabled={!engineRunning}
                    onClick={() => onAddChat(workspace.path)}
                  >
                    <IconPlus size={12} />
                  </IconButton>
                </span>
              </div>

              {open ? (
                /* A workspace with no sessions renders nothing here, the way dsh
                   leaves a newly added workspace bare — the header's "+" is what
                   creates the first one. The wrapper stays mounted either way:
                   it carries the nesting indent every session row reads. */
                <div className="rail-sessions" role="group">
                  {chats.map((chat) => {
                    const renamingChat =
                      renaming?.kind === "chat" &&
                      renaming.path === workspace.path &&
                      renaming.id === chat.id;
                    if (renamingChat) {
                      return (
                        <div className="rail-chat is-renaming" key={chat.id}>
                          <span className="rail-slot rail-dot" aria-hidden="true" />
                          {renameInput("rail-input rail-rename")}
                        </div>
                      );
                    }
                    return (
                      <div
                        className={`rail-chat${
                          chat.id === activeChatId && isActive ? " is-active" : ""
                        }`}
                        role="treeitem"
                        aria-selected={chat.id === activeChatId && isActive}
                        key={chat.id}
                        onClick={() => onSelectChat(workspace.path, chat.id)}
                      >
                        <span
                          className={`rail-slot rail-dot${
                            backgroundBusy.includes(chat.id) ? " is-running" : ""
                          }`}
                          aria-hidden="true"
                          title={
                            backgroundBusy.includes(chat.id)
                              ? "这个会话正在后台运行，pi 的回合没有被打断"
                              : undefined
                          }
                        >
                          <span className="rail-dot-glyph" />
                        </span>
                        <span
                          className="rail-chat-title"
                          onDoubleClick={(event) => {
                            event.stopPropagation();
                            beginRename(
                              { kind: "chat", path: workspace.path, id: chat.id },
                              chat.name,
                            );
                          }}
                        >
                          {chat.name}
                        </span>
                        {/* Same slot the actions take over on hover: a session
                            that cannot be resumed is worth saying out loud. */}
                        {chat.sessionFile ? null : (
                          <span className="rail-chat-meta">未绑定</span>
                        )}
                        <span
                          className="rail-row-actions"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <IconButton
                            title={`重命名会话 ${chat.name}`}
                            onClick={() =>
                              beginRename(
                                { kind: "chat", path: workspace.path, id: chat.id },
                                chat.name,
                              )
                            }
                          >
                            <IconPencil size={12} />
                          </IconButton>
                          <IconButton
                            title={`归档会话 ${chat.name}（不删除记录，可在设置里找回）`}
                            onClick={() => onArchiveChat(workspace.path, chat.id)}
                          >
                            <IconArchive size={12} />
                          </IconButton>
                          <IconButton
                            title="从列表移除（不删 pi 的会话文件）"
                            tone="danger"
                            onClick={() => onRemoveChat(workspace.path, chat.id)}
                          >
                            <IconClose size={12} />
                          </IconButton>
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}

        {workspaces.length === 0 ? (
          <p className="rail-empty">还没有工作区。点右上角 + 选一个目录。</p>
        ) : null}
      </div>

      {manualOpen ? (
        <div className="rail-manual">
          <input
            className="rail-input"
            placeholder="C:\\projects\\my-app"
            value={manualPath}
            onChange={(event) => setManualPath(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") addManual();
            }}
          />
          <div className="rail-manual-actions">
            <button className="btn btn-ghost" type="button" onClick={addManual}>
              添加
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setManualOpen(false)}>
              取消
            </button>
          </div>
        </div>
      ) : (
        <button className="rail-link" type="button" onClick={() => setManualOpen(true)}>
          手动输入路径
        </button>
      )}
      {pickError ? <p className="rail-error">{pickError}</p> : null}

      <div className="rail-foot">
        <button className="rail-foot-item" type="button" onClick={onOpenSettings}>
          设置
        </button>
        <IconButton title="重启引擎" onClick={onRestartEngine}>
          <IconRefresh size={14} />
        </IconButton>
      </div>
    </aside>
  );
}
