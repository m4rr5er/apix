import { touchRecentSessionAtom, forgetRecentSessionAtom } from "./recent-session-atoms";
import { advanceSessionActivityAnchorAtom, forgetSessionActivityAnchorAtom } from "./sessionActivityAtoms";
import { sessionSendStateByIdAtom, setSessionSendStateAtom } from "./composer-atoms";
import { getSessionDisposalAtoms, removeRegisteredSessionFamilies } from "./session-family-registry";
import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { Getter, Setter } from "jotai";
import { atomFamily, selectAtom } from "jotai/utils";
import type { AgentBackend, AgentRuntimeState, AgentStatus, AgentUiBatchQuestion, AgentUiRequest, ChatMessage, SessionHistoryUnavailableReason, SessionMessagePage, SessionRecord, SessionRuntimeEvent, SessionRuntimeInfo } from "../../../shared/types";
import { mergeAgentRuntimeState } from "../utils/agentRuntimeState";
import { isSessionTurnRunning } from "../utils/sessionActivityClock";
import { findLastUserMessageIndex, shouldRefreshOutlineForRuntimeUpsert } from "./outlineRevision";
import { releaseSessionOutlineProjection } from "./outlineProjectionCache";
import { sameProjectSessionList } from "../utils/sessionRecordIdentity";
import { resolveStreamingTextUpdate, shouldHoldLiveText, shouldReleaseHeldLiveText } from "../utils/liveTextHandoff";
import { countUserTurns } from "../utils/sessionTurnCount";

export const SESSION_MESSAGE_CACHE_LIMIT = 8;

export function selectRetainedCacheEntryIds(lru: readonly string[], openedTabIds: ReadonlySet<string>, limit: number): string[] {
	const open = lru.filter((id) => openedTabIds.has(id));
	const closed = lru.filter((id) => !openedTabIds.has(id));
	const closedBudget = Math.max(0, limit - open.length);
	return [...open, ...closed.slice(0, closedBudget)];
}

export const SESSION_CACHE_CLOSED_ENTRY_BYTE_BUDGET = 64 * 1024 * 1024;

const CHAT_MESSAGE_FIXED_OVERHEAD_CHARS = 128;

const IMAGE_REF_OVERHEAD_CHARS = 64;

export function estimateSessionCacheEntryBytes(messages: readonly ChatMessage[], history?: readonly ChatMessage[]): number {
	let chars = 0;
	const visit = (list: readonly ChatMessage[]) => {
		for (const message of list) {
			chars += CHAT_MESSAGE_FIXED_OVERHEAD_CHARS + message.text.length + (message.thinking?.length ?? 0);

			for (const image of message.images ?? []) {
				chars += typeof image.data === "string" ? image.data.length : IMAGE_REF_OVERHEAD_CHARS;
			}
		}
	};
	visit(messages);
	if (history) visit(history);
	return chars * 2;
}

export function selectByteBudgetEvictions(retainedIds: readonly string[], bytesById: ReadonlyMap<string, number>, openedTabIds: ReadonlySet<string>, budget: number): { retained: string[]; evicted: string[] } {
	let closedBytes = 0;
	const closed = new Set<string>();
	for (const id of retainedIds) {
		if (openedTabIds.has(id)) continue;
		closed.add(id);
		closedBytes += bytesById.get(id) ?? 0;
	}
	if (closedBytes <= budget) return { retained: [...retainedIds], evicted: [] };
	const evicted: string[] = [];
	const retained = [...retainedIds];
	for (let index = retained.length - 1; index >= 0 && closedBytes > budget; index -= 1) {
		const id = retained[index];
		if (!closed.has(id)) continue;
		closedBytes -= bytesById.get(id) ?? 0;
		evicted.push(id);
		retained.splice(index, 1);
	}
	return { retained, evicted };
}

export type SessionRuntimeViewState = {
	agentId?: string;
	runtimeGeneration: number;
	status: AgentStatus | "detached";
	state?: AgentRuntimeState;
	updatedAt: number;
	projectId?: string;
	cwd?: string;
	title?: string;
	piSessionId?: string;
	sessionPath?: string;

	deckSessionId?: string;
	createdAt?: number;
	compactionCount?: number;
	noSession?: boolean;
	backend?: AgentBackend;
};

export type StreamingThinkingEntry = {
	sessionId: string;
	text: string;
	startedAt: number;
	endedAt: number;
	streaming: boolean;
};

export type SessionLoadState = {
	status: "idle" | "loading" | "ready" | "error";
	error?: string;

	reason?: SessionHistoryUnavailableReason;
};

export type SessionMessageCacheEntry = {
	messages: ChatMessage[];
	revision: number;
	source: "disk" | "runtime";
	updatedAt: number;

	bytes?: number;

	outlineRevision?: number;

	outlineLastUserIndex?: number;

	totalTurns?: number;

	page?: Pick<SessionMessagePage, "total" | "totalTurns" | "nextBefore" | "nextBeforeEntryId" | "indexVersion">;

	windowStart?: number;

	cardCount?: number;

	windowStartFilePos?: number;

	history?: {
		messages: ChatMessage[];
		nextBefore: number | null;

		nextBeforeEntryId?: string | null;
		version?: string;
	};
};

export type SessionRuntimeUiRequestState = {
	request: AgentUiRequest;
	status: "pending" | "responding" | "completed" | "cancelled";
};

export type SessionRuntimeUiState = {
	agentId: string;
	runtimeGeneration: number;
	requests: Record<string, SessionRuntimeUiRequestState>;
	widgets: Record<string, string[]>;
	notification?: {
		requestId: string;
		message: string;
		notifyType?: "info" | "warning" | "error";
		revision: number;
	};
	editorText?: {
		requestId: string;
		text: string;
		revision: number;
	};
	revision: number;
};

export const sessionRecordsAtom = atom<Record<string, SessionRecord>>({});

export const discardedTransientSessionIdsAtom = atom<Set<string>>(new Set<string>());
export const sessionIdsByProjectAtom = atom<Record<string, string[]>>({});
export const currentSessionIdAtom = atom<string | undefined>(undefined);

export const unreadSessionIdsAtom = atomWithStorage<string[]>("pideck:unread-session-ids:v1", [], undefined, { getOnInit: true });
export const markSessionReadAtom = atom(null, (get, set, sessionId: string) => {
	const current = get(unreadSessionIdsAtom);
	if (current.includes(sessionId))
		set(
			unreadSessionIdsAtom,
			current.filter((id) => id !== sessionId),
		);
});

export const sessionTabIdsAtom = atom<string[]>([]);
export const sessionRuntimeByIdAtom = atom<Record<string, SessionRuntimeViewState>>({});
export const sidebarRuntimeAtom = selectAtom(sessionRuntimeByIdAtom, (full) => {
	const slim: Record<string, { agentId?: string; status: string }> = {};
	for (const [id, rt] of Object.entries(full)) {
		slim[id] = { agentId: rt.agentId, status: rt.status ?? "detached" };
	}
	return slim;
});
export const sessionRuntimeUiByIdAtom = atom<Record<string, SessionRuntimeUiState>>({});

export const sessionCacheStatsAtom = atom<Record<string, { cacheHitHistory: number[] }>>({});
export const SESSION_CACHE_STATS_LIMIT = 50;
export const sessionMessagesCacheAtom = atom<Record<string, SessionMessageCacheEntry>>({});

let nextSessionMessageOutlineRevision = 0;
function allocateSessionMessageOutlineRevision(): number {
	nextSessionMessageOutlineRevision += 1;
	return nextSessionMessageOutlineRevision;
}

export type SessionHistoryMutationOverlayKind = "stopping" | "mutating" | "reloading" | "activating" | "forking" | "editing" | "resending";

export const sessionHistoryMutationOverlayByIdAtom = atom<Record<string, SessionHistoryMutationOverlayKind>>({});

export const setSessionHistoryMutationOverlayAtom = atom(null, (get, set, input: { sessionId: string; kind: SessionHistoryMutationOverlayKind | null }) => {
	const current = get(sessionHistoryMutationOverlayByIdAtom);
	if (input.kind === null) {
		if (!(input.sessionId in current)) return;
		const next = { ...current };
		delete next[input.sessionId];
		set(sessionHistoryMutationOverlayByIdAtom, next);
		return;
	}
	if (current[input.sessionId] === input.kind) return;
	set(sessionHistoryMutationOverlayByIdAtom, {
		...current,
		[input.sessionId]: input.kind,
	});
});

