/**
 * The tray menu: what opens on a right-click of the APIX icon in the taskbar's
 * hidden-icon flyout.
 *
 * It is a window of its own rather than a native menu, because Windows draws
 * native menus itself and offers no way to theme one — the icon would open an
 * OS-styled list in the middle of an app that is otherwise fully themed. This
 * window is frameless, transparent and always on top, and its whole look lives
 * in `tray.css` next to it.
 *
 * Open sequence: the tray click reaches Rust, Rust emits `tray://menu-request`,
 * this component measures itself, and only then does it ask the host to size and
 * place the window. So the first paint is already the final size and position —
 * no resize or jump under the pointer.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Fragment, useCallback, useEffect, useRef, useState, type ComponentType } from "react";

import { IconEye, IconPower } from "./ui/Icons";

interface TrayAction {
  id: string;
  label: string;
  hint: string;
  /** Draws the separator above this entry and tints it destructive. */
  danger?: boolean;
  Icon: ComponentType<{ size?: number }>;
}

/** Same ids the native menu used, so both commands keep their behaviour. */
const ACTIONS: TrayAction[] = [
  { id: "show", label: "显示窗口", hint: "带到前台", Icon: IconEye },
  { id: "quit", label: "退出 APIX", hint: "结束会话", Icon: IconPower, danger: true },
];

export function TrayMenu() {
  const [active, setActive] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  const run = useCallback(async (id: string) => {
    try {
      await invoke("tray_menu_action", { action: id });
    } catch {
      /* The host already hid the window; nothing to report to. */
    }
  }, []);

  /** Measure the panel, then let the host size and place the window. */
  const open = useCallback(async () => {
    setActive(0);
    // One frame, so the measurement is of the settled layout rather than of a
    // panel still re-rendering from the previous open.
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    try {
      await invoke("tray_menu_show", { width: rect.width, height: rect.height });
    } catch {
      /* a missing window means the app is shutting down */
    }
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void listen("tray://menu-request", () => {
      void open();
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [open]);

  // The window is focusable, so the menu is usable from the keyboard: the same
  // keys a native menu honours.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void invoke("tray_menu_hide").catch(() => undefined);
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((current) => (current + step + ACTIONS.length) % ACTIONS.length);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        void run(ACTIONS[active].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, run]);

  return (
    <div className="tray-menu" role="menu" aria-label="APIX" ref={panelRef}>
      <p className="tray-menu-head">APIX</p>
      {ACTIONS.map((action, index) => (
        <Fragment key={action.id}>
          {action.danger ? <span className="tray-menu-sep" aria-hidden="true" /> : null}
          <button
            type="button"
            role="menuitem"
            className={`tray-menu-item${action.danger ? " is-danger" : ""}${
              index === active ? " is-active" : ""
            }`}
            onMouseEnter={() => setActive(index)}
            onClick={() => void run(action.id)}
          >
            <span className="tray-menu-glyph" aria-hidden="true">
              <action.Icon size={14} />
            </span>
            <span className="tray-menu-label">{action.label}</span>
            <span className="tray-menu-hint">{action.hint}</span>
          </button>
        </Fragment>
      ))}
    </div>
  );
}
