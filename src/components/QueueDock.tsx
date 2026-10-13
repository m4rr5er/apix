import { useState } from "react";

import { flattenQueue, type QueueKind } from "../lib/queue";
import { IconChevronDown, IconChevronRight, IconPencil, IconSpark, IconStack, IconTrash } from "./ui/Icons";
import { IconButton } from "./ui/kit";
import { Tooltip } from "./ui/Tooltip";

/**
 * Queued work, docked just above the composer.
 *
 * These are the messages you sent while pi was already running — showing them
 * next to the input is where you look when you wonder whether something got
 * picked up. Hidden entirely when nothing is queued, and collapsed to a count
 * as soon as there is more than one, so a busy queue never pushes the input
 * box off screen.
 *
 * Every row carries three actions, because a queued message is a thought you
 * can still change your mind about: 立即插入 injects it as a steering message
 * (it lands before the next model call, without interrupting what is running),
 * 编辑 pulls it back into the composer, 删除 drops it. pi has no per-item
 * queue command, so all three go through `queueOp` — clear, requeue the rest,
 * act on the one.
 */
export function QueueDock({
  steering,
  followUp,
  onInject,
  onEdit,
  onDelete,
}: {
  steering: string[];
  followUp: string[];
  onInject: (kind: QueueKind, index: number) => void;
  onEdit: (kind: QueueKind, index: number) => void;
  onDelete: (kind: QueueKind, index: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const tasks = flattenQueue(steering, followUp);
  if (tasks.length === 0) return null;

  const collapsible = tasks.length > 1;
  const open = !collapsible || expanded;

  return (
    <section className="queue-dock">
      <button
        className="queue-dock-head"
        type="button"
        disabled={!collapsible}
        aria-expanded={open}
        onClick={() => setExpanded((value) => !value)}
      >
        <IconStack size={12} />
        <span className="queue-dock-title">
          {tasks.length} 条待处理
        </span>
        {collapsible ? (
          <span className="queue-dock-chevron">
            {expanded ? <IconChevronDown size={11} /> : <IconChevronRight size={11} />}
          </span>
        ) : null}
      </button>

      {open ? (
        <ul className="queue-dock-list">
          {tasks.map((task, index) => (
            <li className="queue-dock-item" key={`${task.kind}-${index}`}>
              <span className={`queue-tag queue-tag-${task.kind}`}>
                {task.kind === "steer" ? "追加" : "排队"}
              </span>
              <span className="queue-dock-text">{task.text}</span>
              <span className="queue-dock-actions">
                <Tooltip label="立即插入（下一次模型调用前生效，不打断当前动作）">
                  <IconButton
                    title={`立即插入 ${task.text.slice(0, 20)}`}
                    onClick={() => onInject(task.kind, index)}
                  >
                    <IconSpark size={12} />
                  </IconButton>
                </Tooltip>
                <Tooltip label="取回编辑（其余队列保持不动）">
                  <IconButton
                    title={`编辑这条追加 ${index}`}
                    onClick={() => onEdit(task.kind, index)}
                  >
                    <IconPencil size={12} />
                  </IconButton>
                </Tooltip>
                <Tooltip label="删除这条，不再处理">
                  <IconButton
                    title={`删除这条追加 ${index}`}
                    onClick={() => onDelete(task.kind, index)}
                  >
                    <IconTrash size={12} />
                  </IconButton>
                </Tooltip>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
