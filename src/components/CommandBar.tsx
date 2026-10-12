import { HANDOFF_SKILL_ID, type HandoffPhase } from "../hooks/useHandoff";
import { Tooltip } from "./ui/Tooltip";

/**
 * The custom-command strip that sits where the toolbar buttons used to be.
 *
 * One command for now — 压缩上下文 — but built as a list so more can be dropped
 * in. The button reads state from the outside rather than deciding anything
 * itself: `hot` means the context meter is in its warning band, and the
 * cooling animation is a nudge that this is the thing to press.
 */
export function CommandBar({
  phase,
  hot,
  disabled,
  disabledReason,
  onCompact,
}: {
  phase: HandoffPhase;
  /** Context usage crossed the warning threshold. */
  hot: boolean;
  disabled: boolean;
  /** Shown instead of the usual hint while `disabled`, so it is not a dead button. */
  disabledReason?: string;
  onCompact: () => void;
}) {
  const running = phase === "running";

  return (
    <div className="command-bar">
      <Tooltip
        wide
        label={
          running
            ? "交接进行中：整理文件 → 写交接文档 → 输出首轮提示词，完成后自动压缩"
            : disabled
              ? (disabledReason ?? "暂时不可用")
              : hot
                ? "上下文用量已偏高。先整理工作区并写交接文档，确认无误后再压缩"
                : "先整理工作区并写交接文档，确认无误后再压缩上下文"
        }
      >
        <button
          className={`cmd-btn${hot ? " is-hot" : ""}${running ? " is-running" : ""}`}
          type="button"
          disabled={disabled || running}
          onClick={onCompact}
        >
          {running ? "交接中…" : "压缩上下文"}
        </button>
      </Tooltip>
      <span className="cmd-hint">{running ? "完成后自动压缩" : null}</span>
      {/* Keeps the skill id discoverable without cluttering the button. */}
      <span className="sr-only">{HANDOFF_SKILL_ID}</span>
    </div>
  );
}
