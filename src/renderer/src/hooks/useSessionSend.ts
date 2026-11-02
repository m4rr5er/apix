import { useSetAtom, useStore } from "jotai";
import { useRef } from "react";
import type { ComposerAgentMode, ImageContent, SendSessionPromptInput, SendSessionPromptResult, SessionRuntimeTarget } from "../../../shared/types";
import { classifyComposerSlashCommand } from "../utils/composerSlashCommand";
import {
	bindSessionRuntimeAtom,
	bumpNewTurnCollapseTickAtom,
	cacheSessionMessagesAtom,
	sessionAttachmentsByIdAtom,
	sessionMessagesCacheAtom,
	sessionComposerModeByIdAtom,
	sessionDraftByIdAtom,
	sessionQuotesByIdAtom,
	sessionRecordsAtom,
	sessionRuntimeByIdAtom,
	sessionSendStateByIdAtom,
	setSessionAttachmentsAtom,
	setSessionDraftAtom,
	setSessionQuotesAtom,
	type SessionQuoteMap,
	setSessionSendStateAtom,
	upsertSessionAtom,
	openSettingsAtom,
	removePendingUserMessages,
} from "../atoms";
import { buildComposerPromptSubmission, deriveComposerAgentMode, expandPromptTemplates } from "../composerBehavior";
import { expandQuoteTokens, stripQuoteTokens } from "../components/session/composer/quoteChip";
import { t, translateI18nDescriptor } from "../i18n";
import { toSessionRuntimeTarget } from "../utils/sessionCommands";
import { sessionReloadingByIdAtom } from "../atoms/session-commands-atoms";

export type EnqueuePromptSnapshot = {
	displayText: string;
	message: string;
	images?: ImageContent[];
	agentMode: string;

	behavior?: "steer" | "followUp";
};

type PromptTemplate = {
	name: string;
	path: string;
	description: string;
	content: string;
	argumentHint?: string;
};

type SessionPromptApi = (input: SendSessionPromptInput) => Promise<SendSessionPromptResult>;

export type UseSessionSendOptions = {
	sessionId: string;
	sendPrompt: SessionPromptApi;

	ensureSessionId?: (sessionId: string) => Promise<string>;

	getTemplates: () => PromptTemplate[];

	ensureTemplates?: (message: string) => Promise<void>;

	getReservedCommandNames?: () => ReadonlySet<string>;
	prepareMessage?: (message: string) => Promise<string>;
	onDraftMutation?: (sessionId: string) => void;
	compact: (target: SessionRuntimeTarget, prompt?: string) => Promise<void>;

	createNewSession?: () => Promise<void>;

	openProviderLogin?: (providerId?: string) => void;

	reloadResources?: (target: SessionRuntimeTarget) => Promise<void>;
	resetComposerUi?: () => void;
	recordPromptHistory?: (sessionId: string, message: string) => void;
	refreshProject?: (projectId: string) => void;
	showError?: (message: string, duration?: number) => void;
	showUnknown?: () => void;

	pruneFailedAcpDraft?: (sessionId: string) => Promise<boolean> | boolean;

	enqueue?: (sessionId: string, snapshot: EnqueuePromptSnapshot) => boolean;
};

export function normalizeComposerDomText(value: string): string {
	return value.replace(/\u200B/g, "");
}

export function mergeRejectedComposerDraft(rejectedDraft: string, currentDraft: string): string {
	return [rejectedDraft, currentDraft].filter((text) => text.trim()).join("\n\n");
}

export function mergeRejectedComposerImages(rejectedImages: ImageContent[] | undefined, currentImages: ImageContent[]): ImageContent[] {
	return rejectedImages?.length ? [...rejectedImages, ...currentImages] : currentImages;
}

export function hasComposerSubmission(message: string, images: ImageContent[] | undefined): boolean {
	return Boolean(message.trim() || images?.length);
}

export function classifySessionPromptResult(result: SendSessionPromptResult): "accepted" | "rejected" | "unknown" {
	if (result.accepted) return "accepted";
	return result.delivery === "unknown" ? "unknown" : "rejected";
}

export function createSessionSendLock() {
	const sessionIds = new Set<string>();
	return {
		has: (sessionId: string) => sessionIds.has(sessionId),
		claim: (sessionId: string) => {
			if (sessionIds.has(sessionId)) return false;
			sessionIds.add(sessionId);
			return true;
		},
		release: (sessionId: string) => {
			sessionIds.delete(sessionId);
		},
	};
}