export const sessionMessageCacheBySessionIdAtomFamily = atomFamily((sessionId: string) => selectAtom(sessionMessagesCacheAtom, (cache) => cache[sessionId], Object.is));

export type SessionScrollAnchor = {
	messageId: string;

	offsetTop: number;

	windowTurns?: number;

	savedAt: number;
};

export const sessionScrollAnchorByIdAtom = atom<Record<string, SessionScrollAnchor>>({});

export function sameSessionScrollAnchor(a: SessionScrollAnchor | undefined, b: SessionScrollAnchor | undefined): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	return a.messageId === b.messageId && a.offsetTop === b.offsetTop && a.windowTurns === b.windowTurns;
}

export const saveSessionScrollAnchorAtom = atom(null, (get, set, input: { sessionId: string; anchor: SessionScrollAnchor | null }) => {
	const { sessionId, anchor } = input;
	set(sessionScrollAnchorByIdAtom, (prevMap) => {
		if (anchor === null) {
			if (!(sessionId in prevMap)) return prevMap;
			const nextMap = { ...prevMap };
			delete nextMap[sessionId];
			return nextMap;
		}
		const prev = prevMap[sessionId];

		if (prev && sameSessionScrollAnchor(prev, anchor)) return prevMap;

		if (prev && prev.savedAt > anchor.savedAt) return prevMap;
		return { ...prevMap, [sessionId]: anchor };
	});
});

export const streamingTextByIdAtom = atom<Record<string, { content: string; streaming: boolean; held?: boolean }>>({});

export const streamingThinkingByIdAtom = atom<Record<string, StreamingThinkingEntry>>({});

export const liveThinkingIdBySessionAtom = atom<Record<string, string>>({});

function sameStreamingThinkingEntry(a: StreamingThinkingEntry | undefined, b: StreamingThinkingEntry | undefined): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	return a.sessionId === b.sessionId && a.text === b.text && a.startedAt === b.startedAt && a.endedAt === b.endedAt && a.streaming === b.streaming;
}

export const streamingThinkingEntryByIdAtomFamily = atomFamily((thinkingId: string) => selectAtom(streamingThinkingByIdAtom, (map) => map[thinkingId], sameStreamingThinkingEntry));

export const liveThinkingIdBySessionIdAtomFamily = atomFamily((sessionId: string) => selectAtom(liveThinkingIdBySessionAtom, (map) => map[sessionId], Object.is));

export const liveTextStreamingBySessionAtom = atomFamily((sessionId: string) => selectAtom(streamingTextByIdAtom, (map) => map[sessionId]?.streaming === true, Object.is));

export const liveTextActiveBySessionAtom = atomFamily((sessionId: string) => selectAtom(streamingTextByIdAtom, (map) => map[sessionId]?.streaming === true || map[sessionId]?.held === true, Object.is));

export const liveThinkingStreamingBySessionAtom = atomFamily((sessionId: string) =>
	atom((get) => {
		const liveId = get(liveThinkingIdBySessionAtom)[sessionId];
		if (!liveId) return false;
		return get(streamingThinkingByIdAtom)[liveId]?.streaming === true;
	}),
);

function sameStreamingTextEntry(a: { content: string; streaming: boolean; held?: boolean } | undefined, b: { content: string; streaming: boolean; held?: boolean } | undefined): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	return a.content === b.content && a.streaming === b.streaming && a.held === b.held;
}

export const streamingTextBySessionIdAtomFamily = atomFamily((sessionId: string) => selectAtom(streamingTextByIdAtom, (map) => map[sessionId], sameStreamingTextEntry));

function disposeStreamingThinkingFamily(thinkingId: string) {
	streamingThinkingEntryByIdAtomFamily.remove(thinkingId);
}

export const newTurnCollapseTickByIdAtom = atom<Record<string, number>>({});

export const bumpNewTurnCollapseTickAtom = atom(null, (_get, set, sessionId: string) => {
	set(newTurnCollapseTickByIdAtom, (prev) => ({
		...prev,
		[sessionId]: (prev[sessionId] ?? 0) + 1,
	}));
});

export const newTurnCollapseTickBySessionIdAtomFamily = atomFamily((sessionId: string) => selectAtom(newTurnCollapseTickByIdAtom, (map) => map[sessionId] ?? 0, Object.is));

export const sendPinAnimatingByIdAtom = atom<Record<string, boolean>>({});

export const sendPinAnimatingBySessionIdAtomFamily = atomFamily((sessionId: string) => selectAtom(sendPinAnimatingByIdAtom, (map) => map[sessionId] === true, Object.is));

export type RunStepsVisibleMemoryEntry = {
	visible: boolean;

	atTick: number;
};

export const runStepsVisibleMemoryBySessionIdAtomFamily = atomFamily((sessionId: string) => atom<Record<string, RunStepsVisibleMemoryEntry>>({}));

export interface ProcessGroupOpenState {
	readonly autoGroupId: string | undefined;

	readonly manualGroupIds: readonly string[];

	readonly suppressedAutoGroupId: string | undefined;
}

export const processGroupOpenBySessionIdAtomFamily = atomFamily((sessionId: string) => atom<Record<string, ProcessGroupOpenState>>({}));

export const sessionMessageLruAtom = atom<string[]>([]);
export const sessionMessageLoadStateAtom = atom<Record<string, SessionLoadState>>({});
export const sessionCatalogLoadStateAtom = atom<Record<string, SessionLoadState>>({});

export const currentSessionAtom = atom((get) => {
	const sessionId = get(currentSessionIdAtom);
	return sessionId ? get(sessionRecordsAtom)[sessionId] : undefined;
});

export const currentSessionRuntimeAtom = atom((get) => {
	const sessionId = get(currentSessionIdAtom);
	return sessionId ? get(sessionRuntimeByIdAtom)[sessionId] : undefined;
});

export const currentSessionRuntimeUiAtom = atom((get) => {
	const sessionId = get(currentSessionIdAtom);
	return sessionId ? get(sessionRuntimeUiByIdAtom)[sessionId] : undefined;
});

export const currentSessionMessagesAtom = atom((get) => {
	const sessionId = get(currentSessionIdAtom);
	return sessionId ? (get(sessionMessagesCacheAtom)[sessionId]?.messages ?? []) : [];
});

export const replaceSessionRuntimesAtom = atom(null, (get, set, runtimes: SessionRuntimeInfo[]) => {
	const current = get(sessionRuntimeByIdAtom);
	const next = { ...current };
	for (const runtime of runtimes) {
		const existing = current[runtime.sessionId];
		if (existing && existing.runtimeGeneration > runtime.runtimeGeneration) continue;
		const bindingChanged = existing?.agentId !== runtime.agentId || existing.runtimeGeneration !== runtime.runtimeGeneration;

		if (bindingChanged && runtime.agentId && !runtime.noSession && (runtime.status === "starting" || runtime.status === "running" || runtime.status === "idle")) {
			set(touchRecentSessionAtom, { sessionId: runtime.sessionId, projectId: runtime.projectId });
		}
		next[runtime.sessionId] = {
			...(bindingChanged ? {} : existing),
			agentId: runtime.agentId,
			runtimeGeneration: runtime.runtimeGeneration,
			status: runtime.status,
			state: bindingChanged ? undefined : existing?.state,
			updatedAt: Date.now(),
			projectId: runtime.projectId,
			cwd: runtime.cwd,
			sessionPath: runtime.sessionPath,
			createdAt: runtime.createdAt,
			compactionCount: runtime.compactionCount,
			noSession: runtime.noSession,

			deckSessionId: runtime.deckSessionId ?? existing?.deckSessionId,
		};
	}
	set(sessionRuntimeByIdAtom, next);
});

