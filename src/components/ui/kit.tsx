/**
 * Layout primitives for the settings page.
 *
 * Modelled on StackFerry's shadcn set (Card / Field / Empty + a right-hand
 * Sheet for editing) but implemented with plain elements so the bundle stays
 * free of a component library.
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { IconClose } from "./Icons";
import { Tooltip } from "./Tooltip";

/**
 * The app's one "busy" animation: a static ring plus a quarter arc, spun by a
 * `transform` animation — a compositor-only property, so it costs no layout and
 * no paint per frame and stays smooth on weak GPUs. Reduced motion is handled
 * globally (`:root[data-reduce-motion]` collapses every animation to a single
 * near-zero frame), which freezes the arc at the top; still legible as a status
 * glyph rather than a broken one.
 *
 * Shared rather than duplicated so the generating row and the in-input polish
 * button can't drift into two different spinners.
 */
export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <span className={className ? `spinner ${className}` : "spinner"} aria-hidden="true">
      <svg viewBox="0 0 16 16" width={size} height={size} fill="none">
        <circle
          cx="8"
          cy="8"
          r="6.1"
          stroke="currentColor"
          strokeOpacity="0.25"
          strokeWidth="1.7"
        />
        <path
          d="M8 1.9A6.1 6.1 0 0 1 14.1 8"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <section className="card">{children}</section>;
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="card-head">
      <div className="card-title-group">
        <h3 className="card-title">{title}</h3>
        {description ? <p className="card-desc">{description}</p> : null}
      </div>
      {action ? <div className="card-action">{action}</div> : null}
    </header>
  );
}

export function CardBody({
  children,
  flush,
}: {
  children: ReactNode;
  /** Drop the padding, for a table that owns its own gutters. */
  flush?: boolean;
}) {
  return <div className={flush ? "card-body card-body-flush" : "card-body"}>{children}</div>;
}

export function CardFooter({ children }: { children: ReactNode }) {
  return <div className="card-foot">{children}</div>;
}

export function FieldGroup({ children }: { children: ReactNode }) {
  return <div className="field-group">{children}</div>;
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      {label ? (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : null}
      {children}
      {hint ? <p className="field-desc">{hint}</p> : null}
    </div>
  );
}

export function FieldRow({ children }: { children: ReactNode }) {
  return <div className="field-row">{children}</div>;
}

export function Badge({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "ok" | "warn" | "error" | "info";
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function IconButton({
  children,
  title,
  onClick,
  tone = "default",
  disabled,
}: {
  children: ReactNode;
  title: string;
  onClick: () => void;
  tone?: "default" | "danger";
  disabled?: boolean;
}) {
  return (
    <Tooltip label={title}>
      <button
        className={`icon-btn${tone === "danger" ? " is-danger" : ""}`}
        type="button"
        aria-label={title}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon ? <div className="empty-icon">{icon}</div> : null}
      <p className="empty-heading">{title}</p>
      {description ? <p className="empty-desc">{description}</p> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

/** Right-hand sheet used for every create/edit flow. */
export function Drawer({
  open,
  title,
  description,
  onClose,
  footer,
  children,
}: {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="drawer-layer">
      <button className="drawer-scrim" type="button" aria-label="关闭" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <header className="drawer-head">
          <div className="card-title-group">
            <h3 className="card-title">{title}</h3>
            {description ? <p className="card-desc">{description}</p> : null}
          </div>
          <IconButton title="关闭" onClick={onClose}>
            <IconClose />
          </IconButton>
        </header>
        <div className="drawer-body">{children}</div>
        {footer ? <footer className="drawer-foot">{footer}</footer> : null}
      </aside>
    </div>
  );
}

/**
 * In-app confirmation, used instead of `window.confirm`.
 *
 * A native dialog is drawn by the OS with its own font and buttons, which is
 * jarring for a destructive action that belongs to our own vocabulary.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "确认",
  tone = "primary",
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  tone?: "primary" | "danger";
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onCancel]);

  if (!open) return null;

  return createPortal(
    <div className="confirm-layer">
      <button className="confirm-scrim" type="button" aria-label="取消" onClick={onCancel} />
      <div className="confirm" role="alertdialog" aria-modal="true">
        <h3 className="confirm-title">{title}</h3>
        <div className="confirm-body">{message}</div>
        <div className="confirm-foot">
          <button className="btn btn-ghost" type="button" onClick={onCancel}>
            取消
          </button>
          <button
            className={`btn ${tone === "danger" ? "btn-danger" : "btn-primary"}`}
            type="button"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Anchored popover for the composer's model and thinking pickers.
 *
 * The panel takes focus on open so its Escape handler runs on the panel rather
 * than reaching the composer's textarea, which uses Escape to abort a run.
 */
export function Popover({
  label,
  title,
  align = "left",
  panelClass,
  disabled,
  children,
}: {
  label: ReactNode;
  title: string;
  align?: "left" | "right";
  /** Extra class on the panel, e.g. to widen it — the panel clips (`overflow:
   *  hidden`), so content wider than it loses its right edge invisibly. */
  panelClass?: string;
  disabled?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  return (
    <div className="popover" ref={rootRef}>
      <Tooltip label={title}>
        <button
          className="popover-trigger"
          type="button"
          disabled={disabled}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {label}
        </button>
      </Tooltip>
      {open ? (
        <div
          className={`popover-panel popover-${align}${panelClass ? ` ${panelClass}` : ""}`}
          ref={panelRef}
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setOpen(false);
            }
          }}
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Segmented control, laid out like Apple's `UISegmentedControl`: one track with
 * a thumb that slides to the selection.
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode }>;
  onChange: (value: T) => void;
  label?: string;
}) {
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const style = {
    "--seg-count": options.length,
    "--seg-index": index,
  } as CSSProperties;

  return (
    <div className="segmented" role="radiogroup" aria-label={label} style={style}>
      <span className="segmented-thumb" aria-hidden="true" />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={`segmented-item${value === option.value ? " is-active" : ""}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
