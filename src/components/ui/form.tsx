/**
 * Form primitives the settings page needs beyond `kit.tsx`.
 *
 * StackFerry leans on shadcn's Field / Switch / KeyValue pair components. These
 * are the same ideas with no dependency, sized for a drawer.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

import { parseTokenShorthand, tokenShorthand } from "../../lib/protocol";
import { IconChevronRight, IconClose, IconPlus } from "./Icons";
import { IconButton } from "./kit";
import { Tooltip } from "./Tooltip";

/** iOS-style toggle. A button, so it is keyboard reachable by default. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <Tooltip label={label}>
      <button
        className={`switch${checked ? " is-on" : ""}`}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span className="switch-knob" aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

/** A labelled row with a switch on the right, the shape most compat flags take. */
export function SwitchRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="switch-row">
      <div className="switch-copy">
        <span className="switch-label">{label}</span>
        {hint ? <span className="switch-hint">{hint}</span> : null}
      </div>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

/** Number field that reads back as blank when the value is unset. */
export function NumberInput({
  value,
  onChange,
  placeholder,
  className = "input",
  min,
  max,
  step,
}: {
  value: number | undefined;
  onChange: (next: number | undefined) => void;
  placeholder?: string;
  className?: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <input
      className={className}
      inputMode="decimal"
      spellCheck={false}
      placeholder={placeholder}
      min={min}
      max={max}
      step={step}
      value={value ?? ""}
      onChange={(event) => {
        const raw = event.target.value.trim();
        if (!raw) {
          onChange(undefined);
          return;
        }
        const parsed = Number(raw);
        onChange(Number.isFinite(parsed) ? parsed : undefined);
      }}
    />
  );
}