export const replaceProjectSessionsAtom = atom(null, (get, set, input: { projectId: string; sessions: SessionRecord[] }) => {
	const discardedTransientIds = get(discardedTransientSessionIdsAtom);

	const sessions = input.sessions.filter((session) => !session.noSession || !discardedTransientIds.has(session.id));
	const previousIds = get(sessionIdsByProjectAtom)[input.projectId] ?? [];

	if (sameProjectSessionList(previousIds, get(sessionRecordsAtom), sessions)) return;
	const nextIds = sessions.map((session) => session.id);
	const nextIdSet = new Set(nextIds);
	const nextRecords = { ...get(sessionRecordsAtom) };

	const currentSessionId = get(currentSessionIdAtom);
	for (const previousId of previousIds) {
		if (!nextIdSet.has(previousId)) {
			delete nextRecords[previousId];
			if (previousId === currentSessionId) {
				set(currentSessionIdAtom, undefined);
			}
		}
	}
	for (const session of sessions) nextRecords[session.id] = session;
	set(sessionRecordsAtom, nextRecords);
	set(sessionIdsByProjectAtom, {
		...get(sessionIdsByProjectAtom),
		[input.projectId]: nextIds,
	});
});

export const upsertSessionAtom = atom(null, (get, set, session: SessionRecord) => {
	if (session.noSession && get(discardedTransientSessionIdsAtom).has(session.id)) {
		const nextDiscarded = new Set(get(discardedTransientSessionIdsAtom));
		nextDiscarded.delete(session.id);
		set(discardedTransientSessionIdsAtom, nextDiscarded);
	}
	set(sessionRecordsAtom, {
		...get(sessionRecordsAtom),
		[session.id]: session,
	});
	const projectIds = get(sessionIdsByProjectAtom)[session.projectId] ?? [];
	if (!projectIds.includes(session.id)) {
		set(sessionIdsByProjectAtom, {
			...get(sessionIdsByProjectAtom),
			[session.projectId]: [session.id, ...projectIds],
		});
	}
});

export const setSessionCatalogLoadStateAtom = atom(null, (get, set, input: { projectId: string; state: SessionLoadState }) => {
	set(sessionCatalogLoadStateAtom, {
		...get(sessionCatalogLoadStateAtom),
		[input.projectId]: input.state,
	});
});

export const setSessionMessageLoadStateAtom = atom(null, (get, set, input: { sessionId: string; state: SessionLoadState }) => {
	set(sessionMessageLoadStateAtom, {
		...get(sessionMessageLoadStateAtom),
		[input.sessionId]: input.state,
	});
});

export const cacheSessionMessagesAtom = atom(
	null,
	(
		get,
		set,
		input: {
			sessionId: string;
			messages: ChatMessage[];
			source: "disk" | "runtime";
			expectedRevision?: number;
			page?: Pick<SessionMessagePage, "total" | "totalTurns" | "nextBefore">;

			windowStart?: number;

			cardCount?: number;

			windowStartFilePos?: number;
			history?: SessionMessageCacheEntry["history"];

			outlineChanged?: boolean;

			force?: boolean;
		},
	) => {
		const cache = get(sessionMessagesCacheAtom);
		const current = cache[input.sessionId];

		if (!input.force && input.expectedRevision !== undefined && input.source === "disk" && current?.source === "disk" && (current.revision ?? 0) !== input.expectedRevision) {
			return false;
		}

		if (!input.force && input.source === "disk" && current?.source !== "disk" && current?.messages?.length >= input.messages.length) {
			return false;
		}
		const outlineChanged = input.outlineChanged !== false;
		const shouldReplaceOutlineProjection = outlineChanged || current?.outlineRevision === undefined;
		const outlineRevision = shouldReplaceOutlineProjection ? allocateSessionMessageOutlineRevision() : current.outlineRevision;
		const outlineLastUserIndex = outlineChanged ? findLastUserMessageIndex(input.messages) : (current?.outlineLastUserIndex ?? findLastUserMessageIndex(input.messages));
		if (shouldReplaceOutlineProjection) releaseSessionOutlineProjection(input.sessionId);
		const revision = input.source === "runtime" ? (current?.revision ?? 0) + 1 : (current?.revision ?? 0);

		const storedHistory = input.source === "runtime" ? input.history : undefined;
		const previousTurns = current ? countUserTurns(current.messages) : 0;
		const nextTurns = countUserTurns(input.messages);
		const previousTotalTurns = current?.totalTurns ?? current?.page?.totalTurns ?? previousTurns;
		const totalTurns = input.page?.totalTurns ?? previousTotalTurns + Math.max(0, nextTurns - previousTurns);
		const nextCache = {
			...cache,
			[input.sessionId]: {
				messages: input.messages,
				revision,
				source: input.source,
				updatedAt: Date.now(),
				outlineRevision,
				outlineLastUserIndex,
				totalTurns,

				bytes: estimateSessionCacheEntryBytes(input.messages, storedHistory?.messages),
				...(input.source === "disk" && input.page ? { page: input.page } : {}),
				...(input.source === "runtime"
					? {
							windowStart: input.windowStart && input.windowStart > 0 ? input.windowStart : undefined,
							history: storedHistory,

							...(typeof input.cardCount === "number" ? { cardCount: input.cardCount } : {}),

							...(typeof input.windowStartFilePos === "number" ? { windowStartFilePos: input.windowStartFilePos } : {}),
						}
					: {}),
			},
		};
		const lru = [input.sessionId, ...get(sessionMessageLruAtom).filter((id) => id !== input.sessionId)];

		const openedTabs = new Set(get(sessionTabIdsAtom));
		let retainedIds = selectRetainedCacheEntryIds(lru, openedTabs, SESSION_MESSAGE_CACHE_LIMIT);

		const bytesById = new Map<string, number>();
		for (const id of retainedIds) {
			const entry = nextCache[id];
			if (!entry) continue;
			if (entry.bytes === undefined) {
				nextCache[id] = { ...entry, bytes: estimateSessionCacheEntryBytes(entry.messages, entry.history?.messages) };
			}
			bytesById.set(id, nextCache[id].bytes ?? 0);
		}
		const byteTrim = selectByteBudgetEvictions(retainedIds, bytesById, openedTabs, SESSION_CACHE_CLOSED_ENTRY_BYTE_BUDGET);
		retainedIds = byteTrim.retained;
		for (const cachedSessionId of Object.keys(nextCache)) {
			if (!retainedIds.includes(cachedSessionId)) {
				delete nextCache[cachedSessionId];
				releaseSessionOutlineProjection(cachedSessionId);
			}
		}
		set(sessionMessagesCacheAtom, nextCache);
		set(sessionMessageLruAtom, retainedIds);
		return true;
	},
);

export const DISK_HISTORY_MESSAGE_LIMIT = 2400;

export const RUNTIME_HISTORY_PREFIX_MESSAGE_LIMIT = DISK_HISTORY_MESSAGE_LIMIT;

function firstHistoryEntryId(messages: ChatMessage[]): string | undefined {
	for (const message of messages) {
		const entryId = message.meta?.entryId;
		if (typeof entryId === "string" && entryId) return entryId;
	}
	return undefined;
}

export const prependSessionMessagePageAtom = atom(
	null,
	(
		get,
		set,
		input: {
			sessionId: string;
			before: number;
			expectedRevision: number;
			page: SessionMessagePage;
		},
	) => {
		const current = get(sessionMessagesCacheAtom)[input.sessionId];
		if (!current || current.source !== "disk" || current.revision !== input.expectedRevision || current.page?.nextBefore !== input.before) {
			return false;
		}

		const existingKeys = new Set(current.messages.map(messageEntryKey));
		const freshMessages = input.page.messages.filter((message) => !existingKeys.has(messageEntryKey(message)));
		const messages = [...freshMessages, ...current.messages];

		let nextBefore = input.page.nextBefore;
		const overflow = messages.length - DISK_HISTORY_MESSAGE_LIMIT;
		if (overflow > 0 && freshMessages.length > 0) {
			const dropCount = Math.min(overflow, freshMessages.length);
			messages.splice(0, dropCount);
			if (overflow >= freshMessages.length) {
				nextBefore = input.before;
			} else if (input.page.nextBefore !== null) {
				nextBefore = input.page.nextBefore + dropCount;
			}
		}
		releaseSessionOutlineProjection(input.sessionId);
		set(sessionMessagesCacheAtom, {
			...get(sessionMessagesCacheAtom),
			[input.sessionId]: {
				...current,
				messages,
				page: { total: input.page.total, ...(input.page.totalTurns !== undefined ? { totalTurns: input.page.totalTurns } : {}), nextBefore },
				updatedAt: Date.now(),
				outlineRevision: allocateSessionMessageOutlineRevision(),
				outlineLastUserIndex: findLastUserMessageIndex(messages),
			},
		});
		return true;
	},
);
export const touchSessionMessagesAtom = atom(null, (get, set, sessionId: string) => {
	if (!get(sessionMessagesCacheAtom)[sessionId]) return;
	set(sessionMessageLruAtom, [sessionId, ...get(sessionMessageLruAtom).filter((id) => id !== sessionId)].slice(0, SESSION_MESSAGE_CACHE_LIMIT));
});

