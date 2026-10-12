import { useState } from "react";

import { IconChevronDown, IconChevronRight, IconStack } from "./ui/Icons";

export interface QueuedTask {
  kind: "steer" | "follow-up";
  text: string;
}

const KIND_LABEL: Record<QueuedTask["kind"], string> = {
  steer: "追加",
  "follow-up": "排队",
};

/**
 * Queued work, docked just above the composer.
 *
 * These are the messages you sent while pi was already running — showing them
 * next to the input is where you look when you wonder whether something got
 * picked up. Hidden entirely when nothing is queued, and collapsed to a count
 * as soon as there is more than one, so a busy queue never pushes the input
 * box off screen.
 */
export function QueueDock({
  steering,
  followUp,
}: {
  steering: string[];
  followUp: string[];
}) {
  const [expanded, setExpanded] = useState(false);

  const tasks: QueuedTask[] = [
    ...steering.map((text): QueuedTask => ({ kind: "steer", text })),
    ...followUp.map((text): QueuedTask => ({ kind: "follow-up", text })),
  ];

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
                {KIND_LABEL[task.kind]}
              </span>
              <span className="queue-dock-text">{task.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
