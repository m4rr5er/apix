/**
 * Decide how to reopen a chat's conversation.
 *
 * The recorded `sessionFile` is not trustworthy on its own. APIX stores the
 * path pi reports right after `new_session`, and pi hands that path out before
 * it writes anything: `SessionManager._persist` returns early while the session
 * has no user/assistant message, so a chat that was created and never used has
 * a binding to a file that does not exist yet.
 *
 * Two attempts to "fix" that by opening a fresh session instead made things
 * worse, so the rule is now driven purely by what is on disk:
 *
 *   - `resume`  the recorded file is real — open it, conversation and all;
 *   - `reopen`  the recorded file is absent, the normal state of a chat that was
 *               created and never used. pi keeps an explicit session path and
 *               materialises the file with the first message, so opening it
 *               leaves the index exactly as recorded instead of churning the
 *               binding on every restart;
 *   - `adopt`   the recorded file is gone but one unclaimed sibling is
 *               unambiguously this chat's (see below) — rebind and open it;
 *   - `fresh`   nothing usable at all: either no binding yet, or the siblings
 *               are too close to choose between.
 *
 * `reopen` is deliberately quiet. A chat with no messages showing an empty pane
 * is the correct outcome, not a warning. It also means a session file deleted
 * outside APIX is indistinguishable from one that was never written — the
 * difference is not observable from disk, and claiming otherwise would mean
 * crying wolf on every newly created chat.
 *
 * # How a sibling is adopted
 *
 *   - pi names files `<ISO timestamp>_<uuid>.jsonl`, and the timestamp is when
 *     the session was created — i.e. within a second of the chat's own
 *     `createdAt`, because APIX creates the session immediately after the chat;
 *   - a candidate must be unclaimed by another chat of the same workspace and
 *     must have content (a 0-byte file was never flushed);
 *   - the nearest candidate must be inside {@link ADOPT_WINDOW_MS}, and no
 *     second candidate may be nearly as near ({@link ADOPT_CLEAR_MARGIN_MS}),
 *     otherwise the choice is a coin flip and is refused;
 *   - **only the closest chat may adopt a file.** Resolution runs one chat at a
 *     time and each call is handed its siblings, so the claim has to be decided
 *     without coordination: a chat skips a candidate when a sibling's creation
 *     time is nearer to it (`ADOPT` is by nearest `createdAt`, ties broken by id
 *     so the outcome is total and reproducible). Without this rule two chats
 *     whose recorded paths were both superseded will happily adopt the same
 *     file, leaving two chats on one conversation and one of them overwriting
 *     the other's only route back to it.
 */

import type { ChatEntry, SessionListing } from "./configBridge";

/** How far a session file's timestamp may sit from the chat's creation time. */
const ADOPT_WINDOW_MS = 10 * 60 * 1000;

/** How much nearer the best candidate must be than the runner-up. */
const ADOPT_CLEAR_MARGIN_MS = 60 * 1000;

export type ChatSessionResolution =
  | { kind: "resume"; path: string }
  | { kind: "reopen"; path: string }
  | { kind: "adopt"; path: string }
  | { kind: "fresh"; reason: "unbound" | "ambiguous" };

/**
 * The creation time encoded in a pi session file name, or `null` when the name
 * does not follow pi's `<ISO with : and . replaced by ->_<uuid>.jsonl` shape.
 */
export function parseSessionStamp(fileName: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z_/.exec(fileName);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, milli] = match;
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(milli),
  );
}

/**
 * Choose resume / reopen / adopt / fresh for one chat.
 *
 * `listing` is `null` when the host could not answer. That is the only case
 * where a recorded path is trusted unverified — the alternative would be
 * refusing to open a chat that is probably fine.
 */
export function resolveChatSession(input: {
  /** The chat being opened. */
  chat: Pick<ChatEntry, "id" | "createdAt" | "sessionFile">;
  /** The workspace's other chats; they compete for the same session files. */
  siblings: readonly Pick<ChatEntry, "id" | "createdAt" | "sessionFile">[];
  listing: SessionListing | null;
}): ChatSessionResolution {
  const { chat, siblings, listing } = input;
  const sessionFile = chat.sessionFile;

  if (!sessionFile) return { kind: "fresh", reason: "unbound" };
  if (!listing) return { kind: "resume", path: sessionFile };
  if (listing.recordedExists) return { kind: "resume", path: sessionFile };

  // Paths another chat already records are spoken for, even if that chat's own
  // recorded file happens to be missing.
  const owned = new Set(
    siblings.map((sibling) => sibling.sessionFile).filter((path): path is string => Boolean(path)),
  );

  const scored: Array<{ path: string; delta: number }> = [];
  for (const file of listing.files) {
    if (owned.has(file.path)) continue;
    // A session that was never flushed is not a conversation to recover.
    if (file.size <= 0) continue;
    const stamp = parseSessionStamp(file.fileName);
    if (stamp === null) continue;
    const delta = Math.abs(stamp - chat.createdAt);

    // Nearest-creation wins, decided locally: skip anything a sibling is closer
    // to. The comparison is a total order (ties broken by id), so exactly one
    // chat can claim a given file no matter which order they are opened in.
    const contested = siblings.some((sibling) => {
      const siblingDelta = Math.abs(stamp - sibling.createdAt);
      return siblingDelta < delta || (siblingDelta === delta && sibling.id < chat.id);
    });
    if (contested) continue;

    scored.push({ path: file.path, delta });
  }
  scored.sort((a, b) => a.delta - b.delta);

  const best = scored[0];
  // Nothing near enough to be this chat's: reopen the recorded path, which pi
  // creates on the first message. This is the ordinary "created, never used"
  // chat, and it is the reason this branch says nothing.
  if (!best || best.delta > ADOPT_WINDOW_MS) return { kind: "reopen", path: sessionFile };

  // A second candidate that is nearly as near makes the pick a guess. Refuse
  // rather than adopt the wrong conversation.
  const runnerUp = scored[1];
  if (
    runnerUp &&
    runnerUp.delta <= ADOPT_WINDOW_MS &&
    runnerUp.delta - best.delta < ADOPT_CLEAR_MARGIN_MS
  ) {
    return { kind: "fresh", reason: "ambiguous" };
  }

  return { kind: "adopt", path: best.path };
}

/**
 * Do two paths name the same session file?
 *
 * pi reports paths with forward slashes while APIX's index stores whatever the
 * host handed back, which on Windows is backslashes — and the case of a drive
 * letter is not part of a file's identity there either. A strict `===` between
 * the two forms is always false, which would quietly turn every "already open"
 * check into a no.
 */
export function sameSessionPath(a: string, b: string): boolean {
  return a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();
}

/** Human-readable reason, for the notice shown when nothing could be resumed. */
export function freshReasonText(reason: "unbound" | "ambiguous"): string {
  switch (reason) {
    case "unbound":
      return "这个会话还没有绑定 pi 的会话记录。";
    case "ambiguous":
      return "原来的记录文件不在了，同目录里有多个可能的记录无法确定属于它，已作为新会话打开。";
  }
}