export const promoteSessionMessagesCacheAtom = atom(null, (get, set, input: { fromSessionId: string; toSessionId: string }) => {
	if (input.fromSessionId === input.toSessionId) return;
	const source = get(sessionMessagesCacheAtom)[input.fromSessionId];
	if (!source) return;
	if (source.messages.length > 0) {
		const existing = get(sessionMessagesCacheAtom)[input.toSessionId]?.messages ?? [];
		set(cacheSessionMessagesAtom, {
			sessionId: input.toSessionId,
			messages: [...existing, ...source.messages],
			source: "runtime",
		});
	}
	releaseSessionOutlineProjection(input.fromSessionId);
	const cache = { ...get(sessionMessagesCacheAtom) };
	delete cache[input.fromSessionId];
	set(sessionMessagesCacheAtom, cache);
	set(
		sessionMessageLruAtom,
		get(sessionMessageLruAtom).filter((id) => id !== input.fromSessionId),
	);
});

function messageEntryKey(message: ChatMessage): string {
	const entryId = message.meta?.entryId;
	return typeof entryId === "string" && entryId ? `e:${entryId}` : `m:${message.id}`;
}

export function isSameSessionFileGeneration(prefixVersion: string | undefined, flushVersion: string | undefined): boolean {
	if (!flushVersion) return true;
	if (!prefixVersion) return false;
	if (prefixVersion === flushVersion) return true;
	const readSize = (version: string): number | undefined => {
		const size = Number(version.slice(version.lastIndexOf(":") + 1));
		return Number.isFinite(size) ? size : undefined;
	};
	const prefixSize = readSize(prefixVersion);
	const flushSize = readSize(flushVersion);
	if (prefixSize === undefined || flushSize === undefined) return false;

	return flushSize >= prefixSize;
}

function reconcileHistoryPrefix(history: SessionMessageCacheEntry["history"], segment: ChatMessage[], fileVersion?: string, slideOut?: ChatMessage[]): SessionMessageCacheEntry["history"] {
	if (!history && (!slideOut || slideOut.length === 0)) return undefined;

	if (fileVersion && !isSameSessionFileGeneration(history?.version, fileVersion)) {
		history = undefined;
	}
	const segmentKeys = new Set(segment.map(messageEntryKey));

	const slideMessages = (slideOut ?? []).filter((message) => !segmentKeys.has(messageEntryKey(message)));
	const slideKeys = new Set(slideMessages.map(messageEntryKey));

	const dropKeys = new Set([...segmentKeys, ...slideKeys]);
	const prefixMessages = (history?.messages ?? []).filter((message) => !dropKeys.has(messageEntryKey(message)));
	const messages = [...prefixMessages, ...slideMessages];
	if (messages.length === 0) return undefined;

	const overflow = messages.length - RUNTIME_HISTORY_PREFIX_MESSAGE_LIMIT;
	const cappedMessages = overflow > 0 ? messages.slice(overflow) : messages;

	if (slideMessages.length === 0 && cappedMessages.length === (history?.messages.length ?? 0)) {
		return history;
	}

	let nextBeforeEntryId = history?.nextBeforeEntryId;
	if (!history) {
		const slideAnchor = slideMessages.find((message) => typeof message.meta?.entryId === "string" && Boolean(message.meta.entryId));
		const slideAnchorEntryId = slideAnchor?.meta?.entryId;
		if (typeof slideAnchorEntryId === "string") nextBeforeEntryId = slideAnchorEntryId;
	}
	if (overflow > 0) {
		nextBeforeEntryId = firstHistoryEntryId(cappedMessages) ?? history?.nextBeforeEntryId;
	}
	return {
		nextBefore: overflow > 0 && typeof history?.nextBefore === "number" ? history.nextBefore + overflow : (history?.nextBefore ?? null),
		...(nextBeforeEntryId !== undefined ? { nextBeforeEntryId } : {}),
		version: history?.version ?? fileVersion,
		messages: cappedMessages,
	};
}

function historyPrefixFromDiskPage(current: SessionMessageCacheEntry | undefined): SessionMessageCacheEntry["history"] | undefined {
	if (!current || current.source !== "disk" || current.messages.length === 0) return undefined;
	const version = current.page?.indexVersion;
	if (!version) return undefined;
	return {
		messages: current.messages,

		nextBefore: current.page?.nextBefore ?? null,
		...(current.page?.nextBeforeEntryId ? { nextBeforeEntryId: current.page.nextBeforeEntryId } : {}),
		version,
	};
}

export const prependSessionHistoryPageAtom = atom(
	null,
	(
		get,
		set,
		input: {
			sessionId: string;
			expectedRevision: number;

			before?: number | null;
			page: SessionMessagePage;
		},
	) => {
		const current = get(sessionMessagesCacheAtom)[input.sessionId];
		if (!current || current.source !== "runtime" || current.revision !== input.expectedRevision) {
			return false;
		}
		if (current.history && current.history.nextBefore !== input.before) return false;
		if (!current.history && input.before !== undefined) return false;

		const segmentKeys = new Set(current.messages.map(messageEntryKey));
		const pageMessages = input.page.messages.filter((message) => !segmentKeys.has(messageEntryKey(message)));
		const stalePrefix = Boolean(current.history?.version && input.page.indexVersion && current.history.version !== input.page.indexVersion);
		const baseMessages = stalePrefix ? [] : (current.history?.messages ?? []);
		const baseKeys = new Set(baseMessages.map(messageEntryKey));
		const freshMessages = pageMessages.filter((message) => !baseKeys.has(messageEntryKey(message)));
		const merged = [...freshMessages, ...baseMessages];

		const overflow = merged.length - RUNTIME_HISTORY_PREFIX_MESSAGE_LIMIT;
		let cappedMessages = merged;
		let nextBefore: number | null = input.page.nextBefore;
		let nextBeforeEntryId: string | undefined = input.page.nextBeforeEntryId || undefined;
		if (overflow > 0 && freshMessages.length > 0) {
			const dropCount = Math.min(overflow, freshMessages.length);
			cappedMessages = merged.slice(dropCount);
			if (dropCount >= freshMessages.length) {
				nextBefore = input.before ?? null;
			} else if (input.page.nextBefore !== null) {
				nextBefore = input.page.nextBefore + dropCount;
			}
			nextBeforeEntryId = firstHistoryEntryId(cappedMessages);
		}
		releaseSessionOutlineProjection(input.sessionId);

		set(sessionMessagesCacheAtom, {
			...get(sessionMessagesCacheAtom),
			[input.sessionId]: {
				...current,
				history:
					cappedMessages.length > 0 || nextBefore !== null
						? {
								messages: cappedMessages,
								nextBefore,
								...(nextBeforeEntryId !== undefined ? { nextBeforeEntryId } : {}),
								version: input.page.indexVersion ?? current.history?.version,
							}
						: undefined,
				updatedAt: Date.now(),
				outlineRevision: allocateSessionMessageOutlineRevision(),
				outlineLastUserIndex: current.outlineLastUserIndex ?? findLastUserMessageIndex(current.messages),
			},
		});
		return true;
	},
);

