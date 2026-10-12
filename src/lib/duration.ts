/**
 * Stopwatch formatting for the generating row.
 *
 * One shape, always, so the number never jumps around as it grows:
 *
 *   under an hour  →  `M:SS`     (0:07, 1:23, 12:04)
 *   an hour or more → `H:MM:SS`  (1:02:33)
 *
 * Deliberately not "7s / 1m23s / 1h2m": unit suffixes change width mid-run and
 * read as three different meters rather than one clock.
 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/**
 * Absolute wall-clock stamp for list cells: `2026-10-10 10:49`.
 *
 * Local time, fixed width, and deliberately not `toLocaleString`, which follows
 * the browser language rather than the app's and produces mixed-language output
 * (an English month name under a Chinese label). Minute precision: seconds in a
 * list are noise, and the list is not a log.
 */
export function formatStamp(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
