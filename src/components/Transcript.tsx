import { memo, useEffect, useMemo, useRef } from "react";

import { useElapsed } from "../hooks/useElapsed";
import type { ForkMessage } from "../lib/protocol";
import { hasConversation, type Item } from "../lib/reducer";
import { RichText } from "../lib/rich";
import { ToolCard } from "./ToolCard";
import { TurnRail, type TurnAnchor } from "./TurnRail";
import { IconCopy, IconPencil, IconTrash } from "./ui/Icons";
import { IconButton, Spinner } from "./ui/kit";

/** Only keep the view pinned to the bottom while the user is already there. */
const STICK_THRESHOLD = 80;

/**
 * dsh's transcript model: user messages are right-aligned bubbles, assistant
 * output is flat prose, and everything sits in a centred content column. Role
 * is carried by position and styling, so there is no "you / assistant" gutter.
 *
 * The rail on the right is the one addition: a run of agent turns is long
 * enough that scrolling back to a particular question by hand is guesswork, so
 * each prompt gets a tick.
 */
export function Transcript({
  items,
  busy,
  opening,
  turns,
  actionsEnabled,
  resetNonce,
  onCopyTurn,
  onEditTurn,
  onDeleteTurn,
}: {
  items: Item[];
  busy: boolean;
  /**
   * True while this conversation's engine is still starting. The pane then says
   * "opening" instead of "new session": a chat that is merely slow to come up
   * must not be presented as empty — that reading is what made switching look
   * like it had lost the conversation.
   */
  opening: boolean;
  /**
   * pi's view of the prompts it can rewind to, in transcript order. `null` while
   * unknown; the count is checked against the rendered prompts before any
   * rewind is offered, so a mismatch degrades to "no actions" rather than
   * truncating the wrong turn.
   */
  turns: ForkMessage[] | null;
  actionsEnabled: boolean;
  /** Bumped when the branch is cut, to force the view back to the bottom. */
  resetNonce: number;
  onCopyTurn: (text: string) => void;
  onEditTurn: (entryId: string, text: string) => void;
  onDeleteTurn: (entryId: string, position: number, total: number) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const lastReset = useRef(resetNonce);

  const onScroll = () => {
    const box = boxRef.current;
    if (!box) return;
    stickRef.current = box.scrollHeight - box.scrollTop - box.clientHeight < STICK_THRESHOLD;
  };

  useEffect(() => {
    if (!stickRef.current) return;
    const box = boxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [items, busy]);

  // A rewind shortens the branch; the reader should land at its new end.
  useEffect(() => {
    if (lastReset.current === resetNonce) return;
    lastReset.current = resetNonce;
    stickRef.current = true;
    const box = boxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [resetNonce, items]);

  /** Pairs each rendered prompt with pi's entry id, by position. */
  const { anchors, entryForTurn } = useMemo(() => {
    const userCount = items.filter((item) => item.kind === "user").length;
    const aligned = turns !== null && turns.length === userCount && userCount > 0;
    const list: TurnAnchor[] = aligned
      ? (turns ?? []).map((turn, index) => ({ index, text: turn.text }))
      : [];
    const map = new Map<number, string>();
    if (aligned) {
      (turns ?? []).forEach((turn, index) => map.set(index, turn.entryId));
    }
    return { anchors: list, entryForTurn: map };
  }, [items, turns]);

  let userIndex = -1;
  const fresh = !hasConversation(items);

  return (
    <div className="transcript-wrap">
      <div className="transcript" ref={boxRef} onScroll={onScroll}>
        {fresh ? (
          opening ? (
            <div className="transcript-empty">
              <p className="empty-hint">
                <Spinner size={14} className="working-spinner" /> 正在打开会话…
              </p>
            </div>
          ) : (
            <div className="transcript-empty">
              <p className="empty-title">新会话</p>
              <p className="empty-hint">
                pi 已在当前工作目录就绪。给它一个任务，例如
                <code className="inline-code">列出当前目录前 10 个文件</code>
                。
              </p>
            </div>
          )
        ) : null}

        {items.map((item) => {
          if (item.kind === "user") {
            userIndex += 1;
            const turn = userIndex;
            return (
              <UserRow
                key={item.key}
                item={item}
                turn={turn}
                entryId={entryForTurn.get(turn)}
                totalTurns={turns?.length ?? 0}
                actionsEnabled={actionsEnabled}
                onCopyTurn={onCopyTurn}
                onEditTurn={onEditTurn}
                onDeleteTurn={onDeleteTurn}
              />
            );
          }

          if (item.kind === "assistant") {
            return <AssistantRow key={item.key} item={item} />;
          }

          if (item.kind === "tool") {
            return <ToolRow key={item.key} item={item} />;
          }

          return <NoticeRow key={item.key} item={item} />;
        })}

        {busy ? <WorkingRow /> : null}
      </div>

      <TurnRail turns={anchors} boxRef={boxRef} revision={items} />
    </div>
  );
}

/**
 * One prompt bubble, with the turn actions parked in the empty space to its
 * left (see the comment in the body).
 *
 * Memoised, and the reducer keeps an untouched item's object identity across
 * dispatches — so while a turn streams, only the one assistant row at the
 * bottom re-renders per token, not the whole history. Without this, a long
 * session re-renders (and re-parses) every row several times a second, which
 * is what made the composer feel like it was typing through wet sand.
 */
const UserRow = memo(function UserRow({
  item,
  turn,
  entryId,
  totalTurns,
  actionsEnabled,
  onCopyTurn,
  onEditTurn,
  onDeleteTurn,
}: {
  item: Extract<Item, { kind: "user" }>;
  turn: number;
  entryId: string | undefined;
  totalTurns: number;
  actionsEnabled: boolean;
  onCopyTurn: (text: string) => void;
  onEditTurn: (entryId: string, text: string) => void;
  onDeleteTurn: (entryId: string, position: number, total: number) => void;
}) {
  return (
    <div
      className="row row-user"
      data-turn={entryId ? turn : undefined}
      id={entryId ? `turn-${turn}` : undefined}
    >
      <div className="bubble">
        {item.text}
        {/*
          Rendered inside the bubble and parked outside its left edge.
          A right-aligned bubble always has empty space to its left, so
          the actions overlay nothing — and because they are taken out
          of flow the bubble stays flush right instead of being pushed
          84px inward by an invisible toolbar.
        */}
        {entryId && actionsEnabled ? (
          <div className="turn-actions">
            <IconButton title="复制这一轮提问" onClick={() => onCopyTurn(item.text)}>
              <IconCopy size={12} />
            </IconButton>
            <IconButton
              title="修改这一轮提问（把会话回退到这里，改成你要的再重新发送）"
              onClick={() => onEditTurn(entryId, item.text)}
            >
              <IconPencil size={12} />
            </IconButton>
            <IconButton
              title={
                turn === totalTurns - 1
                  ? "删除这一轮提问（连同它的回答）"
                  : "删除这一轮提问，以及它之后的全部对话"
              }
              tone="danger"
              onClick={() => onDeleteTurn(entryId, turn, totalTurns)}
            >
              <IconTrash size={12} />
            </IconButton>
          </div>
        ) : null}
      </div>
    </div>
  );
});

const AssistantRow = memo(function AssistantRow({
  item,
}: {
  item: Extract<Item, { kind: "assistant" }>;
}) {
  return (
    <div className="row row-assistant" key={item.key}>
      {item.thinking ? (
        <details className="thinking">
          <summary>思考过程（{item.thinking.length} 字符）</summary>
          <div className="thinking-body">{item.thinking}</div>
        </details>
      ) : null}
      {item.text ? (
        <div className="rich">
          <RichText text={item.text} />
        </div>
      ) : null}
      {item.streaming && !item.text ? <span className="caret" /> : null}
    </div>
  );
});

const ToolRow = memo(function ToolRow({ item }: { item: Extract<Item, { kind: "tool" }> }) {
  return (
    <div className="row row-tool">
      <ToolCard item={item} />
    </div>
  );
});

const NoticeRow = memo(function NoticeRow({ item }: { item: Extract<Item, { kind: "notice" }> }) {
  return (
    <div className={`row row-notice notice-${item.level}`}>
      <div className="notice">{item.text}</div>
    </div>
  );
});

/**
 * The generating indicator: a rotating arc, the label, and this turn's elapsed
 * time.
 *
 * The timer is mounted with the row, so it starts on the first frame of the
 * turn and stops for good when the row unmounts. It is `aria-hidden`: a number
 * that changes every second is noise in a screen reader, and the label beside
 * it already announces the state.
 */
function WorkingRow() {
  const elapsed = useElapsed();
  return (
    <div className="row row-working">
      <Spinner size={14} className="working-spinner" />
      <span className="working-text">pi 正在工作</span>
      <span className="working-elapsed" aria-hidden="true">
        {elapsed}
      </span>
    </div>
  );
}