export const clearSessionHistoryAtom = atom(null, (get, set, sessionId: string) => {
	const current = get(sessionMessagesCacheAtom)[sessionId];
	if (!current || current.source !== "runtime" || !current.history) return false;
	releaseSessionOutlineProjection(sessionId);
	set(sessionMessagesCacheAtom, {
		...get(sessionMessagesCacheAtom),
		[sessionId]: {
			...current,
			history: undefined,
			updatedAt: Date.now(),
			outlineRevision: allocateSessionMessageOutlineRevision(),
			outlineLastUserIndex: current.outlineLastUserIndex ?? findLastUserMessageIndex(current.messages),
		},
	});
	return true;
});
function toAgentUiRequest(payload: Record<string, unknown>, agentId: string): AgentUiRequest | undefined {
	const requestId = typeof payload.requestId === "string" ? payload.requestId : "";
	if (!requestId) return undefined;
	const batchQuestions: AgentUiBatchQuestion[] | undefined = Array.isArray(payload.batchQuestions)
		? payload.batchQuestions.reduce<AgentUiBatchQuestion[]>((questions, question) => {
				if (!question || typeof question !== "object") return questions;
				const typed = question as Record<string, unknown>;
				if (typeof typed.id !== "string" || typeof typed.question !== "string" || !["select", "multi_select", "confirm", "input", "editor"].includes(String(typed.type))) {
					return questions;
				}
				const options = Array.isArray(typed.options)
					? typed.options.reduce<NonNullable<AgentUiBatchQuestion["options"]>>((items, option) => {
							if (typeof option === "string") {
								items.push(option);
								return items;
							}
							if (!option || typeof option !== "object") return items;
							const typedOption = option as Record<string, unknown>;
							if (typeof typedOption.label !== "string") return items;
							items.push({
								label: typedOption.label,
								...(typeof typedOption.value === "string" ? { value: typedOption.value } : {}),
								...(typeof typedOption.description === "string" ? { description: typedOption.description } : {}),
							});
							return items;
						}, [])
					: undefined;
				questions.push({
					id: typed.id,
					type: typed.type as AgentUiBatchQuestion["type"],
					question: typed.question,
					...(options?.length ? { options } : {}),
					...(typeof typed.allowOther === "boolean" ? { allowOther: typed.allowOther } : {}),
					...(typeof typed.placeholder === "string" ? { placeholder: typed.placeholder } : {}),
					...(typeof typed.prefill === "string" ? { prefill: typed.prefill } : {}),
				});
				return questions;
			}, [])
		: undefined;
	return {
		agentId,
		requestId,
		method: typeof payload.method === "string" ? payload.method : "",
		title: typeof payload.title === "string" ? payload.title : "",
		options: Array.isArray(payload.options) ? payload.options.filter((option): option is string => typeof option === "string") : undefined,
		placeholder: typeof payload.placeholder === "string" ? payload.placeholder : undefined,
		prefill: typeof payload.prefill === "string" ? payload.prefill : undefined,
		allowOther: payload.allowOther === true,
		completed: payload.completed === true,
		value: typeof payload.value === "string" || typeof payload.value === "boolean" ? payload.value : undefined,
		confirmed: typeof payload.confirmed === "boolean" ? payload.confirmed : undefined,
		cancelled: payload.cancelled === true,
		message: typeof payload.message === "string" ? payload.message : undefined,
		notifyType: payload.notifyType === "info" || payload.notifyType === "warning" || payload.notifyType === "error" ? payload.notifyType : undefined,
		text: typeof payload.text === "string" ? payload.text : undefined,
		widgetKey: typeof payload.widgetKey === "string" ? payload.widgetKey : undefined,
		widgetLines: Array.isArray(payload.widgetLines) ? payload.widgetLines.filter((line): line is string => typeof line === "string") : undefined,
		widgetPlacement: payload.widgetPlacement === "aboveEditor" || payload.widgetPlacement === "belowEditor" ? payload.widgetPlacement : undefined,
		batchQuestions: batchQuestions?.length ? batchQuestions : undefined,
		batchReview: payload.batchReview === true,
	};
}

function clearSessionLiveThinking(get: Getter, set: Setter, sessionId: string) {
	const liveId = get(liveThinkingIdBySessionAtom)[sessionId];
	const idsToDispose: string[] = [];
	if (liveId) {
		idsToDispose.push(liveId);
		set(streamingThinkingByIdAtom, (prevMap) => {
			if (!(liveId in prevMap)) return prevMap;
			const nextMap = { ...prevMap };
			delete nextMap[liveId];
			return nextMap;
		});
	} else {
		const map = get(streamingThinkingByIdAtom);
		const leftoverIds = Object.entries(map)
			.filter(([, entry]) => entry.sessionId === sessionId)
			.map(([id]) => id);
		if (leftoverIds.length > 0) {
			idsToDispose.push(...leftoverIds);
			set(streamingThinkingByIdAtom, (prevMap) => {
				const nextMap = { ...prevMap };
				for (const id of leftoverIds) delete nextMap[id];
				return nextMap;
			});
		}
	}
	set(liveThinkingIdBySessionAtom, (prevMap) => {
		if (!(sessionId in prevMap)) return prevMap;
		const nextMap = { ...prevMap };
		delete nextMap[sessionId];
		return nextMap;
	});
	for (const id of idsToDispose) disposeStreamingThinkingFamily(id);
}

function tryReleaseHeldLiveTextAfterHistory(get: Getter, set: Setter, sessionId: string) {
	const live = get(streamingTextByIdAtom)[sessionId];
	if (!live?.held) return;
	const messages = get(sessionMessagesCacheAtom)[sessionId]?.messages ?? [];
	if (!shouldReleaseHeldLiveText(messages)) return;
	set(streamingTextByIdAtom, (prevMap) => {
		if (!(sessionId in prevMap)) return prevMap;
		const nextMap = { ...prevMap };
		delete nextMap[sessionId];
		return nextMap;
	});
}

function tryReleaseLiveThinkingAfterHistory(get: Getter, set: Setter, sessionId: string) {
	const liveId = get(liveThinkingIdBySessionAtom)[sessionId];
	if (!liveId?.startsWith("msg-thinking-")) return;
	const messageId = liveId.slice("msg-thinking-".length);
	if (!messageId) return;
	const messages = get(sessionMessagesCacheAtom)[sessionId]?.messages ?? [];
	const ready = messages.some((message) => message.id === messageId && Boolean(message.thinking?.trim()));
	if (!ready) return;
	set(streamingThinkingByIdAtom, (prevMap) => {
		if (!(liveId in prevMap)) return prevMap;
		const nextMap = { ...prevMap };
		delete nextMap[liveId];
		return nextMap;
	});
	set(liveThinkingIdBySessionAtom, (prevMap) => {
		if (prevMap[sessionId] !== liveId) return prevMap;
		const nextMap = { ...prevMap };
		delete nextMap[sessionId];
		return nextMap;
	});

	disposeStreamingThinkingFamily(liveId);
}

function applySessionRuntimeUiEvent(current: SessionRuntimeUiState | undefined, event: SessionRuntimeEvent, payload: Record<string, unknown>, bindingChanged: boolean): SessionRuntimeUiState | undefined {
	const base =
		!current || bindingChanged || current.agentId !== event.agentId || current.runtimeGeneration !== event.runtimeGeneration
			? {
					agentId: event.agentId,
					runtimeGeneration: event.runtimeGeneration,
					requests: {},
					widgets: {},
					revision: 0,
				}
			: current;
	if ((event.sourceChannel === "agents:state" || event.sourceChannel === "sessions:runtime") && payload.status === "closed") {
		return {
			agentId: event.agentId,
			runtimeGeneration: event.runtimeGeneration,
			requests: {},
			widgets: {},
			revision: base.revision + 1,
		};
	}
	if (event.sourceChannel !== "agents:ui-request") return bindingChanged ? base : current;
	const request = toAgentUiRequest(payload, event.agentId);
	if (!request) return base;
	const revision = base.revision + 1;

	if (request.completed) {
		const existing = base.requests[request.requestId];
		if (!existing) return { ...base, revision };
		return {
			...base,
			revision,
			requests: {
				...base.requests,
				[request.requestId]: {
					request: { ...existing.request, ...request },
					status: request.cancelled ? "cancelled" : "completed",
				},
			},
		};
	}
	if (request.method === "notify") {
		return request.message
			? {
					...base,
					revision,
					notification: {
						requestId: request.requestId,
						message: request.message,
						notifyType: request.notifyType,
						revision,
					},
				}
			: { ...base, revision };
	}
	if (request.method === "set_editor_text") {
		return {
			...base,
			revision,
			editorText: {
				requestId: request.requestId,
				text: request.text ?? "",
				revision,
			},
		};
	}
	if (request.method === "setWidget") {
		const widgetKey = request.widgetKey || request.requestId;
		const widgets = { ...base.widgets };
		if (request.widgetLines?.length) widgets[widgetKey] = request.widgetLines;
		else delete widgets[widgetKey];
		return { ...base, revision, widgets };
	}
	if (!["select", "confirm", "input", "editor", "batch_ask"].includes(request.method)) {
		return { ...base, revision };
	}
	return {
		...base,
		revision,
		requests: {
			...base.requests,
			[request.requestId]: { request, status: "pending" },
		},
	};
}

