import { useCallback, useEffect, useRef, useState } from "react";
import { useSetAtom } from "jotai";
import type { ChatMessage, ImageContent, SessionRuntimeTarget } from "../../../shared/types";
import { desktopApi as api } from "../desktopApi";
import { t } from "../i18n";
import { cacheSessionMessagesAtom, setSessionHistoryMutationOverlayAtom, setSessionMessageLoadStateAtom, type SessionHistoryMutationOverlayKind } from "../atoms/session-atoms";
import { requireSessionCommand, sessionCommandFailureToast } from "../utils/sessionCommands";
import { setSessionQuotesAtom } from "../atoms/composer-atoms";
import { extractQuoteTokens, pruneUnreferencedQuotes, rehydrateDraftFromMessage } from "../components/session/composer/quoteChip";
import { resolveHistoryMutationPath, shouldShowResendRollbackHint } from "../utils/sessionHistoryMutationPolicy";
import { sessionHistoryUnavailableState } from "../utils/sessionHistoryAvailability";
import { sessionDiskPageCursor } from "../utils/sessionDiskPageCursor";
import type { NoticeKind } from "../utils/notice";
import { messageEntryId } from "../utils/sessionCommands";
import { useSessionMessageImageRemoval } from "./useSessionMessageImageRemoval";

type ConfirmConfig = {
	title: string;
	message: string;
	onConfirm: () => void;
	danger?: boolean;
	confirmLabel?: string;
};

export interface SessionHistoryMutationsDeps {
	currentSessionId: string | undefined;
	getRuntimeTargetForSession: (sessionId: string | undefined) => SessionRuntimeTarget | undefined;
	getRuntimeTargetForAgent: (agentId: string | undefined) => SessionRuntimeTarget | undefined;

	isSessionRuntimeLive: (sessionId: string) => boolean;
	showConfirm: (config: ConfirmConfig) => void;
	clearConfirm: () => void;
	showToast: (message: string, duration?: number, kind?: NoticeKind) => void;
	translateAgentErrorMessage: (message: string) => string;
	submitPromptSnapshot: (sessionId: string, message: string, images?: ImageContent[], options?: { requireAppliedModel?: boolean }) => Promise<boolean | "unknown">;
	openReplacedRuntimeSession: (projectId: string | undefined, targetSessionId: string | undefined) => Promise<void>;
	setPromptForAgent: (sessionId: string, text: string) => void;
	setCurrentSessionIdRef: (sessionId: string) => void;
	isAgentCurrentlyBusy: () => boolean;
	resolveProjectId: (sessionId: string) => string | undefined;

	hasPersistedSessionFile: (sessionId: string) => boolean;

	isImageGenSession?: (sessionId: string) => boolean;

	isLastUserMessage?: (sessionId: string, message: ChatMessage) => boolean;

	restoreImageGenTurn?: (sessionId: string, text: string, images?: ImageContent[]) => void;
}

