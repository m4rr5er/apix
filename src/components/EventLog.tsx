import { useEffect, useRef } from "react";

import type { LogEntry } from "../hooks/usePi";

export function EventLog({
  logs,
  onClear,
  onClose,
}: {
  logs: LogEntry[];
  onClear: () => void;
  onClose: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = boxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [logs]);

  return (
    <aside className="events">
      <header className="events-head">
        <span className="events-title">事件流</span>
        <span className="events-count">{logs.length}</span>
        <span className="events-spacer" />
        <button className="btn btn-ghost" type="button" onClick={onClear}>
          清空
        </button>
        <button className="btn btn-ghost" type="button" onClick={onClose}>
          关闭
        </button>
      </header>

      <div className="events-body" ref={boxRef}>
        {logs.length === 0 ? (
          <p className="rail-note">暂无事件。这里会显示 pi 的原始 JSONL 记录与 stderr 诊断。</p>
        ) : null}
        {logs.map((log) => (
          <div className={`event event-${log.stream}`} key={log.id}>
            <span className="event-tag">{log.stream}</span>
            <span className="event-text">{log.text}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}
