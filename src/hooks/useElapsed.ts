import { useEffect, useState } from "react";

import { formatElapsed } from "../lib/duration";

/**
 * How often the clock is sampled.
 *
 * Coarser than a frame, finer than the displayed unit, so the visible value
 * flips promptly instead of lagging up to a second behind. The state only ever
 * holds the *formatted string*, so between two ticks React sees an identical
 * value and skips the re-render — the component renders about once a second,
 * not five times.
 */
const TICK_MS = 200;

/**
 * Elapsed time since this hook mounted, as a formatted stopwatch string.
 *
 * Mount and unmount are the clock's start and stop: the caller is the
 * generating row, which is only in the tree while a turn is running. So
 * mounting *is* "this turn started", and the number freezes the instant the row
 * leaves — no separate start/stop bookkeeping that could drift out of sync with
 * what is actually on screen.
 */
export function useElapsed(): string {
  const [text, setText] = useState(() => formatElapsed(0));

  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      setText(formatElapsed(Date.now() - started));
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  return text;
}