export function useSessionHistoryMutations(deps: SessionHistoryMutationsDeps) {
	const setOverlay = useSetAtom(setSessionHistoryMutationOverlayAtom);
	const cacheMessages = useSetAtom(cacheSessionMessagesAtom);
	const setLoadState = useSetAtom(setSessionMessageLoadStateAtom);
	const setQuotes = useSetAtom(setSessionQuotesAtom);
	const [forkingMessageId, setForkingMessageId] = useState<string | null>(null);
	const forkingRef = useRef(false);
	const resendingIdsRef = useRef<Set<string>>(new Set());
	const overlaySessionRef = useRef<string | undefined>(undefined);
	const depsRef = useRef(deps);
	depsRef.current = deps;

	const showOverlay = useCallback(
		(sessionId: string, kind: SessionHistoryMutationOverlayKind) => {
			overlaySessionRef.current = sessionId;
			setOverlay({ sessionId, kind });
		},
		[setOverlay],
	);

	const hideOverlay = useCallback(
		(sessionId: string) => {
			if (overlaySessionRef.current === sessionId) overlaySessionRef.current = undefined;
			setOverlay({ sessionId, kind: null });
		},
		[setOverlay],
	);

	useEffect(() => {
		return () => {
			const sessionId = overlaySessionRef.current;
			if (sessionId) setOverlay({ sessionId, kind: null });
		};
	}, [setOverlay]);

	const failToast = useCallback((prefix: string, error: unknown) => {
		const latest = depsRef.current;
		latest.showToast(`${prefix}: ${sessionCommandFailureToast(error, latest.translateAgentErrorMessage)}`, 5000);
	}, []);

	const reloadTimelineFromDisk = useCallback(
		async (sessionId: string) => {
			showOverlay(sessionId, "reloading");
			setLoadState({ sessionId, state: { status: "loading" } });
			const page = await api.sessions.readRecordMessagePage(sessionId, undefined, 100);

			const unavailable = sessionHistoryUnavailableState(page);
			if (unavailable) {
				setLoadState({ sessionId, state: unavailable });
				return;
			}
			cacheMessages({
				sessionId,
				messages: page.messages,
				source: "disk",
				expectedRevision: 0,
				page: sessionDiskPageCursor(page),
				force: true,
			});
			setLoadState({ sessionId, state: { status: "ready" } });
		},
		[cacheMessages, setLoadState, showOverlay],
	);

	const stopIfRunning = useCallback(
		async (sessionId: string) => {
			if (!depsRef.current.isSessionRuntimeLive(sessionId)) return;
			const target = depsRef.current.getRuntimeTargetForSession(sessionId);
			if (!target) return;
			showOverlay(sessionId, "stopping");
			requireSessionCommand(await api.sessions.stopRuntime(target));
		},
		[showOverlay],
	);

	const confirmStopIfRunning = useCallback((sessionId: string, copy: { title: string; message: string; confirmLabel: string }, onConfirmed: () => Promise<void>) => {
		const latest = depsRef.current;

		const live = latest.isSessionRuntimeLive(sessionId);
		if (!live) {
			void onConfirmed();
			return;
		}
		latest.showConfirm({
			title: copy.title,
			message: copy.message,
			danger: true,
			confirmLabel: copy.confirmLabel,
			onConfirm: () => {
				latest.clearConfirm();
				void onConfirmed();
			},
		});
	}, []);

	const runFileMutation = useCallback(
		async (sessionId: string, work: () => Promise<void>) => {
			try {
				await stopIfRunning(sessionId);
				showOverlay(sessionId, "mutating");
				await work();
				await reloadTimelineFromDisk(sessionId);
			} finally {
				hideOverlay(sessionId);
			}
		},
		[hideOverlay, reloadTimelineFromDisk, showOverlay, stopIfRunning],
	);

	const removeMessageImage = useSessionMessageImageRemoval({ deps, runFileMutation, onFailure: failToast });

	const resolveForkEntryId = useCallback(async (message: ChatMessage, target?: SessionRuntimeTarget): Promise<string | undefined> => {
		if (typeof message.meta?.entryId === "string" && message.meta.entryId) {
			return message.meta.entryId;
		}
		const marker = "-history-";
		const historyIndex = message.id.lastIndexOf(marker);
		if (historyIndex >= 0) {
			const fromId = message.id.slice(historyIndex + marker.length).trim();
			if (fromId && fromId !== String(message.meta?._piDeckMsgSeq ?? "") && !/^\d+$/.test(fromId)) {
				return fromId;
			}
		}
		if (!target) return undefined;
		try {
			const wrapped = requireSessionCommand(await api.sessions.getRuntimeForkMessages(target));

			const forkMessages = Array.isArray(wrapped) ? wrapped : wrapped.value;
			const targetText = message.text.trim();
			if (!targetText || !Array.isArray(forkMessages)) return undefined;
			for (let i = forkMessages.length - 1; i >= 0; i -= 1) {
				const item = forkMessages[i];
				if (item?.entryId && item.text?.trim() === targetText) return item.entryId;
			}
		} catch {}
		return undefined;
	}, []);

	const runForkMutation = useCallback(
		async (sessionId: string, kind: "resend" | "edit", message: ChatMessage, newText?: string) => {
			const latest = depsRef.current;

			let target = latest.getRuntimeTargetForSession(sessionId);
			if (!target) {
				showOverlay(sessionId, "activating");
				const activated = requireSessionCommand(await api.sessions.activateRuntime(sessionId));
				target = {
					sessionId,
					agentId: activated.agentId,
					runtimeGeneration: activated.runtimeGeneration,
				};
			}

			showOverlay(sessionId, kind === "edit" ? "editing" : "resending");
			const entryId = await resolveForkEntryId(message, target);
			if (!entryId) {
				latest.showToast(t("app.forkMissingEntryId"), 4000);
				return;
			}
			const result = requireSessionCommand(
				await api.sessions.forkRuntimeSession(target, entryId, {
					mutationFork: true,

					branchMode: latest.isLastUserMessage ? !latest.isLastUserMessage(sessionId, message) : false,
				}),
			);
			if (result.cancelled) {
				latest.showToast(t("app.forkCancelled"), 3500);
				return;
			}
			const projectId = latest.resolveProjectId(sessionId);
			const targetSessionId = result.targetSessionId;
			await latest.openReplacedRuntimeSession(projectId, targetSessionId);
			if (targetSessionId) latest.setCurrentSessionIdRef(targetSessionId);

			const promptText = kind === "edit" && newText !== undefined ? newText : typeof result.text === "string" && result.text.length > 0 ? result.text : (message.text ?? "");
			const delivered = await depsRef.current.submitPromptSnapshot(targetSessionId ?? sessionId, promptText, message.images, { requireAppliedModel: true });
			if (shouldShowResendRollbackHint(delivered)) {
				latest.showToast(t(kind === "edit" ? "message.editSendFailedRolledBack" : "message.resendSendFailedRolledBack"), undefined, "warning");
			}
		},
		[resolveForkEntryId, showOverlay],
	);

	const editMessage = useCallback(
		async (message: ChatMessage, newText: string) => {
			const latest = depsRef.current;
			const sessionId = latest.currentSessionId;
			if (!sessionId) return;

			const path = resolveHistoryMutationPath({
				kind: "edit",
				live: latest.isSessionRuntimeLive(sessionId),
				persisted: latest.hasPersistedSessionFile(sessionId),
			});
			if (path.path === "unsupported-anonymous") {
				latest.showToast(t("message.anonymousEditUnsupported"), 4000);
				return;
			}

			if (path.path === "fork-mutation") {
				confirmStopIfRunning(
					sessionId,
					{
						title: t("message.historyStopToEditTitle"),

						message: latest.isAgentCurrentlyBusy() ? t("message.historyStopToEditBody") : t("message.historyStopToEditBodyIdle"),
						confirmLabel: t("app.stop"),
					},
					async () => {
						try {
							await runForkMutation(sessionId, "edit", message, newText);
						} catch (error) {
							failToast(t("message.editFailed"), error);
						} finally {
							hideOverlay(sessionId);
						}
					},
				);
				return;
			}
			confirmStopIfRunning(
				sessionId,
				{
					title: t("message.historyStopToEditTitle"),
					message: latest.isAgentCurrentlyBusy() ? t("message.historyStopToEditBody") : t("message.historyStopToEditBodyIdle"),
					confirmLabel: t("app.stop"),
				},
				async () => {
					try {
						await runFileMutation(sessionId, async () => {
							requireSessionCommand(await api.sessions.editCatalogMessage(sessionId, message.id, newText, messageEntryId(message)));
						});
					} catch (error) {
						failToast(t("message.editFailed"), error);
					}
				},
			);
		},
		[confirmStopIfRunning, failToast, runFileMutation, runForkMutation],
	);

	const deleteMessage = useCallback(
		(messageId: string, entryId?: string) => {
			const latest = depsRef.current;
			const sessionId = latest.currentSessionId;
			if (!sessionId) return;

			const path = resolveHistoryMutationPath({
				kind: "delete",
				live: latest.isSessionRuntimeLive(sessionId),
				persisted: latest.hasPersistedSessionFile(sessionId),
			});
			if (path.path === "unsupported-anonymous") {
				latest.showToast(t("message.anonymousDeleteUnsupported"), 4000);
				return;
			}

			if (path.path !== "catalog") return;

			const live = latest.isSessionRuntimeLive(sessionId);
			latest.showConfirm({
				title: t("message.deleteTitle"),
				message: live ? (latest.isAgentCurrentlyBusy() ? t("message.historyStopToDeleteBody") : t("message.historyStopToDeleteBodyIdle")) : t("message.deleteReloadPrompt"),
				danger: true,
				confirmLabel: live ? t("app.stop") : t("common.delete"),
				onConfirm: async () => {
					latest.clearConfirm();
					try {
						await runFileMutation(sessionId, async () => {
							requireSessionCommand(await api.sessions.deleteCatalogMessage(sessionId, messageId, entryId));
						});
					} catch (error) {
						failToast(t("message.deleteFailed"), error);
					}
				},
			});
		},
		[failToast, runFileMutation],
	);

	const resendUserMessage = useCallback(
		(message: ChatMessage) => {
			const latest = depsRef.current;
			const sessionId = latest.currentSessionId;
			if (!sessionId) return;
			if (resendingIdsRef.current.has(message.id)) return;
			const path = resolveHistoryMutationPath({
				kind: "resend",
				live: latest.isSessionRuntimeLive(sessionId),
				persisted: latest.hasPersistedSessionFile(sessionId),
				isImageGenSession: latest.isImageGenSession?.(sessionId),
			});

			if (path.path === "runtime-anonymous-resend") {
				resendingIdsRef.current.add(message.id);
				setTimeout(() => resendingIdsRef.current.delete(message.id), 30_000);
				void latest
					.submitPromptSnapshot(sessionId, message.text ?? "", message.images)
					.catch((error) => failToast(t("message.resendFailed"), error))
					.finally(() => resendingIdsRef.current.delete(message.id));
				return;
			}

			if (path.path === "imagegen-resend") {
				if (!latest.restoreImageGenTurn) return;
				resendingIdsRef.current.add(message.id);
				setTimeout(() => resendingIdsRef.current.delete(message.id), 30_000);
				try {
					latest.restoreImageGenTurn(sessionId, message.text ?? "", message.images);
				} finally {
					resendingIdsRef.current.delete(message.id);
				}
				return;
			}

			if (path.path === "fork-mutation") {
				const run = async () => {
					resendingIdsRef.current.add(message.id);
					setTimeout(() => resendingIdsRef.current.delete(message.id), 30_000);
					try {
						await runForkMutation(sessionId, "resend", message);
					} catch (error) {
						failToast(t("message.resendFailed"), error);
					} finally {
						resendingIdsRef.current.delete(message.id);
						hideOverlay(sessionId);
					}
				};
				confirmStopIfRunning(
					sessionId,
					{
						title: t("message.historyStopToResendTitle"),

						message: latest.isAgentCurrentlyBusy() ? t("message.historyStopToResendBody") : t("message.historyStopToResendBodyIdle"),
						confirmLabel: t("app.stop"),
					},
					run,
				);
				return;
			}

			const run = async () => {
				resendingIdsRef.current.add(message.id);
				setTimeout(() => resendingIdsRef.current.delete(message.id), 30_000);
				try {
					let snapshot: { text: string; images?: ImageContent[] } | undefined;
					await runFileMutation(sessionId, async () => {
						snapshot = requireSessionCommand(await api.sessions.prepareCatalogResend(sessionId, message.id, messageEntryId(message)));
					});
					if (!snapshot) return;
					showOverlay(sessionId, "activating");
					const delivered = await depsRef.current.submitPromptSnapshot(sessionId, snapshot.text, snapshot.images);
					if (shouldShowResendRollbackHint(delivered)) {
						latest.showToast(t("message.resendSendFailedRolledBack"), undefined, "warning");
					}
				} catch (error) {
					failToast(t("message.resendFailed"), error);
				} finally {
					resendingIdsRef.current.delete(message.id);
					hideOverlay(sessionId);
				}
			};
			confirmStopIfRunning(
				sessionId,
				{
					title: t("message.historyStopToResendTitle"),
					message: latest.isAgentCurrentlyBusy() ? t("message.historyStopToResendBody") : t("message.historyStopToResendBodyIdle"),
					confirmLabel: t("app.stop"),
				},
				run,
			);
		},
		[confirmStopIfRunning, failToast, hideOverlay, runFileMutation, runForkMutation, showOverlay],
	);

	const runExplicitFork = useCallback(
		async (entryOrMessage: string | ChatMessage, fallbackText: string, busyKey: string, images?: ImageContent[]) => {
			const latest = depsRef.current;
			const sessionId = latest.currentSessionId;
			if (!sessionId || latest.isAgentCurrentlyBusy() || forkingRef.current) return;

			forkingRef.current = true;
			setForkingMessageId(busyKey);
			try {
				let target = latest.getRuntimeTargetForSession(sessionId);
				if (!target) {
					showOverlay(sessionId, "activating");
					const activated = requireSessionCommand(await api.sessions.activateRuntime(sessionId));
					target = {
						sessionId,
						agentId: activated.agentId,
						runtimeGeneration: activated.runtimeGeneration,
					};
				}
				const entryId = typeof entryOrMessage === "string" ? entryOrMessage : await resolveForkEntryId(entryOrMessage, target);
				if (!entryId) {
					latest.showToast(t("app.forkMissingEntryId"), 4000);
					return;
				}
				showOverlay(sessionId, "forking");
				const result = requireSessionCommand(await api.sessions.forkRuntimeSession(target, entryId));
				if (result.cancelled) {
					latest.showToast(t("app.forkCancelled"), 3500);
					return;
				}
				const rawPromptText = typeof result.text === "string" && result.text.length > 0 ? result.text : fallbackText;

				const { draft: promptText, quotes } = rehydrateDraftFromMessage(rawPromptText);
				const projectId = latest.resolveProjectId(sessionId);
				const targetSessionId = result.targetSessionId;
				await latest.openReplacedRuntimeSession(projectId, targetSessionId);
				const draftTarget = targetSessionId ?? sessionId;
				if (targetSessionId) latest.setCurrentSessionIdRef(targetSessionId);
				if (quotes.length > 0) {
					const referencedIds = new Set(extractQuoteTokens(promptText).map((occurrence) => occurrence.id));
					setQuotes({
						sessionId: draftTarget,
						value: (current) => ({
							...pruneUnreferencedQuotes(current, referencedIds),
							...Object.fromEntries(quotes.map((snippet) => [snippet.id, snippet])),
						}),
					});
				}
				latest.setPromptForAgent(draftTarget, promptText);
				window.dispatchEvent(new CustomEvent("user-message-edit", { detail: { text: promptText, images } }));
				latest.showToast(t("app.forkDone"), 3500);
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				latest.showToast(t("app.forkFailed", { error: latest.translateAgentErrorMessage(msg) }), 5000);
			} finally {
				forkingRef.current = false;
				setForkingMessageId(null);
				hideOverlay(sessionId);
			}
		},
		[hideOverlay, resolveForkEntryId, showOverlay],
	);

	const forkAtEntry = useCallback((entryId: string, fallbackText: string, busyKey: string, images?: ImageContent[]) => runExplicitFork(entryId, fallbackText, busyKey, images), [runExplicitFork]);

	const forkFromUserMessage = useCallback((message: ChatMessage) => runExplicitFork(message, message.text, message.id, message.images), [runExplicitFork]);

	return {
		editMessage,
		deleteMessage,
		removeMessageImage,
		resendUserMessage,
		forkFromUserMessage,
		forkAtEntry,
		forkingMessageId,
	};
}
