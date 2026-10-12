import type { ReactNode } from "react";

/**
 * Toolbar — a title bar plus the custom-command strip.
 *
 * The old action buttons moved where they belong: 新会话 to the rail's "+",
 * 设置 to the rail footer, 重启引擎 next to it. 重载 and 事件流 were dropped
 * outright. What is left on the right is user-facing commands, not plumbing.
 */
export function Toolbar({
  workspaceName,
  chatName,
  settingsOpen,
  actions,
}: {
  workspaceName: string | null;
  chatName: string | null;
  settingsOpen: boolean;
  actions?: ReactNode;
}) {
  return (
    <header className="toolbar">
      {settingsOpen ? (
        <div className="crumbs">
          <span className="crumb crumb-active">设置</span>
        </div>
      ) : (
        <div className="crumbs">
          <span className="crumb">{workspaceName ?? "未选择工作区"}</span>
          <span className="crumb-sep">/</span>
          <span className="crumb crumb-active">{chatName ?? "—"}</span>
        </div>
      )}

      {settingsOpen ? null : <div className="toolbar-actions">{actions}</div>}
    </header>
  );
}
