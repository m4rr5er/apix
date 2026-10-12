import { useCallback, useEffect, useState } from "react";

import { configApi, type ConfigFile } from "../../lib/configBridge";

type Status = { level: "ok" | "error"; text: string } | null;

/**
 * Raw escape hatch for one of pi's JSON files. Validation happens in Rust
 * before anything is written, so a syntax error can never corrupt the file.
 */
export function JsonEditor({
  which,
  hint,
  onSaved,
}: {
  which: ConfigFile;
  hint?: string;
  onSaved?: () => void;
}) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setStatus(null);
    try {
      setText(await configApi.readRaw(which));
    } catch (error) {
      setStatus({ level: "error", text: String(error) });
    }
  }, [which]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const parsed = await configApi.writeRaw(which, text);
      setText(`${JSON.stringify(parsed, null, 2)}\n`);
      setStatus({ level: "ok", text: "已写入" });
      onSaved?.();
    } catch (error) {
      setStatus({ level: "error", text: String(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="json-editor">
      {hint ? <p className="field-hint json-hint">{hint}</p> : null}
      <textarea
        className="json-area"
        spellCheck={false}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="json-actions">
        {status ? (
          <span className={`inline-status status-${status.level}`}>{status.text}</span>
        ) : null}
        <span className="spacer" />
        <button className="btn btn-ghost" type="button" onClick={() => void reload()}>
          重新加载
        </button>
        <button
          className="btn btn-primary"
          type="button"
          disabled={busy}
          onClick={() => void save()}
        >
          保存
        </button>
      </div>
    </div>
  );
}
