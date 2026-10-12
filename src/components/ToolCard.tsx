import { useMemo, useState } from "react";

import { resultText } from "../lib/protocol";
import type { ToolItem } from "../lib/reducer";

const STATUS_LABEL: Record<ToolItem["status"], string> = {
  running: "运行中",
  done: "完成",
  error: "失败",
};

/** One-line hint about what the tool was asked to do. */
function previewArgs(args: unknown): string {
  if (args === undefined || args === null) return "";
  if (typeof args === "string") return args;
  if (typeof args !== "object") return String(args);

  const record = args as Record<string, unknown>;
  const candidate =
    record.command ?? record.path ?? record.file_path ?? record.pattern ?? record.query;
  if (typeof candidate === "string") return candidate;

  try {
    return JSON.stringify(args);
  } catch {
    return "";
  }
}

export function ToolCard({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false);
  const summary = useMemo(() => previewArgs(item.args), [item.args]);
  const output = useMemo(() => resultText(item.result), [item.result]);
  const lineCount = output ? output.split("\n").length : 0;

  return (
    <div className={`tool tool-${item.status}`}>
      <button className="tool-head" type="button" onClick={() => setOpen((v) => !v)}>
        <span className="tool-caret">{open ? "▾" : "▸"}</span>
        <span className="tool-name">{item.name}</span>
        {summary ? <span className="tool-summary">{summary}</span> : null}
        <span className="tool-meta">
          {item.durationMs !== undefined ? <span>{Math.round(item.durationMs)}ms</span> : null}
          {lineCount > 0 ? <span>{lineCount} 行</span> : null}
          <span className={`tool-status status-${item.status}`}>{STATUS_LABEL[item.status]}</span>
        </span>
      </button>

      {open ? (
        <div className="tool-body">
          {item.args !== undefined && item.args !== null ? (
            <pre className="tool-args">{JSON.stringify(item.args, null, 2)}</pre>
          ) : null}
          {output ? <pre className="tool-output">{output}</pre> : null}
        </div>
      ) : null}
    </div>
  );
}
