import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import type { AgentBackend, AvailableModel, SessionRuntimeTarget } from "../../../shared/types";
import { createSessionModelPreference } from "../../../shared/modelDisplayName";
import { t } from "@/i18n";
import { WebSidebar, type WebSessionRowAction } from "./WebSidebar";
import { WebHeader, type WebHeaderStatus } from "./WebHeader";
import { WebTimeline, uiMessageImages, uiMessageText } from "./WebTimeline";
import { forkPromptText, isLastUserMessageIn, resolveWebForkEntryId } from "./webForkMutation";
import { WebComposer } from "./WebComposer";
import { WebBranchBar } from "./WebBranchBar";
import { sessionFromPath, sessionPath } from "./webSessionRoute";
import { WebWorkspaceDrawer } from "./WebWorkspaceDrawer";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui-shadcn/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui-shadcn/dialog";
import { Button } from "@/components/ui-shadcn/button";
import { Input } from "@/components/ui-shadcn/input";
import { chatMessagesToUiMessages, createProject, createSession, deleteProject, fetchMessagePage, fetchModels, fetchState, getWebAuthHeaders, respondToUi, setRuntimeModel, setRuntimeThinking, updateSessionRecord } from "./webApi";
import { abortRuntime, cloneRuntime, compactRuntime, copySession, deleteSession, downloadSessionHtml, editRuntimeMessage, deleteRuntimeMessage, prepareResend, renameSession, restartRuntime, activateRuntime, forkRuntimeSession, getForkMessages } from "./webApi";
import { fetchRuntimeContextUsage } from "./webApi";
import { dataUrlToFilePart } from "./webMessageParts";
import { shouldFlushQueuedPrompt } from "./webQueueFlush";
import { sessionUiMessagesToMarkdown } from "./webMarkdown";
import { removeMessageOptimistic, replaceMessageTextOptimistic } from "./webMessageOptimistic";
import { WebSessionStrips } from "./WebSessionStrips";

const MAX_SEARCH_JUMP_PAGES = 5;
import { WebFilePreview, type WebFilePreviewTarget } from "./WebFilePreview";
import { WebSearchDialog } from "./WebSearchDialog";
import { WebSkillsExtensionsDialog } from "./WebSkillsExtensionsDialog";
import { applyWebTheme, nextWebTheme, readStoredWebTheme, resolveWebTheme, storeWebTheme, systemPrefersDark, type ResolvedWebTheme, type WebThemePreference } from "./webTheme";
import { registerWebServiceWorker, usePwaInstall } from "./webPwa";
import { decideStreamRecovery } from "./webStreamRecovery";
import { useWebHeaderAutoHide } from "./useWebHeaderAutoHide";
import { resolveComposerHidden } from "./composerCollapse";
import { useIsMobileViewport } from "./useIsMobileViewport";
import { useExternalSessionStream } from "./webExternalStream";
import { useWebStateEvents } from "./webStateEvents";
import type { AgentUiResponse } from "../../../shared/types";
import type { WebProject, WebRuntime, WebState, WebContextUsage } from "./webTypes";

type HistoryMeta = {
	total: number;
	nextBefore: number | null;
};

type WebQueuedPrompt = {
	id: string;
	text: string;

	images: string[];

	agentMessage?: string;
};

