import type { SessionHistoryUnavailableReason, SessionMessagePage } from "../../../shared/types";

/** 读盘错误态里与「历史暂时读不了」相关的字段（渲染层 SessionLoadState 的子集）。 */
export type SessionHistoryUnavailableState = {
	status: "error";
	reason: SessionHistoryUnavailableReason;
};

export function sessionHistoryUnavailableState(page: Pick<SessionMessagePage, "unavailable">): SessionHistoryUnavailableState | null {
	if (!page.unavailable) return null;
	return { status: "error", reason: page.unavailable };
}
