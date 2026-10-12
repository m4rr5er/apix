import { cacheHitRate, formatTokens, tokenShorthand, type SessionStats } from "../lib/protocol";
import { Tooltip } from "./ui/Tooltip";

/** Context usage at or above this share turns the meter hot. */
export const CONTEXT_HEAT_THRESHOLD = 70;

/**
 * Status bar.
 *
 * Deliberately does not repeat what is already on screen: the workspace path
 * lives in the rail and the model lives in the composer. What is left is what
 * those two cannot show — how full the context is, how much of the prompt is
 * being served from cache, and what the session has cost so far.
 *
 * The context reading comes straight from pi's `get_session_stats`, so the
 * total is the window the *running model* actually reports — set
 * `contextWindow: 1000000` on the model in Settings and the denominator becomes
 * 1M. `tokens` is null right after a compaction, before the next response
 * reports usage, and is shown as `—` rather than a misleading zero.
 */
export function StatusBar({
  stats,
  busy,
  model,
}: {
  stats: SessionStats | null;
  busy: boolean;
  /** Shown in the meter tooltip so the reading can be attributed. */
  model?: string | null;
}) {
  const usage = stats?.contextUsage;
  const percent = typeof usage?.percent === "number" ? usage.percent : null;
  const clamped = percent === null ? 0 : Math.min(100, Math.max(0, percent));
  const hot = percent !== null && percent >= CONTEXT_HEAT_THRESHOLD;
  const rate = cacheHitRate(stats?.tokens);
  const cost = typeof stats?.cost === "number" ? stats.cost : null;
  const used = typeof usage?.tokens === "number" ? usage.tokens : null;

  const meterTip = usage
    ? used === null
      ? `上下文用量未知（刚压缩过，等下一次回复才报数）\n窗口 ${usage.contextWindow.toLocaleString()} tokens`
      : [
          `已用 ${used.toLocaleString()} / ${usage.contextWindow.toLocaleString()} tokens`,
          `${Math.round(clamped)}%${hot ? " · 已偏高，建议先做上下文交接" : ""}`,
          model ? `模型 ${model}` : null,
        ]
          .filter(Boolean)
          .join("\n")
    : "pi 还没有报告上下文用量";

  return (
    <footer className="statusbar">
      <Tooltip label={meterTip} wide>
        <span className={`meter${hot ? " is-hot" : ""}`}>
          <span className="meter-track">
            <span
              className="meter-fill"
              style={{ width: `${used === null ? 0 : clamped}%` }}
            />
          </span>
          <span className="meter-value">
            {usage
              ? `${used === null ? "—" : formatTokens(used)} / ${tokenShorthand(usage.contextWindow)}`
              : "—"}
          </span>
        </span>
      </Tooltip>

      {rate !== null ? (
        <Tooltip label="提示词缓存命中率：越高越省 token、首字越快" wide>
          <span className="status-item">
            缓存命中 <b>{Math.round(rate * 100)}%</b>
          </span>
        </Tooltip>
      ) : null}

      <span className="spacer" />

      <Tooltip label="本会话累计输入 / 输出 token" wide>
        <span className="status-item status-num">
          ↑{formatTokens(stats?.tokens?.input)} ↓{formatTokens(stats?.tokens?.output)}
        </span>
      </Tooltip>

      {cost !== null && cost > 0 ? (
        <Tooltip label="本会话累计费用（美元）" wide>
          <span className="status-item status-num">${cost.toFixed(4)}</span>
        </Tooltip>
      ) : null}

      <span className={`status-item status-busy${busy ? " is-busy" : ""}`}>
        {busy ? "运行中" : "空闲"}
      </span>
    </footer>
  );
}
