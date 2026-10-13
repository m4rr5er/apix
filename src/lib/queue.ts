/**
 * The queue dock's arithmetic, kept apart from React so it can be run in tests.
 *
 * pi exposes no per-item queue command: `clear_queue` empties the whole queue
 * and hands everything back, and `steer`/`follow_up` put one message at the
 * tail of its bucket. So every per-item operation — inject now, edit, delete —
 * is the same three steps: take the whole queue out, remove the one item, and
 * requeue the rest in their original buckets. The removed text then either
 * goes straight back as a steering message (inject), into the composer
 * (edit), or nowhere (delete).
 *
 * The flat list is what the dock shows: steering first (they land before the
 * next model call), then follow-ups (they wait for the turn to end). The
 * indexes the UI passes are indexes into that same list.
 */

export type QueueKind = "steer" | "follow-up";

export interface QueuedTask {
  kind: QueueKind;
  text: string;
}

/** The dock's display order: all steering, then all follow-ups. */
export function flattenQueue(steering: string[], followUp: string[]): QueuedTask[] {
  return [
    ...steering.map((text): QueuedTask => ({ kind: "steer", text })),
    ...followUp.map((text): QueuedTask => ({ kind: "follow-up", text })),
  ];
}

/**
 * Pull one task out of the flat list.
 *
 * `target` is null when the index no longer exists — pi consumed something at
 * a turn boundary between the UI render and the `clear_queue` landing. The
 * caller must then requeue `rest` untouched and tell the user, never drop it.
 */
export function removeTask(
  tasks: QueuedTask[],
  kind: QueueKind,
  index: number,
): { target: QueuedTask | null; rest: QueuedTask[] } {
  const at = tasks.findIndex((task, i) => i === index && task.kind === kind);
  if (at < 0) return { target: null, rest: tasks };
  const target = tasks[at];
  const rest = [...tasks.slice(0, at), ...tasks.slice(at + 1)];
  return { target, rest };
}

/** Requeue commands, in order, each back into its own bucket. */
export function requeueCommands(
  rest: QueuedTask[],
): Array<{ type: "steer" | "follow_up"; message: string }> {
  return rest.map((task) => ({
    type: task.kind === "steer" ? "steer" : "follow_up",
    message: task.text,
  }));
}