export function Select({
  value,
  onChange,
  options,
  className = "input input-select",
  placeholder = "未设置",
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  options: Array<{ value: string; label: string }>;
  className?: string;
  /** Label of the empty option. Pass "" to hide it entirely. */
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <select
      className={className}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/**
 * `Record<string, string>` editor.
 *
 * Rows are held locally so a half-typed key is not thrown away on every
 * keystroke; the record is rebuilt and emitted on each edit.
 */
export function KeyValueEditor({
  value,
  onChange,
  keyPlaceholder = "名称",
  valuePlaceholder = "值",
  secret,
  addLabel = "添加一行",
}: {
  value: Record<string, string> | undefined;
  onChange: (next: Record<string, string> | undefined) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  /** Mask the value column, for headers that carry credentials. */
  secret?: boolean;
  addLabel?: string;
}) {
  const [rows, setRows] = useState<Array<[string, string]>>(() => Object.entries(value ?? {}));
  const echoed = useRef(serialize(value));

  useEffect(() => {
    const next = serialize(value);
    if (next !== echoed.current) {
      setRows(Object.entries(value ?? {}));
      echoed.current = next;
    }
  }, [value]);

  const emit = (next: Array<[string, string]>) => {
    setRows(next);
    const out: Record<string, string> = {};
    for (const [key, item] of next) {
      const trimmed = key.trim();
      if (trimmed) out[trimmed] = item;
    }
    echoed.current = serialize(out);
    onChange(Object.keys(out).length > 0 ? out : undefined);
  };

  return (
    <div className="kv">
      {rows.map(([key, item], index) => (
        <div className="kv-row" key={`${index}-${key}`}>
          <input
            className="input input-cell"
            placeholder={keyPlaceholder}
            value={key}
            onChange={(event) => {
              const next = [...rows];
              next[index] = [event.target.value, item];
              emit(next);
            }}
          />
          <input
            className="input input-cell"
            placeholder={valuePlaceholder}
            spellCheck={false}
            type={secret ? "password" : "text"}
            autoComplete="off"
            value={item}
            onChange={(event) => {
              const next = [...rows];
              next[index] = [key, event.target.value];
              emit(next);
            }}
          />
          <IconButton
            title="删除这一行"
            tone="danger"
            onClick={() => emit(rows.filter((_, position) => position !== index))}
          >
            <IconClose size={12} />
          </IconButton>
        </div>
      ))}
      <button className="btn btn-ghost kv-add" type="button" onClick={() => setRows([...rows, ["", ""]])}>
        <IconPlus />
        {addLabel}
      </button>
    </div>
  );
}

/**
 * JSON escape hatch for one subtree of the patch.
 *
 * Typing is never clobbered: the textarea only resyncs when the parent hands
 * back an object whose serialisation differs from the last one we emitted.
 */
export function JsonField({
  value,
  onChange,
  rows = 8,
  placeholder = "{}",
  hint,
}: {
  value: unknown;
  onChange: (next: unknown) => void;
  rows?: number;
  placeholder?: string;
  hint?: ReactNode;
}) {
  const [text, setText] = useState(() => toText(value));
  const [error, setError] = useState<string | null>(null);
  const echoed = useRef(toText(value));

  useEffect(() => {
    const next = toText(value);
    if (next !== echoed.current) {
      setText(next);
      echoed.current = next;
      setError(null);
    }
  }, [value]);

  const commit = (raw: string) => {
    setText(raw);
    if (!raw.trim()) {
      setError(null);
      echoed.current = "";
      onChange(undefined);
      return;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      setError(null);
      echoed.current = toText(parsed);
      onChange(parsed);
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : String(parseError));
    }
  };

  return (
    <div className="json-field">
      <textarea
        className={`json-area json-area-sm${error ? " is-invalid" : ""}`}
        spellCheck={false}
        rows={rows}
        placeholder={placeholder}
        value={text}
        onChange={(event) => commit(event.target.value)}
      />
      <div className="json-field-foot">
        {error ? (
          <span className="inline-status status-error">JSON 不合法：{error}</span>
        ) : hint ? (
          <span className="json-hint">{hint}</span>
        ) : null}
        <span className="spacer" />
        <button
          className="btn btn-ghost"
          type="button"
          disabled={Boolean(error)}
          onClick={() => {
            try {
              setText(JSON.stringify(JSON.parse(text), null, 2));
            } catch {
              /* the error line already says so */
            }
          }}
        >
          格式化
        </button>
        <button
          className="btn btn-ghost"
          type="button"
          onClick={() => commit("")}
        >
          清空
        </button>
      </div>
    </div>
  );
}

/** A titled, collapsible block inside a drawer. */
export function Collapsible({
  title,
  hint,
  count,
  defaultOpen,
  children,
}: {
  title: ReactNode;
  hint?: ReactNode;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <section className={`fold${open ? " is-open" : ""}`}>
      <button
        className="fold-head"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="fold-caret" aria-hidden="true">
          <IconChevronRight size={12} />
        </span>
        <span className="fold-title">{title}</span>
        {typeof count === "number" ? <span className="fold-count">{count}</span> : null}
        {hint ? <span className="fold-hint">{hint}</span> : null}
      </button>
      {open ? <div className="fold-body">{children}</div> : null}
    </section>
  );
}

/**
 * Token budget field.
 *
 * Accepts `1M`, `256K`, `64k` or the full digits and shows the shorthand back,
 * because nobody wants to count zeros to check whether a limit is 1M or 10M.
 * The buffer is local so a half-typed `1` is never written to config: the value
 * commits on blur or Enter, and only when it parses.
 */
export function TokenInput({
  value,
  onChange,
  placeholder,
  className = "input",
}: {
  value: number | undefined;
  onChange: (next: number | undefined) => void;
  placeholder?: string;
  className?: string;
}) {
  const [text, setText] = useState(() => tokenShorthand(value));
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);

  // Follow the model when it changes underneath us (model switch, reload).
  useEffect(() => {
    if (focused.current) return;
    setText(tokenShorthand(value));
    setInvalid(false);
  }, [value]);

  const commit = () => {
    const raw = text.trim();
    if (!raw) {
      // Empty means "not specified", which lets pi fall back to its own default
      // (128000 for contextWindow, 16384 for maxTokens). Writing 0 instead would
      // be rejected outright — pi throws on a non-positive contextWindow.
      setInvalid(false);
      onChange(undefined);
      setText("");
      return;
    }
    const parsed = parseTokenShorthand(raw);
    if (parsed === undefined) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onChange(parsed);
    setText(tokenShorthand(parsed));
  };

  return (
    <input
      className={`${className}${invalid ? " is-invalid" : ""}`}
      spellCheck={false}
      inputMode="text"
      placeholder={placeholder ?? "例如 1M 或 256K"}
      value={text}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(event) => {
        setText(event.target.value);
        setInvalid(false);
      }}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
          (event.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

/** Section heading inside a drawer, for splitting a long form. */
export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="form-section">
      <header className="form-section-head">
        <h4 className="form-section-title">{title}</h4>
        {description ? <p className="form-section-desc">{description}</p> : null}
      </header>
      <div className="form-section-body">{children}</div>
    </section>
  );
}

function serialize(value: Record<string, string> | undefined): string {
  return JSON.stringify(value ?? {});
}

function toText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "object" && Object.keys(value as object).length === 0) return "";
  return JSON.stringify(value, null, 2);
}