export function WebChatApp() {
	const [state, setState] = useState<WebState>({
		projects: [],
		sessions: [],
		runtimes: [],
	});
	const [activeSessionId, setActiveSessionId] = useState<string>("");
	const [creatingProjectId, setCreatingProjectId] = useState<string>("");
	const [connected, setConnected] = useState(false);
	const [loadingMore, setLoadingMore] = useState(false);
	const [models, setModels] = useState<AvailableModel[]>([]);
	const [modelsRefreshing, setModelsRefreshing] = useState(false);

	const refreshModels = async () => {
		setModelsRefreshing(true);
		try {
			setModels(await fetchModels(true));
		} catch {
		} finally {
			setModelsRefreshing(false);
		}
	};
	const [commandError, setCommandError] = useState<string | null>(null);

	const [pendingModel, setPendingModel] = useState<{ provider: string; modelId: string; modelName: string } | null>(null);
	const [pendingThinkingLevel, setPendingThinkingLevel] = useState<string | null>(null);

	const [pendingBackend, setPendingBackend] = useState<AgentBackend | null>(null);

	const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
	const [uiResponding, setUiResponding] = useState(false);

	const [workspaceOpen, setWorkspaceOpen] = useState(false);
	const [renameDraft, setRenameDraft] = useState<{ sessionId: string; title: string } | null>(null);
	const [renameValue, setRenameValue] = useState("");
	const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

	const [prefill, setPrefill] = useState<{ text: string; nonce: number } | null>(null);

	const [pendingMessageAction, setPendingMessageAction] = useState<{ kind: "edit" | "delete" | "resend"; id: string } | null>(null);
	const [exitingMessageIds, setExitingMessageIds] = useState<ReadonlySet<string>>(new Set());
	const [flashMessageId, setFlashMessageId] = useState<string | null>(null);
	const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const [contextUsage, setContextUsage] = useState<WebContextUsage | undefined>(undefined);

	const overlayOpenRef = useRef(false);
	const { hidden: headerHidden, reportScroll: handleTimelineScroll, reveal: revealHeader } = useWebHeaderAutoHide(() => overlayOpenRef.current);
	const mobileViewport = useIsMobileViewport();

	const messagesBySessionRef = useRef<Record<string, UIMessage[]>>({});
	const loadedSessionsRef = useRef<Set<string>>(new Set());
	const historyMetaRef = useRef<Record<string, HistoryMeta>>({});

	const webDraftSessionsRef = useRef<Set<string>>(new Set());

	const refreshingSessionsRef = useRef<Set<string>>(new Set());

	const runtimeBusyPrevRef = useRef(false);
	const activeSessionIdRef = useRef<string>("");

	const pendingSendRef = useRef<{ sessionId: string; text: string; images?: string[]; agentMessage?: string } | null>(null);

	const { messages, sendMessage, status, stop, setMessages, error, clearError } = useChat({
		id: activeSessionId,
		transport: new DefaultChatTransport({
			api: "/api/chat",
			headers: getWebAuthHeaders(),
		}),
	});

	const streaming = status === "submitted" || status === "streaming";

	const [themePreference, setThemePreference] = useState<WebThemePreference>(() => readStoredWebTheme());
	const [systemDark, setSystemDark] = useState(() => systemPrefersDark());
	const resolvedTheme: ResolvedWebTheme = resolveWebTheme(themePreference, systemDark);
	const [searchOpen, setSearchOpen] = useState(false);
	const [assetsOpen, setAssetsOpen] = useState(false);
	const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);

	const [authExpired, setAuthExpired] = useState(false);
	useEffect(() => {
		const onAuthFailed = () => setAuthExpired(true);
		window.addEventListener("pideck-web-auth-failed", onAuthFailed);
		return () => window.removeEventListener("pideck-web-auth-failed", onAuthFailed);
	}, []);
	const recoveryLastAttemptRef = useRef(0);
	const statusRef = useRef(status);
	statusRef.current = status;

	const activeRuntimeRef = useRef<WebRuntime | undefined>(undefined);
	const { canInstall, install } = usePwaInstall();

	useEffect(() => {
		applyWebTheme(resolvedTheme);
	}, [resolvedTheme]);
	useEffect(() => {
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
		media.addEventListener("change", onChange);
		return () => media.removeEventListener("change", onChange);
	}, []);
	const cycleTheme = () => {
		const next: WebThemePreference = nextWebTheme(themePreference, resolvedTheme);
		setThemePreference(next);
		storeWebTheme(next);
	};

	useEffect(() => {
		registerWebServiceWorker();
	}, []);

	const routeRestoredRef = useRef(false);
	useEffect(() => {
		if (routeRestoredRef.current) return;
		const id = sessionFromPath(window.location.pathname);
		if (!id) {
			routeRestoredRef.current = true;
			return;
		}

		if (state.sessions.some((session) => session.id === id)) {
			setActiveSessionId(id);
			routeRestoredRef.current = true;
		} else if (state.sessions.length > 0 || connected) {
			window.history.replaceState(null, "", "/");
			routeRestoredRef.current = true;
		}
	}, [state.sessions, connected]);

	useEffect(() => {
		if (!routeRestoredRef.current) return;
		const desired = sessionPath(activeSessionId);
		if (window.location.pathname === desired) return;
		window.history.pushState(null, "", desired);
	}, [activeSessionId]);

	useEffect(() => {
		const onPopState = () => {
			setActiveSessionId(sessionFromPath(window.location.pathname));
		};
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, []);

	const recoverFromDisk = async (notify: boolean) => {
		const sessionId = activeSessionIdRef.current;
		if (!sessionId) return;
		try {
			const page = await fetchMessagePage(sessionId);
			const history = chatMessagesToUiMessages(page.messages);
			messagesBySessionRef.current[sessionId] = history;
			historyMetaRef.current[sessionId] = { total: page.total, nextBefore: page.nextBefore };
			if (activeSessionIdRef.current === sessionId) setMessages(history);

			clearError();
			if (notify) {
				setRecoveryNotice(t("web.streamRecovered"));
				setTimeout(() => setRecoveryNotice(null), 4000);
			}
		} catch {
			if (notify) {
				setRecoveryNotice(t("web.streamRecoveryFailed"));
				setTimeout(() => setRecoveryNotice(null), 4000);
			}
		}
	};
	useEffect(() => {
		const maybeRecover = () => {
			const decision = decideStreamRecovery({
				status: statusRef.current,
				runtimeBusy: activeRuntimeRef.current?.status === "running" || activeRuntimeRef.current?.status === "starting",
				documentVisible: !document.hidden,
				online: navigator.onLine,
				lastAttemptAt: recoveryLastAttemptRef.current,
				now: Date.now(),
			});
			if (!decision.recover) return;
			recoveryLastAttemptRef.current = Date.now();
			void recoverFromDisk(decision.notify);
		};
		document.addEventListener("visibilitychange", maybeRecover);
		window.addEventListener("online", maybeRecover);

		if (status === "error") maybeRecover();
		return () => {
			document.removeEventListener("visibilitychange", maybeRecover);
			window.removeEventListener("online", maybeRecover);
		};
	}, [status]);

	useEffect(() => {
		let hiddenAt = 0;
		const onVisibility = () => {
			if (document.visibilityState === "hidden") {
				hiddenAt = Date.now();
				return;
			}
			const hiddenFor = hiddenAt ? Date.now() - hiddenAt : 0;
			hiddenAt = 0;
			if (hiddenFor > 1000 && statusRef.current === "streaming") void stop();
		};
		document.addEventListener("visibilitychange", onVisibility);
		return () => document.removeEventListener("visibilitychange", onVisibility);
	}, [stop]);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setSearchOpen(true);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	const scrollToMessage = (messageId: string) => {
		document.getElementById(`web-msg-${messageId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
	};

	const jumpToSearchHit = async (messageId: string) => {
		if (!activeSessionId) return;
		for (let page = 0; page <= MAX_SEARCH_JUMP_PAGES; page += 1) {
			const target = document.getElementById(`web-msg-${messageId}`);
			if (target) {
				target.scrollIntoView({ behavior: "smooth", block: "start" });
				return;
			}
			const meta = historyMetaRef.current[activeSessionId];
			if (page === MAX_SEARCH_JUMP_PAGES || !meta || meta.nextBefore == null) return;
			await loadOlderMessages();

			await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
		}
	};

	const edgeSwipeRef = useRef<{ x: number; y: number } | null>(null);
	const onMainTouchStart = (event: React.TouchEvent<HTMLElement>) => {
		if (mobileSidebarOpen) return;
		const touch = event.touches[0];
		if (touch.clientX <= 28) edgeSwipeRef.current = { x: touch.clientX, y: touch.clientY };
	};
	const onMainTouchMove = (event: React.TouchEvent<HTMLElement>) => {
		const start = edgeSwipeRef.current;
		if (!start) return;
		const touch = event.touches[0];
		const dx = touch.clientX - start.x;
		const dy = touch.clientY - start.y;
		if (dx > 56 && Math.abs(dx) > Math.abs(dy) * 1.5) {
			edgeSwipeRef.current = null;
			setMobileSidebarOpen(true);
		}
	};
	const onMainTouchEnd = () => {
		edgeSwipeRef.current = null;
	};

	activeSessionIdRef.current = activeSessionId;

	const runtimeFor = (sessionId: string) => state.runtimes.find((runtime) => runtime.sessionId === sessionId);
	const activeSession = state.sessions.find((session) => session.id === activeSessionId);
	const activeRuntime = activeSessionId ? runtimeFor(activeSessionId) : undefined;

	const runtimeBusy = activeRuntime?.status === "running" || activeRuntime?.status === "starting";
	const { liveMessage, externalStreaming } = useExternalSessionStream({
		sessionId: activeSessionId,
		enabled: Boolean(activeSessionId) && !streaming,
		runtimeBusy,
		onSettled: (sessionId) => refreshSessionMessages(sessionId),
	});

	const stateRefreshRef = useRef<((payload?: unknown) => void) | null>(null);

	const stateEventsConnected = useWebStateEvents((payload) => {
		const refresh = stateRefreshRef.current;
		if (refresh) void refresh(payload);
	});
	activeRuntimeRef.current = activeRuntime;

	const [filePreview, setFilePreview] = useState<WebFilePreviewTarget | null>(null);
	const previewProjectRef = useRef<{ id: string; root: string } | null>(null);
	previewProjectRef.current = activeSession ? { id: activeSession.projectId, root: activeSession.projectPath ?? state.projects.find((project) => project.id === activeSession.projectId)?.path ?? "" } : null;
	const openFilePreview = useCallback((path: string, line?: number) => {
		const project = previewProjectRef.current;
		if (!project?.root) return;
		setFilePreview({ kind: "file", projectId: project.id, projectRoot: project.root, path, line });
	}, []);

	const overlayOpen = mobileSidebarOpen || searchOpen || assetsOpen || workspaceOpen || filePreview != null || renameDraft != null || deleteConfirmId != null;
	useEffect(() => {
		overlayOpenRef.current = overlayOpen;
		if (overlayOpen) revealHeader();
	}, [overlayOpen, revealHeader]);
	useEffect(() => {
		revealHeader();
	}, [activeSessionId, revealHeader]);
	useEffect(() => {
		if (!mobileViewport) revealHeader();
	}, [mobileViewport, revealHeader]);

	useEffect(() => {
		if (!mobileViewport) return;
		const onKeyDown = () => revealHeader();
		const onFocusIn = () => revealHeader();
		window.addEventListener("keydown", onKeyDown, true);
		document.addEventListener("focusin", onFocusIn, true);
		return () => {
			window.removeEventListener("keydown", onKeyDown, true);
			document.removeEventListener("focusin", onFocusIn, true);
		};
	}, [mobileViewport, revealHeader]);
	const [nearBottom, setNearBottom] = useState(true);
	const [composerEngaged, setComposerEngaged] = useState(false);
	const handleNearBottomChange = useCallback((value: boolean) => setNearBottom(value), []);
	const handleComposerEngagedChange = useCallback((value: boolean) => setComposerEngaged(value), []);
	useEffect(() => {
		if (nearBottom) revealHeader();
	}, [nearBottom, revealHeader]);

	useEffect(() => {
		if (!activeSessionId) return;
		if (loadedSessionsRef.current.has(activeSessionId)) {
			setMessages(messagesBySessionRef.current[activeSessionId] ?? []);
		}
		void refreshSessionMessages(activeSessionId);
	}, [activeSessionId, setMessages]);

	useEffect(() => {
		if (!activeSessionId || !streaming) return;
		messagesBySessionRef.current[activeSessionId] = messages;
		loadedSessionsRef.current.add(activeSessionId);
	}, [messages, activeSessionId, streaming]);

	useEffect(() => {
		const pending = pendingSendRef.current;
		if (!pending || pending.sessionId !== activeSessionId) return;
		if (streaming) return;
		pendingSendRef.current = null;
		void sendMessage({ text: pending.text, files: pending.images?.map(dataUrlToFilePart) ?? [] }, { body: { ...(pending.agentMessage ? { agentMessage: pending.agentMessage } : {}) } });
	}, [activeSessionId, streaming, sendMessage]);

	useEffect(() => {
		void fetchModels()
			.then(setModels)
			.catch(() => setModels([]));
	}, []);

	const lastStateFingerprintRef = useRef<string | null>(null);

	useEffect(() => {
		let disposed = false;
		const fingerprintOf = (state: NonNullable<Awaited<ReturnType<typeof fetchState>>>): string =>
			[
				(state.projects ?? [])
					.map((project) => project.id + ":" + project.name + ":" + (project.lastOpenedAt ?? 0) + ":" + (project.pinned ? 1 : 0))
					.sort()
					.join(","),
				(state.sessions ?? [])
					.map((session) => session.id + ":" + session.title + ":" + session.status + ":" + (session.updatedAt ?? 0) + ":" + (session.model?.modelId ?? "") + ":" + (session.thinkingLevel ?? ""))
					.sort()
					.join(","),
				(state.runtimes ?? [])
					.map((runtime) => runtime.sessionId + ":" + runtime.agentId + ":" + runtime.status + ":" + (runtime.runtimeGeneration ?? ""))
					.sort()
					.join(","),
				(state.pendingUiRequests ?? [])
					.map((request) => request.sessionId + ":" + request.requestId)
					.sort()
					.join(","),
			].join("|");

		const refresh = async (payload?: unknown) => {
			try {
				const next = payload && typeof payload === "object" && Array.isArray((payload as { runtimes?: unknown }).runtimes) ? (payload as NonNullable<Awaited<ReturnType<typeof fetchState>>>) : await fetchState();

				if (disposed || next === null) return;
				setConnected(true);
				const fingerprint = fingerprintOf(next);
				const unchanged = fingerprint === lastStateFingerprintRef.current;
				lastStateFingerprintRef.current = fingerprint;
				if (unchanged) {
					return;
				}
				setState(next);

				const runtimeStillBusy = (() => {
					const runtime = next.runtimes.find((entry) => entry.sessionId === activeSessionIdRef.current);
					return runtime?.status === "running" || runtime?.status === "starting";
				})();
				if (runtimeStillBusy) {
					runtimeBusyPrevRef.current = true;
					const decision = decideStreamRecovery({
						status: statusRef.current,
						runtimeBusy: true,
						documentVisible: !document.hidden,
						online: navigator.onLine,
						lastAttemptAt: recoveryLastAttemptRef.current,
						now: Date.now(),
					});
					if (decision.recover) {
						recoveryLastAttemptRef.current = Date.now();
						void recoverFromDisk(false);
					}
				} else if (runtimeBusyPrevRef.current) {
					runtimeBusyPrevRef.current = false;
					void refreshSessionMessages(activeSessionIdRef.current);
				}

				if (activeSessionIdRef.current && !next.sessions.some((session) => session.id === activeSessionIdRef.current)) {
					setActiveSessionId("");
				}
			} catch {
				if (!disposed) setConnected(false);
			}
		};
		void refresh();

		stateRefreshRef.current = refresh;
		const runtimeBusyNow = activeRuntime?.status === "running" || activeRuntime?.status === "starting";
		const timer = setInterval(refresh, stateEventsConnected ? 30_000 : streaming || runtimeBusyNow ? 1000 : 3000);
		return () => {
			disposed = true;
			clearInterval(timer);
		};
	}, [streaming, activeRuntime?.status, stateEventsConnected]);

	const handleStop = () => {
		if ((queuedBySession[activeSessionId] ?? []).length > 0) setQueuePausedBoth(true);
		stop();
		const runtime = activeSessionId ? runtimeFor(activeSessionId) : undefined;
		if (runtime) {
			void abortRuntime(runtime.sessionId, {
				sessionId: runtime.sessionId,
				agentId: runtime.agentId,
				runtimeGeneration: runtime.runtimeGeneration ?? 0,
			}).catch(() => {});
		}
	};

	const handleSend = (text: string, images: string[], agentMessage?: string) => {
		if (!text.trim() && images.length === 0) return;

		queuePausedRef.current = false;
		if (!activeSessionId) {
			void sendFromHome(text, images, agentMessage);
			return;
		}

		void sendMessage({ text, files: images.map(dataUrlToFilePart) }, { body: { ...(agentMessage ? { agentMessage } : {}) } });
	};

	const [queuedBySession, setQueuedBySession] = useState<Record<string, WebQueuedPrompt[]>>({});
	const queuePausedRef = useRef(false);
	const [queuePaused, setQueuePaused] = useState(false);
	const queueSeqRef = useRef(0);

	const setQueuePausedBoth = (paused: boolean) => {
		queuePausedRef.current = paused;
		setQueuePaused(paused);
	};

	const handleQueue = (text: string, images: string[], agentMessage?: string) => {
		const sessionId = activeSessionIdRef.current;
		if (!sessionId) return;
		if (!text.trim() && images.length === 0) return;
		queueSeqRef.current += 1;
		const item: WebQueuedPrompt = { id: `q-${Date.now()}-${queueSeqRef.current}`, text, images, agentMessage };
		setQueuedBySession((current) => ({ ...current, [sessionId]: [...(current[sessionId] ?? []), item] }));

		setQueuePausedBoth(false);
	};

	const handleRemoveQueued = (id: string) => {
		const sessionId = activeSessionIdRef.current;
		if (!sessionId) return;
		setQueuedBySession((current) => {
			const next = (current[sessionId] ?? []).filter((item) => item.id !== id);
			return { ...current, [sessionId]: next };
		});
	};

	const queueFlushingRef = useRef(false);
	useEffect(() => {
		const sessionId = activeSessionId;
		if (!sessionId) return;
		const queueForSession = queuedBySession[sessionId] ?? [];
		const flushable = shouldFlushQueuedPrompt({
			streaming,
			externalStreaming,
			runtimeStatus: activeRuntime?.status,

			hasPendingUiRequest: (state.pendingUiRequests ?? []).some((item) => item.sessionId === sessionId),
			paused: queuePausedRef.current,
			queuedCount: queueForSession.length,
			flushing: queueFlushingRef.current,
		});
		if (!flushable) return;
		const next = queueForSession[0];
		if (!next) return;
		queueFlushingRef.current = true;
		setQueuedBySession((current) => ({ ...current, [sessionId]: (current[sessionId] ?? []).slice(1) }));
		void sendMessage({ text: next.text, files: next.images.map(dataUrlToFilePart) }, { body: { ...(next.agentMessage ? { agentMessage: next.agentMessage } : {}) } }).then(
			() => {
				queueFlushingRef.current = false;
			},
			(error: unknown) => {
				queueFlushingRef.current = false;

				setQueuedBySession((current) => ({ ...current, [sessionId]: [next, ...(current[sessionId] ?? [])] }));
				setQueuePausedBoth(true);
				setCommandError(error instanceof Error ? error.message : String(error));
			},
		);
	}, [activeSessionId, streaming, externalStreaming, activeRuntime?.status, state.pendingUiRequests, queuedBySession, sendMessage]);

	const handleBackendChange = async (backend: AgentBackend) => {
		if (activeSession && (activeRuntime || backendSwitchLocked(activeSession.id))) return;
		if (!activeSession) {
			setPendingBackend(backend);
			setPendingModel(null);
			setPendingThinkingLevel(null);
			return;
		}
		setCommandError(null);
		try {
			await updateSessionRecord(activeSession.id, { backend, model: null, thinkingLevel: null });
			await refreshNow();
		} catch (error) {
			setCommandError(error instanceof Error ? error.message : String(error));
		}
	};

	const sendFromHome = async (text: string, images: string[], agentMessage?: string) => {
		const project = state.projects.find((candidate) => candidate.kind === "chat") ?? state.projects[0];
		if (!project) {
			setCommandError(t("web.sendNoProject"));
			return;
		}
		setCreatingProjectId(project.id);
		setCommandError(null);
		try {
			const id = await createSession(project.id, {
				...(pendingBackend ? { backend: pendingBackend } : {}),
				...(pendingModel ? { model: pendingModel } : {}),
				...(pendingThinkingLevel ? { thinkingLevel: pendingThinkingLevel } : {}),
			});
			markSessionLoaded(id, true);
			setActiveSessionId(id);
			setMobileSidebarOpen(false);

			pendingSendRef.current = { sessionId: id, text, images, ...(agentMessage ? { agentMessage } : {}) };
			await refreshNow();
		} catch (error) {
			setCommandError(error instanceof Error ? error.message : String(error));
			setConnected(false);
		} finally {
			setCreatingProjectId("");
		}
	};

	const markSessionLoaded = (id: string, freshDraft = false) => {
		if (freshDraft) webDraftSessionsRef.current.add(id);
		loadedSessionsRef.current.add(id);
		messagesBySessionRef.current[id] = [];
		historyMetaRef.current[id] = { total: 0, nextBefore: null };
	};

	const backendSwitchLocked = (sessionId: string) => !webDraftSessionsRef.current.has(sessionId) || (messagesBySessionRef.current[sessionId]?.length ?? 0) > 0 || (historyMetaRef.current[sessionId]?.total ?? 0) > 0;

	const handleCreateSession = async (projectId: string) => {
		setCreatingProjectId(projectId);
		setCommandError(null);
		try {
			const id = await createSession(projectId, {
				...(pendingBackend ? { backend: pendingBackend } : {}),
				...(pendingModel ? { model: pendingModel } : {}),
				...(pendingThinkingLevel ? { thinkingLevel: pendingThinkingLevel } : {}),
			});
			markSessionLoaded(id, true);
			setActiveSessionId(id);
			setMobileSidebarOpen(false);
			await refreshNow();
		} catch (error) {
			setCommandError(error instanceof Error ? error.message : String(error));
			setConnected(false);
		} finally {
			setCreatingProjectId("");
		}
	};

	const handleCreateProject = async (path: string): Promise<WebProject> => {
		setCommandError(null);
		try {
			const project = await createProject(path);
			await refreshNow();
			return project;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setCommandError(message);
			throw error;
		}
	};

	const handleDeleteProject = async (projectId: string) => {
		setCommandError(null);
		try {
			const deletedSessions = state.sessions.filter((session) => session.projectId === projectId);
			await deleteProject(projectId);
			for (const session of deletedSessions) {
				delete messagesBySessionRef.current[session.id];
				delete historyMetaRef.current[session.id];
				loadedSessionsRef.current.delete(session.id);
			}
			setState((current) => ({
				...current,
				projects: current.projects.filter((project) => project.id !== projectId),
				sessions: current.sessions.filter((session) => session.projectId !== projectId),
				runtimes: current.runtimes.filter((runtime) => !deletedSessions.some((session) => session.id === runtime.sessionId)),
			}));
			if (deletedSessions.some((session) => session.id === activeSessionId)) {
				setActiveSessionId("");
			}
			setMobileSidebarOpen(false);
		} catch (error) {
			setCommandError(error instanceof Error ? error.message : String(error));
		}
	};

	const updateActiveSessionState = (patch: { model?: { provider: string; modelId: string; modelName?: string }; thinkingLevel?: string }) => {
		setState((current) => ({
			...current,
			sessions: current.sessions.map((session) => (session.id === activeSessionId ? { ...session, ...patch } : session)),
		}));
	};

	const handleModelChange = async (model: AvailableModel) => {
		if (!activeSessionId) {
			setPendingModel(createSessionModelPreference(model.provider, model.id, model.name));
			return;
		}
		setCommandError(null);
		const selectedModel = createSessionModelPreference(model.provider, model.id, model.name);
		try {
			if (activeRuntime) {
				await setRuntimeModel(
					{
						sessionId: activeRuntime.sessionId,
						agentId: activeRuntime.agentId,
						runtimeGeneration: activeRuntime.runtimeGeneration ?? 0,
					},
					selectedModel.provider,
					selectedModel.modelId,
					selectedModel.modelName,
				);
			} else {
				await updateSessionRecord(activeSessionId, { model: selectedModel });
			}
			updateActiveSessionState({ model: selectedModel });
		} catch (error) {
			setCommandError(error instanceof Error ? error.message : String(error));
		}
	};

	const handleThinkingChange = async (level: string) => {
		if (!activeSessionId) {
			setPendingThinkingLevel(level);
			return;
		}
		setCommandError(null);
		try {
			if (activeRuntime) {
				await setRuntimeThinking(
					{
						sessionId: activeRuntime.sessionId,
						agentId: activeRuntime.agentId,
						runtimeGeneration: activeRuntime.runtimeGeneration ?? 0,
					},
					level,
				);
			} else {
				await updateSessionRecord(activeSessionId, { thinkingLevel: level });
			}
			updateActiveSessionState({ thinkingLevel: level });
		} catch (error) {
			setCommandError(error instanceof Error ? error.message : String(error));
		}
	};

	const refreshNow = async () => {
		try {
			const next = await fetchState();

			if (next) setState(next);
			setConnected(true);
		} catch {
			setConnected(false);
		}
	};

	const handleRespondUi = async (response: AgentUiResponse) => {
		const request = (state.pendingUiRequests ?? []).find((item) => item.sessionId === activeSessionId);
		if (!request || uiResponding) return;
		setUiResponding(true);
		setCommandError(null);
		try {
			await respondToUi({
				sessionId: request.sessionId,
				requestId: request.requestId,
				agentId: request.agentId,
				runtimeGeneration: request.runtimeGeneration,
				response,
			});
			await refreshNow();
		} catch (error) {
			setCommandError(error instanceof Error ? error.message : String(error));
		} finally {
			setUiResponding(false);
		}
	};

	const loadOlderMessages = async (): Promise<boolean> => {
		if (!activeSessionId || loadingMore) return false;
		const meta = historyMetaRef.current[activeSessionId];
		if (!meta || meta.nextBefore == null) return false;
		setLoadingMore(true);
		try {
			const page = await fetchMessagePage(activeSessionId, meta.nextBefore);

			historyMetaRef.current[activeSessionId] = {
				total: page.total,
				nextBefore: page.nextBefore,
			};
			const older = chatMessagesToUiMessages(page.messages);
			const merged = [...older, ...messagesBySessionRef.current[activeSessionId]];
			messagesBySessionRef.current[activeSessionId] = merged;
			setMessages(merged);
			return older.length > 0;
		} catch {
			return false;
		} finally {
			setLoadingMore(false);
		}
	};

	const handleLoadMore = async () => {
		if (!activeSessionId || streaming) return;
		await loadOlderMessages();
	};

	const activeTarget = activeRuntime
		? {
				sessionId: activeRuntime.sessionId,
				agentId: activeRuntime.agentId,
				runtimeGeneration: activeRuntime.runtimeGeneration ?? 0,
			}
		: undefined;

	const refreshSessionMessages = async (sessionId: string) => {
		if (!sessionId || refreshingSessionsRef.current.has(sessionId)) return;
		refreshingSessionsRef.current.add(sessionId);
		try {
			const page = await fetchMessagePage(sessionId);
			const history = chatMessagesToUiMessages(page.messages);
			messagesBySessionRef.current[sessionId] = history;
			historyMetaRef.current[sessionId] = { total: page.total, nextBefore: page.nextBefore };
			loadedSessionsRef.current.add(sessionId);

			if (activeSessionIdRef.current === sessionId && statusRef.current === "ready") setMessages(history);
		} catch {
		} finally {
			refreshingSessionsRef.current.delete(sessionId);
		}
	};

	const reloadActiveHistory = async () => {
		if (!activeSessionId) return;
		await refreshSessionMessages(activeSessionId);
	};

	const applyLocalMessages = (sessionId: string, updater: (messages: UIMessage[]) => UIMessage[]) => {
		const current = messagesBySessionRef.current[sessionId] ?? [];
		const next = updater(current);
		if (next === current) return;
		messagesBySessionRef.current[sessionId] = next;
		if (activeSessionIdRef.current === sessionId) setMessages(next);
	};

	const runSessionAction = async (action: WebSessionRowAction, sessionId: string) => {
		setCommandError(null);
		try {
			if (action === "rename") {
				const session = state.sessions.find((item) => item.id === sessionId);
				setRenameDraft({ sessionId, title: session?.title ?? "" });
				setRenameValue(session?.title ?? "");
				return;
			}
			if (action === "duplicate") {
				const newId = await copySession(sessionId);
				if (newId) markSessionLoaded(newId);
				await refreshNow();
				return;
			}
			if (action === "export") {
				await downloadSessionHtml(sessionId);
				return;
			}
			setDeleteConfirmId(sessionId);
		} catch (error) {
			setCommandError(error instanceof Error ? error.message : String(error));
		}
	};

	const confirmRename = async () => {
		if (!renameDraft) return;
		const title = renameValue.trim();
		if (!title) return;
		try {
			await renameSession(renameDraft.sessionId, title);
			setState((current) => ({ ...current, sessions: current.sessions.map((session) => (session.id === renameDraft.sessionId ? { ...session, title } : session)) }));
			setRenameDraft(null);
		} catch (error) {
			setCommandError(error instanceof Error ? error.message : String(error));
		}
	};

	const confirmDeleteSession = async () => {
		const sessionId = deleteConfirmId;
		if (!sessionId) return;
		setDeleteConfirmId(null);
		setCommandError(null);
		try {
			await deleteSession(sessionId);
			delete messagesBySessionRef.current[sessionId];
			delete historyMetaRef.current[sessionId];
			loadedSessionsRef.current.delete(sessionId);
			if (activeSessionIdRef.current === sessionId) setActiveSessionId("");
			await refreshNow();
		} catch (error) {
			setCommandError(error instanceof Error ? error.message : String(error));
		}
	};

	const runRuntimeAction = async (action: "restart" | "compact" | "clone") => {
		if (!activeTarget) return;
		setCommandError(null);
		try {
			if (action === "restart") {
				await restartRuntime(activeTarget.sessionId, activeTarget);
			} else if (action === "compact") {
				await compactRuntime(activeTarget.sessionId, activeTarget);
			} else {
				const cloned = await cloneRuntime(activeTarget.sessionId, activeTarget);
				const newId = typeof cloned.targetSessionId === "string" ? cloned.targetSessionId : "";
				if (newId) markSessionLoaded(newId);
				await refreshNow();
				if (newId) setActiveSessionId(newId);
				return;
			}
			await refreshNow();
			await reloadActiveHistory();
		} catch (error) {
			setCommandError(error instanceof Error ? error.message : String(error));
		}
	};

	const handleCopyMarkdown = async () => {
		if (!activeSessionId) return;
		const markdown = sessionUiMessagesToMarkdown(messagesBySessionRef.current[activeSessionId] ?? []);
		try {
			await navigator.clipboard.writeText(markdown || "");
		} catch {
			setCommandError(t("web.copyFailed"));
		}
	};

	const runForkMutation = async (kind: "edit" | "resend", message: UIMessage, newText?: string) => {
		const sessionId = activeSessionIdRef.current;
		if (!sessionId || pendingMessageAction) return;
		setCommandError(null);
		setPendingMessageAction({ kind, id: message.id });
		try {
			let target = activeTarget;
			if (!target) target = await activateRuntime(sessionId);
			const entryId = await resolveWebForkEntryId(message, target, (t) => getForkMessages(sessionId, t));
			if (!entryId) {
				setCommandError(t("web.forkMissingEntryId"));
				return;
			}
			const result = await forkRuntimeSession(sessionId, target, entryId, {
				mutationFork: true,

				branchMode: !isLastUserMessageIn(messagesBySessionRef.current[sessionId] ?? [], message.id),
			});
			if (result.cancelled) {
				setCommandError(t("web.forkCancelled"));
				return;
			}
			const newId = typeof result.targetSessionId === "string" ? result.targetSessionId : "";
			if (!newId) {
				setCommandError(t("web.forkMissingEntryId"));
				return;
			}
			const promptText = forkPromptText(kind, result, message, newText);
			const images = uiMessageImages(message);

			markSessionLoaded(newId);
			await refreshNow();
			setActiveSessionId(newId);
			pendingSendRef.current = { sessionId: newId, text: promptText, images: images.length > 0 ? images : undefined };
		} catch (error) {
			await reloadActiveHistory();
			setCommandError(error instanceof Error ? error.message : String(error));
		} finally {
			setPendingMessageAction(null);
		}
	};

	const findActiveMessage = (messageId: string): UIMessage | undefined => {
		const live = messages.find((item) => item.id === messageId);
		if (live) return live;
		const cached = messagesBySessionRef.current[activeSessionIdRef.current];
		return cached?.find((item) => item.id === messageId);
	};

	const handleEditMessage = async (messageId: string, newText: string) => {
		if (pendingMessageAction) return;
		const message = findActiveMessage(messageId);
		if (!message) return;

		{
			await runForkMutation("edit", message, newText);
			return;
		}
	};

	const handleDeleteMessage = async (messageId: string) => {
		if (!activeTarget || pendingMessageAction) return;
		setCommandError(null);
		setPendingMessageAction({ kind: "delete", id: messageId });

		setExitingMessageIds(new Set([messageId]));
		await new Promise((resolve) => setTimeout(resolve, 190));
		applyLocalMessages(activeTarget.sessionId, (messages) => removeMessageOptimistic(messages, messageId));
		setExitingMessageIds(new Set());
		try {
			await deleteRuntimeMessage(activeTarget.sessionId, activeTarget, messageId);
			await reloadActiveHistory();
		} catch (error) {
			await reloadActiveHistory();
			setCommandError(error instanceof Error ? error.message : String(error));
		} finally {
			setPendingMessageAction(null);
		}
	};

	const handleResendMessage = async (messageId: string) => {
		if (pendingMessageAction) return;
		const message = findActiveMessage(messageId);
		if (!message) return;

		{
			await runForkMutation("resend", message);
			return;
		}
	};

	useEffect(() => {
		if (!activeTarget) {
			setContextUsage(undefined);
			return;
		}
		let disposed = false;
		const load = async () => {
			try {
				const usage = await fetchRuntimeContextUsage(activeTarget.sessionId, activeTarget);
				if (!disposed) setContextUsage(usage);
			} catch {}
		};
		void load();

		const intervalMs = streaming ? (stateEventsConnected ? 3000 : 1000) : 10_000;
		const timer = setInterval(() => {
			if (document.hidden) return;
			void load();
		}, intervalMs);
		return () => {
			disposed = true;
			clearInterval(timer);
		};
	}, [activeTarget?.sessionId, activeTarget?.agentId, activeTarget?.runtimeGeneration, streaming, stateEventsConnected]);

	const headerStatus: WebHeaderStatus = (() => {
		if (streaming) return "running";
		const runtimeStatus = activeRuntime?.status;
		if (runtimeStatus === "starting") return "starting";
		if (runtimeStatus === "running") return "running";
		if (runtimeStatus === "error") return "error";
		return "idle";
	})();

	const activeMeta = activeSessionId ? historyMetaRef.current[activeSessionId] : undefined;
	const hasMoreHistory = Boolean(activeMeta && activeMeta.nextBefore != null && !streaming);
	const moreCount = activeMeta ? Math.max(0, activeMeta.total - messagesBySessionRef.current[activeSessionId]?.length) : 0;

	const lastUserIndex = liveMessage ? messages.map((message) => message.role).lastIndexOf("user") : -1;
	const timelineMessages = liveMessage && lastUserIndex >= 0 ? [...messages.slice(0, lastUserIndex + 1), liveMessage] : liveMessage ? [...messages, liveMessage] : messages;

	const transportError = error && !externalStreaming && !liveMessage ? error.message : null;
	const combinedStreaming = streaming || externalStreaming;

	const composerTurnBusy = combinedStreaming || activeRuntime?.status === "running" || activeRuntime?.status === "starting";
	const composerHidden = resolveComposerHidden({ headerHidden, nearBottom, streaming: combinedStreaming, engaged: composerEngaged });

	return (
		<div className="app web-app wechat-shell flex h-[100dvh] w-full min-w-0 overflow-hidden bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-foreground [[data-bg-image=on]_&]:bg-transparent" data-header-hidden={headerHidden ? "on" : undefined}>
			<WebSidebar
				state={state}
				activeSessionId={activeSessionId}
				creatingProjectId={creatingProjectId}
				connected={connected}
				mobileOpen={mobileSidebarOpen}
				onCloseMobile={() => setMobileSidebarOpen(false)}
				onSelectSession={(sessionId) => {
					setActiveSessionId(sessionId);
					setMobileSidebarOpen(false);
				}}
				onSessionAction={(action, sessionId) => void runSessionAction(action, sessionId)}
				onCreateSession={(projectId) => void handleCreateSession(projectId)}
				onCreateProject={handleCreateProject}
				onDeleteProject={handleDeleteProject}
			/>
			<main className="chat-pane flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-bg-panel" onTouchStart={onMainTouchStart} onTouchMove={onMainTouchMove} onTouchEnd={onMainTouchEnd} onTouchCancel={onMainTouchEnd}>
				<WebHeader
					headerHidden={headerHidden}
					title={activeSession?.title || t("web.chooseSession")}
					status={headerStatus}
					onOpenSidebar={() => setMobileSidebarOpen(true)}
					backend={activeSession?.backend}
					contextUsage={contextUsage}
					usageProvider={contextUsage?.provider ?? activeSession?.model?.provider}
					usageBackend="pi"
					actions={{
						onOpenWorkspace: activeSession ? () => setWorkspaceOpen(true) : undefined,
						onRename: activeSessionId ? () => void runSessionAction("rename", activeSessionId) : undefined,
						onDuplicate: activeSessionId ? () => void runSessionAction("duplicate", activeSessionId) : undefined,
						onExportHtml: activeSessionId ? () => void runSessionAction("export", activeSessionId) : undefined,
						onCopyMarkdown: activeSessionId ? () => void handleCopyMarkdown() : undefined,
						onRefreshMessages: activeSessionId ? () => void refreshSessionMessages(activeSessionId) : undefined,
						onRestart: activeTarget ? () => void runRuntimeAction("restart") : undefined,
						onCompact: activeTarget ? () => void runRuntimeAction("compact") : undefined,
						onClone: activeTarget ? () => void runRuntimeAction("clone") : undefined,
						onDelete: activeSessionId ? () => void runSessionAction("delete", activeSessionId) : undefined,
					}}
					onOpenSearch={() => setSearchOpen(true)}
					themePreference={themePreference}
					resolvedTheme={resolvedTheme}
					onCycleTheme={cycleTheme}
					canInstall={canInstall}
					onInstall={() => void install()}
					onOpenAssets={() => setAssetsOpen(true)}
				/>

				<WebBranchBar sessions={state.sessions} activeSessionId={activeSessionId} onSelect={(sessionId) => setActiveSessionId(sessionId)} />

				{recoveryNotice ? <div className="border-b border-border bg-primary/10 px-3 py-1 text-center text-xs text-primary">{recoveryNotice}</div> : null}

				{authExpired ? (
					<div className="flex items-center justify-center gap-2 border-b border-border bg-destructive/10 px-3 py-1.5 text-center text-xs text-destructive">
						<span>{t("web.authExpired")}</span>
						<Button variant="outline" size="sm" className="h-6 px-2 text-micro" onClick={() => window.location.reload()}>
							{t("web.authExpiredRetry")}
						</Button>
					</div>
				) : null}
				<WebTimeline
					messages={timelineMessages}
					hasActiveSession={Boolean(activeSession)}
					hasMoreHistory={hasMoreHistory}
					moreCount={moreCount}
					loadingMore={loadingMore}
					streaming={combinedStreaming}
					error={transportError ?? commandError}
					pendingUiRequest={(state.pendingUiRequests ?? []).find((item) => item.sessionId === activeSessionId)}
					uiResponding={uiResponding}
					onRespondUi={(response) => void handleRespondUi(response)}
					onLoadMore={() => void handleLoadMore()}
					onScrollTopChange={handleTimelineScroll}
					onNearBottomChange={handleNearBottomChange}
					canManageMessages={true}
					canDeleteMessage={Boolean(activeTarget)}
					pendingMessageAction={pendingMessageAction}
					exitingMessageIds={exitingMessageIds}
					flashMessageId={flashMessageId}
					onEditMessage={(messageId, newText) => void handleEditMessage(messageId, newText)}
					onDeleteMessage={(messageId) => void handleDeleteMessage(messageId)}
					onResendMessage={(messageId) => void handleResendMessage(messageId)}
					onOpenFile={openFilePreview}
				/>
				<WebSessionStrips sessionId={activeSessionId} />
				<WebComposer
					hasSession={Boolean(activeSessionId)}
					disabled={Boolean(creatingProjectId)}
					streaming={composerTurnBusy}
					prefill={prefill ?? undefined}
					onSend={handleSend}
					onStop={handleStop}
					backend={activeSession?.backend ?? pendingBackend ?? "pi"}
					backendLocked={activeSession ? Boolean(activeRuntime) || backendSwitchLocked(activeSession.id) : false}
					onBackendChange={(backend) => void handleBackendChange(backend)}
					model={activeSession?.model ?? pendingModel ?? undefined}
					models={models}
					refreshingModels={modelsRefreshing}
					onRefreshModels={() => void refreshModels()}
					onModelChange={(model) => void handleModelChange(model)}
					thinkingLevel={activeSession?.thinkingLevel ?? pendingThinkingLevel ?? undefined}
					onThinkingChange={(level) => void handleThinkingChange(level)}
					onFocusChange={(focused) => {
						if (focused) revealHeader();
					}}
					onEngagedChange={handleComposerEngagedChange}
					hidden={composerHidden}
					onQueue={handleQueue}
					queued={(queuedBySession[activeSessionId] ?? []).map((item) => ({ id: item.id, text: item.text, imageCount: item.images.length }))}
					onRemoveQueued={handleRemoveQueued}
					queuePaused={queuePaused}
					onResumeQueue={() => setQueuePausedBoth(false)}
				/>
			</main>

			<WebSearchDialog open={searchOpen} onOpenChange={setSearchOpen} sessionId={activeSessionId} messages={messages} onJump={jumpToSearchHit} />
			<WebSkillsExtensionsDialog open={assetsOpen} onOpenChange={setAssetsOpen} />

			{workspaceOpen && activeSession && <WebWorkspaceDrawer projectId={activeSession.projectId} open={workspaceOpen} onClose={() => setWorkspaceOpen(false)} onOpenFile={openFilePreview} />}

			{filePreview ? <WebFilePreview target={filePreview} onClose={() => setFilePreview(null)} /> : null}

			<Dialog open={renameDraft != null} onOpenChange={(open) => (!open ? setRenameDraft(null) : undefined)}>
				<DialogContent className="max-w-sm">
					<DialogHeader>
						<DialogTitle>{t("web.renameTitle")}</DialogTitle>
					</DialogHeader>
					<Input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} placeholder={t("web.renamePlaceholder")} onKeyDown={(event) => (event.key === "Enter" ? void confirmRename() : undefined)} />
					<DialogFooter>
						<Button type="button" variant="ghost" size="sm" onClick={() => setRenameDraft(null)}>
							{t("common.cancel")}
						</Button>
						<Button type="button" size="sm" disabled={!renameValue.trim()} onClick={() => void confirmRename()}>
							{t("common.confirm")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<AlertDialog open={deleteConfirmId != null} onOpenChange={(open) => (!open ? setDeleteConfirmId(null) : undefined)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t("web.deleteSessionConfirmTitle")}</AlertDialogTitle>
						<AlertDialogDescription>{t("web.deleteSessionConfirmBody")}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
						<AlertDialogAction className="bg-danger text-danger-foreground hover:bg-danger/90" onClick={() => void confirmDeleteSession()}>
							{t("common.delete")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