export const applySessionRuntimeEventAtom = atom(null, (get, set, event: SessionRuntimeEvent) => {
	const currentRuntime = get(sessionRuntimeByIdAtom)[event.sessionId] ?? {
		runtimeGeneration: 0,
		status: "detached" as const,
		updatedAt: 0,
	};
	if (event.kind === "detach") {
		if (event.runtimeGeneration < currentRuntime.runtimeGeneration || (currentRuntime.agentId && currentRuntime.agentId !== event.agentId)) {
			return;
		}

		if (get(sessionRecordsAtom)[event.sessionId]?.noSession) {
			set(discardedTransientSessionIdsAtom, new Set(get(discardedTransientSessionIdsAtom)).add(event.sessionId));
			set(removeSessionStateAtom, event.sessionId);
			return;
		}
		const nextUiById = { ...get(sessionRuntimeUiByIdAtom) };
		delete nextUiById[event.sessionId];
		set(sessionRuntimeUiByIdAtom, nextUiById);
		clearSessionLiveThinking(get, set, event.sessionId);
		set(sessionRuntimeByIdAtom, {
			...get(sessionRuntimeByIdAtom),
			[event.sessionId]: {
				runtimeGeneration: event.runtimeGeneration,
				status: "detached",
				updatedAt: Date.now(),
			},
		});
		return;
	}
	if (event.runtimeGeneration < currentRuntime.runtimeGeneration) return;
	if (event.runtimeGeneration === currentRuntime.runtimeGeneration && currentRuntime.agentId && currentRuntime.agentId !== event.agentId) {
		return;
	}
	const bindingChanged = event.runtimeGeneration > currentRuntime.runtimeGeneration || currentRuntime.agentId !== event.agentId;

	if (event.sourceChannel === "agents:event") return;

	let nextRuntime: SessionRuntimeViewState = {
		...(bindingChanged
			? {
					runtimeGeneration: event.runtimeGeneration,
					status: "detached" as const,
					updatedAt: 0,

					state: undefined,
				}
			: currentRuntime),
		agentId: event.agentId,
		runtimeGeneration: event.runtimeGeneration,
		updatedAt: Date.now(),
	};
	if (bindingChanged) {
		clearSessionLiveThinking(get, set, event.sessionId);
	}
	const payload = event.payload && typeof event.payload === "object" ? (event.payload as Record<string, unknown>) : undefined;

	if ((event.sourceChannel === "agents:state" || event.sourceChannel === "sessions:runtime") && payload) {
		const status = payload.status;

		if (status !== currentRuntime.status && (status === "starting" || status === "running" || (currentRuntime.status === "running" && status === "idle"))) {
			const record = get(sessionRecordsAtom)[event.sessionId];
			if (record && !record.noSession) set(touchRecentSessionAtom, { sessionId: record.id, projectId: record.projectId });
		}
		if (status === "starting" || status === "idle" || status === "running" || status === "error" || status === "closed") {
			if (currentRuntime.status === "running" && status === "idle" && get(currentSessionIdAtom) !== event.sessionId) {
				const unread = get(unreadSessionIdsAtom);
				if (!unread.includes(event.sessionId)) set(unreadSessionIdsAtom, [...unread, event.sessionId]);
			}
			nextRuntime = {
				...nextRuntime,
				status,

				state: status === "error" || status === "closed" ? (nextRuntime.state?.contextOverflow ? { contextOverflow: true } : undefined) : nextRuntime.state,
				projectId: typeof payload.projectId === "string" ? payload.projectId : nextRuntime.projectId,
				cwd: typeof payload.cwd === "string" ? payload.cwd : nextRuntime.cwd,
				title: typeof payload.title === "string" ? payload.title : nextRuntime.title,
				piSessionId: typeof payload.sessionId === "string" ? payload.sessionId : nextRuntime.piSessionId,
				sessionPath: typeof payload.sessionPath === "string" ? payload.sessionPath : nextRuntime.sessionPath,
				deckSessionId: typeof payload.deckSessionId === "string" ? payload.deckSessionId : nextRuntime.deckSessionId,
				createdAt: typeof payload.createdAt === "number" ? payload.createdAt : nextRuntime.createdAt,
				compactionCount: typeof payload.compactionCount === "number" ? payload.compactionCount : nextRuntime.compactionCount,
				noSession: payload.noSession === true || nextRuntime.noSession,

				backend: payload.backend === "acp" || payload.backend === "qoder" ? payload.backend : (nextRuntime.backend ?? "pi"),
			};
		}

		const pendingSend = get(sessionSendStateByIdAtom)[event.sessionId];
		if (pendingSend?.status === "activating" && (status === "starting" || status === "idle" || status === "running")) {
			set(setSessionSendStateAtom, { sessionId: event.sessionId, state: { status: "sending", requestId: pendingSend.requestId } });
		}
	} else if (event.sourceChannel === "agents:runtime-state" && payload?.state) {
		const terminal = nextRuntime.status === "error" || nextRuntime.status === "closed";
		if (!terminal) {
			nextRuntime = {
				...nextRuntime,
				state: mergeAgentRuntimeState(nextRuntime.state, payload.state as AgentRuntimeState),
			};

			const hitPercent = (payload.state as AgentRuntimeState).cacheHitPercent;
			if (typeof hitPercent === "number" && Number.isFinite(hitPercent)) {
				const currentStats = get(sessionCacheStatsAtom)[event.sessionId] ?? { cacheHitHistory: [] };
				const history = currentStats.cacheHitHistory;
				if (history[history.length - 1] === hitPercent) {
				} else {
					const nextHistory = [...history, hitPercent].slice(-SESSION_CACHE_STATS_LIMIT);
					set(sessionCacheStatsAtom, {
						...get(sessionCacheStatsAtom),
						[event.sessionId]: { cacheHitHistory: nextHistory },
					});
				}
			}
		}
	} else if (event.sourceChannel === "agents:thinking" && payload) {
		const id = typeof payload.id === "string" ? payload.id : "";
		const fullText = typeof payload.text === "string" ? payload.text : typeof payload.thinking === "string" ? payload.thinking : "";
		const delta = typeof payload.delta === "string" ? payload.delta : "";
		const done = payload.done === true;
		const startedAt = typeof payload.startedAt === "number" ? payload.startedAt : Date.now();
		const endedAt = typeof payload.endedAt === "number" ? payload.endedAt : 0;
		if (id) {
			if (done) {
				const prev = get(streamingThinkingByIdAtom)[id];

				const text = fullText || (delta && prev ? prev.text + delta : "") || prev?.text || "";
				const nextEntry: StreamingThinkingEntry = {
					sessionId: event.sessionId,
					text,
					startedAt: prev?.startedAt ?? startedAt,
					endedAt: endedAt > 0 ? endedAt : prev?.endedAt && prev.endedAt > 0 ? prev.endedAt : Date.now(),
					streaming: false,
				};
				if (!prev || prev.text !== nextEntry.text || prev.startedAt !== nextEntry.startedAt || prev.endedAt !== nextEntry.endedAt || prev.streaming !== false || prev.sessionId !== event.sessionId) {
					set(streamingThinkingByIdAtom, {
						...get(streamingThinkingByIdAtom),
						[id]: nextEntry,
					});
				}
				if (get(liveThinkingIdBySessionAtom)[event.sessionId] !== id) {
					set(liveThinkingIdBySessionAtom, {
						...get(liveThinkingIdBySessionAtom),
						[event.sessionId]: id,
					});
				}
				tryReleaseLiveThinkingAfterHistory(get, set, event.sessionId);
			} else {
				const streaming = endedAt <= 0;
				const prev = get(streamingThinkingByIdAtom)[id];

				const text = delta ? (prev?.text ?? "") + delta : fullText;
				if (!prev || prev.text !== text || prev.startedAt !== startedAt || prev.endedAt !== endedAt || prev.streaming !== streaming || prev.sessionId !== event.sessionId) {
					set(streamingThinkingByIdAtom, {
						...get(streamingThinkingByIdAtom),
						[id]: {
							sessionId: event.sessionId,
							text,
							startedAt,
							endedAt,
							streaming,
						},
					});
				}
				if (get(liveThinkingIdBySessionAtom)[event.sessionId] !== id) {
					set(liveThinkingIdBySessionAtom, {
						...get(liveThinkingIdBySessionAtom),
						[event.sessionId]: id,
					});
				}
			}
		}
		if (bindingChanged) {
			set(sessionRuntimeByIdAtom, {
				...get(sessionRuntimeByIdAtom),
				[event.sessionId]: nextRuntime,
			});
		}
		return;
	} else if (event.sourceChannel === "agents:text-stream" && payload) {
		const prev = get(streamingTextByIdAtom)[event.sessionId];

		const incoming = typeof payload.delta === "string" ? (prev?.content ?? "") + payload.delta : typeof payload.text === "string" ? payload.text : (prev?.content ?? "");
		const done = payload.done === true;
		const reset = payload.reset === true;
		const text = resolveStreamingTextUpdate(prev?.content ?? "", incoming, done, reset);
		const historyReady = shouldReleaseHeldLiveText(get(sessionMessagesCacheAtom)[event.sessionId]?.messages ?? []);
		const hold = shouldHoldLiveText({
			done,
			reset,
			liveText: text,
			historyHasAssistantText: historyReady,
		});
		const streaming = !done && text.length > 0;
		if (!prev || prev.content !== text || prev.streaming !== streaming || prev.held !== hold) {
			set(streamingTextByIdAtom, {
				...get(streamingTextByIdAtom),
				[event.sessionId]: { content: text, streaming, held: hold || undefined },
			});
		}
		if (done && !hold) {
			set(streamingTextByIdAtom, (prevMap) => {
				if (!(event.sessionId in prevMap)) return prevMap;
				const nextMap = { ...prevMap };
				delete nextMap[event.sessionId];
				return nextMap;
			});
		}
		if (bindingChanged) {
			set(sessionRuntimeByIdAtom, {
				...get(sessionRuntimeByIdAtom),
				[event.sessionId]: nextRuntime,
			});
		}
		return;
	} else if ((event.sourceChannel === "agents:message" || event.sourceChannel === "sessions:messages") && payload) {
		if (event.runtimeGeneration === currentRuntime.runtimeGeneration && !currentRuntime.agentId && (currentRuntime.status === "detached" || currentRuntime.status === "closed")) {
			return;
		}
		const messages = payload.messages;

		const upsertFrom = typeof payload.upsertFrom === "number" ? payload.upsertFrom : undefined;
		const totalLength = typeof payload.totalLength === "number" ? payload.totalLength : undefined;
		const payloadWindowStart = typeof payload.windowStart === "number" ? payload.windowStart : undefined;
		const payloadWindowStartFilePos = typeof payload.windowStartFilePos === "number" ? payload.windowStartFilePos : undefined;
		const fileVersion = typeof payload.fileVersion === "string" ? payload.fileVersion : undefined;
		if (Array.isArray(messages)) {
			const current = get(sessionMessagesCacheAtom)[event.sessionId];
			if (upsertFrom !== undefined && totalLength !== undefined) {
				const W = current?.windowStart ?? 0;
				const cardCount = current?.cardCount ?? 0;
				const offset = upsertFrom - W + cardCount;
				if (current?.source === "runtime" && offset >= 0 && current.messages.length >= offset) {
					const merged = [...current.messages.slice(0, offset), ...(messages as ChatMessage[])];
					const outlineChanged = shouldRefreshOutlineForRuntimeUpsert(current.messages, current.outlineLastUserIndex, offset, messages);

					if (merged.length === totalLength - W + cardCount) {
						set(cacheSessionMessagesAtom, {
							sessionId: event.sessionId,
							messages: carryPendingUserMessages(current.messages, merged),
							source: "runtime",
							windowStart: W,
							outlineChanged,
							history: current.history,
							cardCount,
						});
					}
				}
			} else {
				const segment = messages as ChatMessage[];

				const W = payloadWindowStart ?? 0;
				const cardCount = Math.max(0, segment.length - (totalLength ?? segment.length) + W);

				const slideOut = Array.isArray(payload.slideOut) ? (payload.slideOut as ChatMessage[]) : undefined;

				set(cacheSessionMessagesAtom, {
					sessionId: event.sessionId,

					messages: carryPendingUserMessages(current?.messages ?? [], segment),
					source: "runtime",
					windowStart: payloadWindowStart,
					cardCount,
					history: reconcileHistoryPrefix(current?.history ?? historyPrefixFromDiskPage(current), segment, fileVersion, slideOut),
					...(typeof payloadWindowStartFilePos === "number" ? { windowStartFilePos: payloadWindowStartFilePos } : {}),
				});
			}

			tryReleaseLiveThinkingAfterHistory(get, set, event.sessionId);
			tryReleaseHeldLiveTextAfterHistory(get, set, event.sessionId);
		}
	}

	set(advanceSessionActivityAnchorAtom, {
		sessionId: event.sessionId,

		previousRunning: bindingChanged ? false : isSessionTurnRunning(currentRuntime.state, currentRuntime.status),
		running: isSessionTurnRunning(nextRuntime.state, nextRuntime.status),
	});
	const terminalEnvelope = !bindingChanged && currentRuntime.status === "closed";
	const previousUi = get(sessionRuntimeUiByIdAtom)[event.sessionId];
	const nextUi = payload && !(terminalEnvelope && event.sourceChannel === "agents:ui-request") ? applySessionRuntimeUiEvent(previousUi, event, payload, bindingChanged) : undefined;

	if (nextUi && nextUi !== previousUi) {
		set(sessionRuntimeUiByIdAtom, {
			...get(sessionRuntimeUiByIdAtom),
			[event.sessionId]: nextUi,
		});
	}

	const runtimeUnchanged =
		!bindingChanged &&
		currentRuntime.agentId === nextRuntime.agentId &&
		currentRuntime.runtimeGeneration === nextRuntime.runtimeGeneration &&
		currentRuntime.status === nextRuntime.status &&
		currentRuntime.state === nextRuntime.state &&
		currentRuntime.projectId === nextRuntime.projectId &&
		currentRuntime.cwd === nextRuntime.cwd &&
		currentRuntime.title === nextRuntime.title &&
		currentRuntime.piSessionId === nextRuntime.piSessionId &&
		currentRuntime.sessionPath === nextRuntime.sessionPath &&
		currentRuntime.createdAt === nextRuntime.createdAt &&
		currentRuntime.compactionCount === nextRuntime.compactionCount &&
		currentRuntime.noSession === nextRuntime.noSession &&
		currentRuntime.backend === nextRuntime.backend &&
		currentRuntime.deckSessionId === nextRuntime.deckSessionId;
	if (!runtimeUnchanged) {
		set(sessionRuntimeByIdAtom, {
			...get(sessionRuntimeByIdAtom),
			[event.sessionId]: nextRuntime,
		});
	}
});

