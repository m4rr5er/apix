/**
 * Index rail on the right edge of the transcript.
 *
 * One tick per user prompt, placed *proportionally* rather than evenly: a tick
 * sits at the scroll offset where its turn actually is, so the rail doubles as
 * a minimap of how the conversation is distributed. That matters in agent
 * transcripts, where one turn can be four screens of tool output and the next
 * two lines.
 *
 * Positions are measured from the DOM instead of tracked in state, because the
 * transcript's layout depends on markdown rendering and tool output that only
 * the browser knows.
 */

import { useCallback, useEffect, useLayoutEffect, useState } from "react";

import { Tooltip } from "./ui/Tooltip";

export interface TurnAnchor {
  /** Index of the turn, matching the order pi returned them in. */
  index: number;
  text: string;
}

/** Headroom left above a jumped-to turn, matching `jump` below. */
const JUMP_OFFSET = 12;

export function TurnRail({
  turns,
  boxRef,
  revision,
}: {
  turns: TurnAnchor[];
  /** The element that actually scrolls. */
  boxRef: { current: HTMLDivElement | null };
  /** Anything that changes layout: new items, resized window. */
  revision: unknown;
}) {
  const [marks, setMarks] = useState<number[]>([]);
  const [active, setActive] = useState(0);

  const measure = useCallback(() => {
    const box = boxRef.current;
    if (!box) return;
    // Position each tick at the *scroll offset* it jumps to, not at its share
    // of the document. That makes the rail line up with the scrollbar: a tick
    // at 80% is where the viewport will end up, which is what the reader is
    // aiming at. Mapping raw document offsets instead would squash every tick
    // into the top of the rail, because the rail is shorter than the content.
    const scrollable = box.scrollHeight - box.clientHeight;
    const span = Math.max(1, scrollable);
    const next: number[] = [];
    for (const turn of turns) {
      const node = box.querySelector<HTMLElement>(`[data-turn="${turn.index}"]`);
      next.push(node ? Math.min(1, Math.max(0, (node.offsetTop - JUMP_OFFSET) / span)) : 0);
    }
    setMarks(next);
  }, [boxRef, turns]);

  useLayoutEffect(() => {
    measure();
    // Second pass after fonts and markdown settle, so offsets are final.
    const raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [measure, revision]);

  useEffect(() => {
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [measure]);

  // Track which turn the reader is on.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const onScroll = () => {
      const focus = box.scrollTop + box.clientHeight * 0.3;
      let current = 0;
      for (const turn of turns) {
        const node = box.querySelector<HTMLElement>(`[data-turn="${turn.index}"]`);
        if (node && node.offsetTop <= focus) current = turn.index;
      }
      setActive(current);
    };
    onScroll();
    box.addEventListener("scroll", onScroll, { passive: true });
    return () => box.removeEventListener("scroll", onScroll);
  }, [boxRef, turns, revision]);

  const jump = (index: number) => {
    const box = boxRef.current;
    if (!box) return;
    const node = box.querySelector<HTMLElement>(`[data-turn="${index}"]`);
    if (!node) return;
    box.scrollTo({ top: Math.max(0, node.offsetTop - JUMP_OFFSET), behavior: "smooth" });
  };

  if (turns.length < 2) return null;

  return (
    <div className="turn-rail" role="navigation" aria-label="提问导航">
      {turns.map((turn, position) => (
        <Tooltip
          key={turn.index}
          side="left"
          wide
          delay={60}
          label={
            <>
              <span className="tip-turn-no">第 {position + 1} 轮</span>
              {excerpt(turn.text)}
            </>
          }
        >
          <button
            type="button"
            className={`turn-tick${turn.index === active ? " is-active" : ""}`}
            style={{ top: `${(marks[position] ?? 0) * 100}%` }}
            aria-label={`跳到第 ${position + 1} 轮提问`}
            aria-current={turn.index === active ? "true" : undefined}
            onClick={() => jump(turn.index)}
          />
        </Tooltip>
      ))}
    </div>
  );
}

/** Long prompts get trimmed — the rail is a signpost, not a reader. */
function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 160 ? `${flat.slice(0, 160)}…` : flat;
}
