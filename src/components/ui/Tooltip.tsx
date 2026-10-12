/**
 * Hover hint, replacing the browser's native `title` tooltip.
 *
 * The native one is drawn by the OS: it keeps its own system font (which reads
 * as low-resolution next to the app's Inter + Noto stack), it cannot follow the
 * theme, and its grey box ignores every radius and hairline in the design
 * system. So every hint in APIX goes through this component instead.
 *
 * The panel is portalled to `document.body` and positioned with `position:
 * fixed`, which is the only way to stay correct inside scroll containers and
 * overflow-clipped drawers.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type TipSide = "top" | "bottom" | "left" | "right";

/** Distance between the anchor and the panel. */
const GAP = 9;
/** Minimum margin kept from the viewport edge. */
const EDGE = 8;
/**
 * Long enough that sweeping the pointer across a toolbar does not flash a
 * dozen panels; short enough that a deliberate hover feels immediate.
 */
const OPEN_DELAY = 240;

export function Tooltip({
  label,
  side = "top",
  children,
  /** Stretch the wrapper to the parent's width, for full-width rows. */
  block,
  /** Widen the panel and allow wrapping, for sentence-length hints. */
  wide,
  /** Override the open delay, for scrubbers where waiting feels wrong. */
  delay = OPEN_DELAY,
}: {
  label: ReactNode;
  side?: TipSide;
  children: ReactNode;
  block?: boolean;
  wide?: boolean;
  delay?: number;
}) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const place = useCallback(() => {
    const host = hostRef.current;
    const panel = panelRef.current;
    if (!host || !panel) return;
    const rect = host.getBoundingClientRect();
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    if (width === 0 && height === 0) return;

    let top: number;
    let left: number;
    if (side === "top" || side === "bottom") {
      left = rect.left + rect.width / 2 - width / 2;
      top = side === "top" ? rect.top - GAP - height : rect.bottom + GAP;
    } else {
      top = rect.top + rect.height / 2 - height / 2;
      left = side === "right" ? rect.right + GAP : rect.left - GAP - width;
    }

    const maxLeft = Math.max(EDGE, window.innerWidth - width - EDGE);
    const maxTop = Math.max(EDGE, window.innerHeight - height - EDGE);
    setPos({
      left: Math.min(Math.max(EDGE, left), maxLeft),
      top: Math.min(Math.max(EDGE, top), maxTop),
    });
  }, [side]);

  const show = useCallback(() => {
    clearTimer();
    if (delay <= 0) {
      setOpen(true);
      return;
    }
    timer.current = window.setTimeout(() => setOpen(true), delay);
  }, [clearTimer, delay]);

  const hide = useCallback(() => {
    clearTimer();
    setOpen(false);
    setPos(null);
  }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  // Measure before paint, so the panel never appears at the wrong spot.
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  // Keep it glued to the anchor while the page moves underneath it.
  useEffect(() => {
    if (!open) return;
    const onMove = () => place();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, hide]);

  return (
    <>
      <span
        className={`tip-host${block ? " tip-host-block" : ""}`}
        ref={hostRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        onPointerDown={hide}
        onFocusCapture={show}
        onBlurCapture={hide}
      >
        {children}
      </span>
      {open
        ? createPortal(
            <div
              className={`tip tip-${side}${wide ? " tip-wide" : ""}`}
              ref={panelRef}
              role="tooltip"
              style={{
                top: pos?.top ?? 0,
                left: pos?.left ?? 0,
                visibility: pos ? "visible" : "hidden",
              }}
            >
              {label}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