export const claimSessionRuntimeUiResponseAtom = atom(
	null,
	(
		get,
		set,
		input: {
			sessionId: string;
			requestId: string;
			agentId: string;
			runtimeGeneration: number;
			request?: AgentUiRequest;
		},
	) => {
		const current = get(sessionRuntimeUiByIdAtom)[input.sessionId];
		const request = current?.requests[input.requestId];
		if (!current || current.agentId !== input.agentId || current.runtimeGeneration !== input.runtimeGeneration || request?.status !== "pending" || (input.request !== undefined && request.request !== input.request)) {
			return false;
		}
		set(sessionRuntimeUiByIdAtom, {
			...get(sessionRuntimeUiByIdAtom),
			[input.sessionId]: {
				...current,
				requests: {
					...current.requests,
					[input.requestId]: { ...request, status: "responding" },
				},
			},
		});
		return true;
	},
);

export const rollbackSessionRuntimeUiResponseAtom = atom(
	null,
	(
		get,
		set,
		input: {
			sessionId: string;
			requestId: string;
			agentId: string;
			runtimeGeneration: number;
			request?: AgentUiRequest;
		},
	) => {
		const current = get(sessionRuntimeUiByIdAtom)[input.sessionId];
		const request = current?.requests[input.requestId];
		if (!current || current.agentId !== input.agentId || current.runtimeGeneration !== input.runtimeGeneration || request?.status !== "responding" || (input.request !== undefined && request.request !== input.request)) {
			return false;
		}
		set(sessionRuntimeUiByIdAtom, {
			...get(sessionRuntimeUiByIdAtom),
			[input.sessionId]: {
				...current,
				requests: {
					...current.requests,
					[input.requestId]: { ...request, status: "pending" },
				},
			},
		});
		return true;
	},
);

