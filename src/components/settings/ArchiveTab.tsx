/**
 * Archived sessions: the list behind Settings → 已归档会话.
 *
 * Archiving is APIX's own bookkeeping (see `ChatEntry.archivedAt`), so this page
 * only reads the index it is handed — it holds no state of its own beyond the
 * sort direction and the pending delete confirmation. The table, card, empty
 * state and icon buttons are the same primitives the Skills page uses, so the
 * two lists look and behave identically.
 */

import { useMemo, useState } from "react";

import type { ArchivedChat } from "../../lib/configBridge";
import { formatStamp } from "../../lib/duration";
import { IconArchive, IconRefresh, IconTriangleRight, IconTrash } from "../ui/Icons";
import { Card, CardBody, CardFooter, CardHeader, EmptyState, IconButton } from "../ui/kit";
import { Tooltip } from "../ui/Tooltip";

export function ArchiveTab({
  archived,
  onUnarchive,
  onRemove,
}: {
  archived: ArchivedChat[];
  onUnarchive: (workspacePath: string, chatId: string) => void;
  onRemove: (workspacePath: string, chatId: string) => void;
}) {
  /** Newest first by default: the chat you just put away is the one you want back. */
  const [descending, setDescending] = useState(true);
  const [confirming, setConfirming] = useState<string | null>(null);

  const rows = useMemo(() => {
    const sorted = [...archived].sort(
      (a, b) => (a.chat.archivedAt ?? 0) - (b.chat.archivedAt ?? 0),
    );
    return descending ? sorted.reverse() : sorted;
  }, [archived, descending]);

  const orderLabel = descending ? "归档时间 新→旧" : "归档时间 旧→新";

  return (
    <Card>
      <CardHeader
        title="已归档会话"
        description="归档只是把会话从左侧列表收起来：pi 的会话记录仍在磁盘上，随时可以恢复到侧栏继续对话。"
        action={
          <Tooltip
            label={`当前按${orderLabel}排序，点击切换为${
              descending ? "归档时间 旧→新" : "归档时间 新→旧"
            }`}
          >
            <button
              className="btn btn-ghost"
              type="button"
              disabled={archived.length === 0}
              aria-label={`排序：${orderLabel}（点击切换）`}
              onClick={() => setDescending((value) => !value)}
            >
              <IconTriangleRight
                size={10}
                className={`sort-arrow${descending ? " is-desc" : ""}`}
              />
              {orderLabel}
            </button>
          </Tooltip>
        }
      />
      <CardBody flush={rows.length > 0}>
        {rows.length === 0 ? (
          <EmptyState
            icon={<IconArchive size={22} />}
            title="没有已归档的会话"
            description="在左侧列表把鼠标移到某个会话上，点归档图标即可把它收起来；它不会出现在这里之前，也不会被删除。"
          />
        ) : (
          <table className="dtable">
            <thead>
              <tr>
                <th>会话</th>
                <th style={{ width: 152 }}>归档时间</th>
                <th style={{ width: 88 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ workspacePath, workspaceName, chat }) => {
                const key = `${workspacePath}/${chat.id}`;
                return (
                  <tr key={key}>
                    <td>
                      <div className="cell-strong">{chat.name}</div>
                      <div className="cell-sub">{workspaceName}</div>
                    </td>
                    <td className="cell-num">{formatStamp(chat.archivedAt ?? 0)}</td>
                    <td>
                      <div className="row-actions">
                        {confirming === key ? (
                          <>
                            <button
                              className="btn btn-danger"
                              type="button"
                              onClick={() => {
                                setConfirming(null);
                                onRemove(workspacePath, chat.id);
                              }}
                            >
                              确认移除
                            </button>
                            <button
                              className="btn btn-ghost"
                              type="button"
                              onClick={() => setConfirming(null)}
                            >
                              取消
                            </button>
                          </>
                        ) : (
                          <>
                            <Tooltip label="恢复到左侧列表，可以继续对话">
                              <button
                                className="btn btn-ghost"
                                type="button"
                                onClick={() => onUnarchive(workspacePath, chat.id)}
                              >
                                <IconRefresh size={13} />
                                恢复
                              </button>
                            </Tooltip>
                            <IconButton
                              title="从索引移除（不删 pi 的会话文件）"
                              tone="danger"
                              onClick={() => setConfirming(key)}
                            >
                              <IconTrash size={13} />
                            </IconButton>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardBody>
      <CardFooter>
        <span className="inline-status">
          共 {archived.length} 个已归档会话 · 归档时间格式为 本地时间 YYYY-MM-DD HH:mm
        </span>
        <span className="spacer" />
        <span className="inline-status">
          「移除」只清掉 APIX 索引里的这一条，pi 的会话文件不受影响
        </span>
      </CardFooter>
    </Card>
  );
}