export function useSessionSend(options: UseSessionSendOptions) {
	const store = useStore();
	const setDraft = useSetAtom(setSessionDraftAtom);
	const setAttachments = useSetAtom(setSessionAttachmentsAtom);
	const setQuotes = useSetAtom(setSessionQuotesAtom);
	const setCacheMessages = useSetAtom(cacheSessionMessagesAtom);
	const setSendState = useSetAtom(setSessionSendStateAtom);
	const bindRuntime = useSetAtom(bindSessionRuntimeAtom);
	const upsertSession = useSetAtom(upsertSessionAtom);
	const sendingSessionIdsRef = useRef<Set<string>>(new Set());

	function clearSnapshot(targetSessionId: string) {
		options.onDraftMutation?.(targetSessionId);
		setDraft({ sessionId: targetSessionId, value: "" });
		setAttachments({ sessionId: targetSessionId, value: [] });

		setQuotes({ sessionId: targetSessionId, value: {} });
	}

	function restoreRejectedSnapshot(targetSessionId: string, message: string, imageSnapshot?: ImageContent[], quoteSnapshot?: SessionQuoteMap) {
		options.onDraftMutation?.(targetSessionId);
		setDraft({
			sessionId: targetSessionId,
			value: (current) => [message, current].filter((text) => text.trim()).join("\n\n"),
		});
		if (imageSnapshot) {
			setAttachments({
				sessionId: targetSessionId,
				value: (current) => [...imageSnapshot, ...current],
			});
		}
		if (quoteSnapshot) {
			setQuotes({ sessionId: targetSessionId, value: (current) => ({ ...quoteSnapshot, ...current }) });
		}
	}

	function dropPendingUserMessage(targetSessionId: string, pendingRequestId: string) {
		const entry = store.get(sessionMessagesCacheAtom)?.[targetSessionId];
		if (!entry?.messages?.length) return;
		const messages = removePendingUserMessages(entry.messages, pendingRequestId);
		if (messages.length === entry.messages.length) return;
		setCacheMessages({
			sessionId: targetSessionId,
			messages,
			source: entry.source ?? "runtime",
			windowStart: entry.windowStart,
			cardCount: entry.cardCount,
			history: entry.history,
			windowStartFilePos: entry.windowStartFilePos,
		});
	}

	function rejectEmptyTemplate(targetSessionId: string, templateName: string) {
		const message = t("app.promptTemplateEmptyBody", { name: templateName });
		setSendState({
			sessionId: targetSessionId,
			state: { status: "error", error: message },
		});
		options.showError?.(message, 4500);
	}

	function clearComposerSnapshot(targetSessionId: string, keepDraft: boolean) {
		if (keepDraft) return;
		clearSnapshot(targetSessionId);
	}

	function resetComposerEphemeralUi(keepDraft: boolean) {
		if (keepDraft) return;
		options.resetComposerUi?.();
	}

	function restoreRejectedPrompt(targetSessionId: string, keepDraft: boolean, message: string, imageSnapshot?: ImageContent[], quoteSnapshot?: SessionQuoteMap) {
		if (keepDraft) return;
		restoreRejectedSnapshot(targetSessionId, message, imageSnapshot, quoteSnapshot);
	}

	return async function sendSessionPrompt(streamingBehavior?: "steer" | "followUp", overrideText?: string) {
		const sourceSessionId = options.sessionId;

		const existingSend = store.get(sessionSendStateByIdAtom)[sourceSessionId];
		if (sendingSessionIdsRef.current.has(sourceSessionId) || existingSend?.status === "activating" || existingSend?.status === "sending") return;

		if (store.get(sessionReloadingByIdAtom)[sourceSessionId]) {
			options.showError?.(t("sessionCommand.reloadResourcesBusy"), 3000);
			return;
		}

		const keepDraft = overrideText !== undefined;
		const rawDraft = overrideText ?? store.get(sessionDraftByIdAtom)[sourceSessionId] ?? "";
		const attachmentSnapshot = keepDraft ? [] : (store.get(sessionAttachmentsByIdAtom)[sourceSessionId] ?? []);
		const imageSnapshot = attachmentSnapshot.length ? [...attachmentSnapshot] : undefined;
		if (!hasComposerSubmission(rawDraft, imageSnapshot)) return;

		const quoteMap = store.get(sessionQuotesByIdAtom)[sourceSessionId];
		const message = expandQuoteTokens(rawDraft, (id) => quoteMap?.[id]) ?? rawDraft;

		if (!stripQuoteTokens(rawDraft).trim() && !imageSnapshot) {
			options.showError?.(t("app.quoteNeedsQuestion"), 4000);
			return;
		}

		const resolveSendMode = (targetSessionId: string): ComposerAgentMode => {
			const record = store.get(sessionRecordsAtom)[targetSessionId];
			const liveRuntime = store.get(sessionRuntimeByIdAtom)[targetSessionId];
			return deriveComposerAgentMode({
				backend: record?.backend ?? liveRuntime?.backend,
				localMode: store.get(sessionComposerModeByIdAtom)[targetSessionId],
			});
		};

		sendingSessionIdsRef.current.add(sourceSessionId);
		const requestId = crypto.randomUUID();
		const trimmedMessage = message.trim();
		const recordAtEntry = store.get(sessionRecordsAtom)[sourceSessionId];
		const runtimeAtEntry = store.get(sessionRuntimeByIdAtom)[sourceSessionId];

		const slashCommand = classifyComposerSlashCommand(trimmedMessage);
		if (slashCommand.kind === "login") {
			clearComposerSnapshot(sourceSessionId, keepDraft);
			resetComposerEphemeralUi(keepDraft);
			sendingSessionIdsRef.current.delete(sourceSessionId);
			options.openProviderLogin?.(slashCommand.providerId);
			return;
		}
		if (slashCommand.kind === "hotkeys") {
			clearComposerSnapshot(sourceSessionId, keepDraft);
			resetComposerEphemeralUi(keepDraft);
			sendingSessionIdsRef.current.delete(sourceSessionId);
			store.set(openSettingsAtom, { tab: "shortcuts" });
			return;
		}
		if (slashCommand.kind === "reload") {
			clearComposerSnapshot(sourceSessionId, keepDraft);
			resetComposerEphemeralUi(keepDraft);
			sendingSessionIdsRef.current.delete(sourceSessionId);
			const target = toSessionRuntimeTarget(sourceSessionId, runtimeAtEntry);
			if (!target) {
				options.showError?.(t("sessionCommand.runtimeUnavailable"), 4000);
				return;
			}
			if (!options.reloadResources) {
				options.showError?.(t("sessionCommand.reloadResourcesUnsupported"), 4000);
				return;
			}
			try {
				await options.reloadResources(target);
			} catch (error) {
				options.showError?.(error instanceof Error ? error.message : String(error), 5000);
			}
			return;
		}
		const isNewCommand = slashCommand.kind === "new";
		const isCompactCommand = slashCommand.kind === "compact";
		if (isNewCommand) {
			clearComposerSnapshot(sourceSessionId, keepDraft);
			resetComposerEphemeralUi(keepDraft);
			try {
				await options.createNewSession?.();
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				setSendState({
					sessionId: sourceSessionId,
					state: { status: "error", error: errorMessage },
				});
				options.showError?.(errorMessage, 4000);
			} finally {
				sendingSessionIdsRef.current.delete(sourceSessionId);
			}
			return;
		}
		const usesLocalQueue = Boolean(options.enqueue && (streamingBehavior === "steer" || streamingBehavior === "followUp"));

		const publishOptimisticSubmission = (targetSessionId: string) => {
			setSendState({
				sessionId: targetSessionId,
				state: { status: "activating", requestId },
			});
			clearComposerSnapshot(targetSessionId, keepDraft);
			const cacheEntry = store.get(sessionMessagesCacheAtom)?.[targetSessionId];
			const previousMessages = cacheEntry?.messages ?? [];
			setCacheMessages({
				sessionId: targetSessionId,
				messages: [
					...previousMessages,
					{
						id: requestId,
						agentId: "",
						role: "user" as const,
						text: message,
						timestamp: Date.now(),
						images: imageSnapshot,

						meta: { pendingUserMessage: true, requestId },
					},
				],
				source: "runtime" as const,
			});
			resetComposerEphemeralUi(keepDraft);
		};

		const publishBeforeActivation = !usesLocalQueue && !isCompactCommand;
		if (publishBeforeActivation) publishOptimisticSubmission(sourceSessionId);

		let sessionId = sourceSessionId;
		let trackedRecord = recordAtEntry;
		let submissionPublished = publishBeforeActivation;

		const isCurrentRequest = () => (!trackedRecord || Boolean(store.get(sessionRecordsAtom)[sessionId])) && (!submissionPublished || store.get(sessionSendStateByIdAtom)[sessionId]?.requestId === requestId);
		const releaseIfRetired = () => {
			if (isCurrentRequest()) return false;
			sendingSessionIdsRef.current.delete(sourceSessionId);
			return true;
		};
		try {
			sessionId = options.ensureSessionId ? await options.ensureSessionId(sourceSessionId) : sourceSessionId;
		} catch (error) {
			if (releaseIfRetired()) return;

			if (publishBeforeActivation) {
				restoreRejectedPrompt(sourceSessionId, keepDraft, rawDraft, imageSnapshot, quoteMap);
				dropPendingUserMessage(sourceSessionId, requestId);
			}
			const errorMessage = error instanceof Error ? error.message : String(error);
			setSendState({
				sessionId: sourceSessionId,
				state: { status: "error", error: errorMessage },
			});
			options.showError?.(errorMessage, 4000);
			sendingSessionIdsRef.current.delete(sourceSessionId);
			return;
		}

		trackedRecord = store.get(sessionRecordsAtom)[sessionId] ?? trackedRecord;
		if (releaseIfRetired()) return;
		const runtime = store.get(sessionRuntimeByIdAtom)[sessionId];
		const runtimeTarget = runtime?.agentId
			? {
					sessionId,
					agentId: runtime.agentId,
					runtimeGeneration: runtime.runtimeGeneration,
				}
			: undefined;
		const runtimeAgentId = runtimeTarget?.agentId;
		if (publishBeforeActivation && runtimeAgentId) {
			setSendState({
				sessionId,
				state: { status: "sending", requestId },
			});
			setCacheMessages({
				sessionId,
				messages: (store.get(sessionMessagesCacheAtom)?.[sessionId]?.messages ?? []).map((item) => (item.id === requestId ? { ...item, agentId: runtimeAgentId } : item)),
				source: "runtime",
			});
		}
		if (isCompactCommand) {
			if (!runtimeAgentId) {
			} else {
				const compactPrompt = slashCommand.kind === "compact" ? slashCommand.prompt : "";
				clearComposerSnapshot(sessionId, keepDraft);
				resetComposerEphemeralUi(keepDraft);
				try {
					await options.compact(runtimeTarget, compactPrompt || undefined);
				} finally {
					sendingSessionIdsRef.current.delete(sourceSessionId);
				}
				return;
			}
		}

		if (options.enqueue && (streamingBehavior === "steer" || streamingBehavior === "followUp")) {
			await options.ensureTemplates?.(message).catch(() => undefined);
			const { message: expandedMessage, emptyTemplateName } = expandPromptTemplates(message, options.getTemplates(), { reservedNames: options.getReservedCommandNames?.() });
			if (emptyTemplateName) {
				sendingSessionIdsRef.current.delete(sourceSessionId);
				rejectEmptyTemplate(sessionId, emptyTemplateName);
				return;
			}
			const enqueued = options.enqueue(sessionId, {
				displayText: message,
				message: expandedMessage,
				images: imageSnapshot,
				agentMode: resolveSendMode(sessionId),
				behavior: streamingBehavior,
			});
			if (enqueued) {
				clearComposerSnapshot(sessionId, keepDraft);
				resetComposerEphemeralUi(keepDraft);
				sendingSessionIdsRef.current.delete(sourceSessionId);
				return;
			}
		}

		if (!publishBeforeActivation) {
			submissionPublished = true;
			setSendState({
				sessionId,
				state: {
					status: runtimeAgentId ? "sending" : "activating",
					requestId,
				},
			});
			clearComposerSnapshot(sessionId, keepDraft);

			const cacheEntry = store.get(sessionMessagesCacheAtom)?.[sessionId];
			const previousMessages = cacheEntry?.messages ?? [];
			setCacheMessages({
				sessionId,
				messages: [
					...previousMessages,
					{
						id: requestId,
						agentId: runtimeAgentId ?? "",
						role: "user" as const,
						text: message,
						timestamp: Date.now(),
						images: imageSnapshot,

						meta: { pendingUserMessage: true, requestId },
					},
				],
				source: "runtime" as const,
			});
			resetComposerEphemeralUi(keepDraft);
		}

		let preparedMessage = message;
		try {
			preparedMessage = options.prepareMessage ? await options.prepareMessage(message) : message;
		} catch (error) {
			if (releaseIfRetired()) return;

			restoreRejectedPrompt(sessionId, keepDraft, rawDraft, imageSnapshot, quoteMap);
			dropPendingUserMessage(sessionId, requestId);
			const errorMessage = error instanceof Error ? error.message : String(error);

			setSendState({
				sessionId,
				state: { status: "error", requestId, error: errorMessage },
			});
			options.showError?.(errorMessage, 4000);
			sendingSessionIdsRef.current.delete(sourceSessionId);
			return;
		}

		if (releaseIfRetired()) return;
		const { message: expandedMessage, description, emptyTemplateName } = expandPromptTemplates(preparedMessage, options.getTemplates(), { reservedNames: options.getReservedCommandNames?.() });
		if (emptyTemplateName) {
			restoreRejectedPrompt(sessionId, keepDraft, rawDraft, imageSnapshot, quoteMap);
			dropPendingUserMessage(sessionId, requestId);
			rejectEmptyTemplate(sessionId, emptyTemplateName);
			sendingSessionIdsRef.current.delete(sourceSessionId);
			return;
		}
		const record = store.get(sessionRecordsAtom)[sessionId];
		const liveRuntime = store.get(sessionRuntimeByIdAtom)[sessionId];
		const sendMode: ComposerAgentMode = deriveComposerAgentMode({
			backend: "pi",
			localMode: store.get(sessionComposerModeByIdAtom)[sessionId],
		});
		const submission = buildComposerPromptSubmission(expandedMessage, sendMode);

		try {
			const result = await options.sendPrompt({
				sessionId,
				requestId,
				message: submission.message,
				...(imageSnapshot ? { images: imageSnapshot } : {}),
				...(submission.agentMessage ? { agentMessage: submission.agentMessage } : {}),
				...(description ? { description } : {}),
				...(streamingBehavior ? { streamingBehavior } : {}),
			});
			if (!isCurrentRequest()) return;
			const currentRuntime = store.get(sessionRuntimeByIdAtom)[sessionId];

			const staleRuntime = result.agentId && currentRuntime && ((result.runtimeGeneration !== undefined && result.runtimeGeneration < currentRuntime.runtimeGeneration) || ((result.runtimeGeneration ?? currentRuntime.runtimeGeneration) === currentRuntime.runtimeGeneration && currentRuntime.agentId !== result.agentId));
			if (staleRuntime && result.accepted) {
				setSendState({ sessionId, state: { status: "idle" } });
				return;
			}

			if (result.accepted) store.set(bumpNewTurnCollapseTickAtom, sessionId);

			const record = store.get(sessionRecordsAtom)[sessionId];
			if (result.agentId && !staleRuntime) {
				bindRuntime({
					sessionId,
					agentId: result.agentId,
					runtimeGeneration: result.runtimeGeneration,
					status: result.accepted && record?.backend !== "acp" && record?.backend !== "qoder" ? "running" : undefined,
				});
			}
			if (record && result.accepted) {
				upsertSession({
					...record,
					...(!result.sessionPath ? {} : { filePath: result.sessionPath }),
					status: "active",
					updatedAt: Date.now(),
				});
			}

			const outcome = classifySessionPromptResult(result);

			let deliveryError = "Prompt was not accepted";
			let toastMessage = deliveryError;
			if ("error" in result) {
				deliveryError = translateI18nDescriptor(result, result.error);
				const details = result.debugDetails && result.debugDetails !== deliveryError ? `（${result.debugDetails.length > 140 ? `${result.debugDetails.slice(0, 140)}…` : result.debugDetails}）` : "";
				toastMessage = `${deliveryError}${details}`;
			}
			if (outcome === "accepted") {
				options.recordPromptHistory?.(sessionId, message);
				setSendState({ sessionId, state: { status: "idle" } });
				if (record) options.refreshProject?.(record.projectId);
			} else if (outcome === "unknown") {
				setSendState({
					sessionId,
					state: {
						status: "unknown",
						requestId,
						error: deliveryError,
						unknownSnapshot: {
							message,
							...(imageSnapshot ? { images: imageSnapshot } : {}),
						},
					},
				});
				options.showUnknown?.();
			} else {
				restoreRejectedPrompt(sessionId, keepDraft, rawDraft, imageSnapshot, quoteMap);

				dropPendingUserMessage(sessionId, requestId);
				setSendState({
					sessionId,
					state: { status: "error", requestId, error: deliveryError },
				});
				options.showError?.(toastMessage, 4000);

				if (!staleRuntime && !result.agentId && (record?.backend === "acp" || record?.backend === "qoder") && record.status === "draft") {
					const pruned = await options.pruneFailedAcpDraft?.(sessionId);
					if (pruned) {
						sendingSessionIdsRef.current.delete(sourceSessionId);
						return;
					}
				}
			}
		} catch (error) {
			if (!isCurrentRequest()) return;
			setSendState({
				sessionId,
				state: {
					status: "unknown",
					requestId,
					error: error instanceof Error ? error.message : String(error),
					unknownSnapshot: {
						message,
						...(imageSnapshot ? { images: imageSnapshot } : {}),
					},
				},
			});
			options.showUnknown?.();
		} finally {
			sendingSessionIdsRef.current.delete(sourceSessionId);
		}
	};
}