export const bindSessionRuntimeAtom = atom(
	null,
	(
		get,
		set,
		input: {
			sessionId: string;
			agentId: string;
			runtimeGeneration?: number;
			status?: AgentStatus;
		},
	) => {
		const current = get(sessionRuntimeByIdAtom)[input.sessionId];
		const currentGeneration = current?.runtimeGeneration ?? 0;
		if (input.runtimeGeneration !== undefined && input.runtimeGeneration < currentGeneration) {
			return;
		}
		const bindingChanged = Boolean(current?.agentId && current.agentId !== input.agentId);
		const record = get(sessionRecordsAtom)[input.sessionId];
		if (record && !record.noSession && (input.status === "running" || current?.agentId !== input.agentId)) {
			set(touchRecentSessionAtom, { sessionId: record.id, projectId: record.projectId });
		}
		if (bindingChanged) {
			const ui = { ...get(sessionRuntimeUiByIdAtom) };
			delete ui[input.sessionId];
			set(sessionRuntimeUiByIdAtom, ui);
		}
		set(sessionRuntimeByIdAtom, {
			...get(sessionRuntimeByIdAtom),
			[input.sessionId]: {
				agentId: input.agentId,
				runtimeGeneration: input.runtimeGeneration ?? currentGeneration,
				status: input.status ?? (bindingChanged ? "idle" : current?.status) ?? "idle",
				state: bindingChanged ? undefined : current?.state,
				updatedAt: Date.now(),
			},
		});
		if (bindingChanged) {
			clearSessionLiveThinking(get, set, input.sessionId);
		}
	},
);

export const removeSessionStateAtom = atom(null, (get, set, sessionId: string) => {
	set(forgetRecentSessionAtom, sessionId);
	set(
		unreadSessionIdsAtom,
		get(unreadSessionIdsAtom).filter((id) => id !== sessionId),
	);
	set(forgetSessionActivityAnchorAtom, sessionId);
	const records = { ...get(sessionRecordsAtom) };
	const session = records[sessionId];
	delete records[sessionId];
	set(sessionRecordsAtom, records);
	if (session) {
		set(sessionIdsByProjectAtom, {
			...get(sessionIdsByProjectAtom),
			[session.projectId]: (get(sessionIdsByProjectAtom)[session.projectId] ?? []).filter((id) => id !== sessionId),
		});
	}
	const runtime = { ...get(sessionRuntimeByIdAtom) };
	delete runtime[sessionId];
	set(sessionRuntimeByIdAtom, runtime);
	const runtimeUi = { ...get(sessionRuntimeUiByIdAtom) };
	delete runtimeUi[sessionId];
	set(sessionRuntimeUiByIdAtom, runtimeUi);
	const cacheStats = { ...get(sessionCacheStatsAtom) };
	delete cacheStats[sessionId];
	set(sessionCacheStatsAtom, cacheStats);
	const cache = { ...get(sessionMessagesCacheAtom) };
	releaseSessionOutlineProjection(sessionId);
	delete cache[sessionId];
	set(sessionMessagesCacheAtom, cache);
	clearSessionLiveThinking(get, set, sessionId);
	liveTextStreamingBySessionAtom.remove(sessionId);
	liveTextActiveBySessionAtom.remove(sessionId);
	liveThinkingStreamingBySessionAtom.remove(sessionId);

	removeRegisteredSessionFamilies(sessionId);
	for (const disposalAtom of getSessionDisposalAtoms()) {
		set(disposalAtom as Parameters<typeof set>[0], sessionId);
	}
	liveThinkingIdBySessionIdAtomFamily.remove(sessionId);
	newTurnCollapseTickBySessionIdAtomFamily.remove(sessionId);
	sendPinAnimatingBySessionIdAtomFamily.remove(sessionId);
	runStepsVisibleMemoryBySessionIdAtomFamily.remove(sessionId);
	processGroupOpenBySessionIdAtomFamily.remove(sessionId);
	streamingTextBySessionIdAtomFamily.remove(sessionId);
	sessionMessageCacheBySessionIdAtomFamily.remove(sessionId);
	set(streamingTextByIdAtom, (prevMap) => {
		if (!(sessionId in prevMap)) return prevMap;
		const nextMap = { ...prevMap };
		delete nextMap[sessionId];
		return nextMap;
	});
	set(sendPinAnimatingByIdAtom, (prevMap) => {
		if (!(sessionId in prevMap)) return prevMap;
		const nextMap = { ...prevMap };
		delete nextMap[sessionId];
		return nextMap;
	});
	set(sessionScrollAnchorByIdAtom, (prevMap) => {
		if (!(sessionId in prevMap)) return prevMap;
		const nextMap = { ...prevMap };
		delete nextMap[sessionId];
		return nextMap;
	});
	set(
		sessionMessageLruAtom,
		get(sessionMessageLruAtom).filter((id) => id !== sessionId),
	);
	const loadState = { ...get(sessionMessageLoadStateAtom) };
	delete loadState[sessionId];
	set(sessionMessageLoadStateAtom, loadState);
	if (get(currentSessionIdAtom) === sessionId) set(currentSessionIdAtom, undefined);
});

export const pendingMessageJumpAtom = atom<{ sessionId: string; messageId: string } | null>(null);

export const PENDING_USER_MESSAGE_META = "pendingUserMessage";

function normalizeText(text: string | undefined): string {
	return (text ?? "").replace(/\s+/gu, " ").trim();
}

export function isPendingUserMessage(message: ChatMessage): boolean {
	if (message.role !== "user") return false;
	if (message.meta?.[PENDING_USER_MESSAGE_META] !== true) return false;
	return typeof message.meta?.requestId === "string" && message.meta.requestId.length > 0;
}

export function carryPendingUserMessages(previous: readonly ChatMessage[], next: readonly ChatMessage[]): ChatMessage[] {
	const pendingAt = previous.flatMap((message, index) => (isPendingUserMessage(message) ? [{ message, index }] : []));
	if (pendingAt.length === 0) return [...next];
	const nextIds = new Set(next.map((message) => message.id));
	const confirmedTexts = new Set(next.filter((message) => message.role === "user").map((message) => normalizeText(message.text)));

	const insertions: Array<{ index: number; message: ChatMessage }> = [];
	for (const { message, index } of pendingAt) {
		if (nextIds.has(message.id) || confirmedTexts.has(normalizeText(message.text))) continue;
		const anchor = previous.slice(index + 1).find((candidate) => !isPendingUserMessage(candidate) && nextIds.has(candidate.id));
		const anchorIndex = anchor ? next.findIndex((candidate) => candidate.id === anchor.id) : -1;
		insertions.push({ index: anchorIndex >= 0 ? anchorIndex : commonPrefixLength(previous, next), message });
	}
	if (insertions.length === 0) return [...next];
	insertions.sort((left, right) => left.index - right.index);
	const result: ChatMessage[] = [];
	let cursor = 0;
	for (const insertion of insertions) {
		const at = Math.max(insertion.index, cursor);
		result.push(...next.slice(cursor, at), insertion.message);
		cursor = at;
	}
	result.push(...next.slice(cursor));
	return result;
}

function commonPrefixLength(previous: readonly ChatMessage[], next: readonly ChatMessage[]): number {
	const base = previous.filter((message) => !isPendingUserMessage(message));
	let prefix = 0;
	while (prefix < base.length && prefix < next.length && base[prefix].id === next[prefix].id) prefix += 1;
	return prefix;
}

export function removePendingUserMessages(messages: readonly ChatMessage[], requestId: string): ChatMessage[] {
	return messages.filter((message) => !(message.id === requestId && isPendingUserMessage(message)));
}
