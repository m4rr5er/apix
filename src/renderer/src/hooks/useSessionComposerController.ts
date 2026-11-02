import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { AgentBackend, ChatMessage, ComposerAgentMode, FileTreeNode, ImageContent, PiCommand, ResolvedLaunchDefaults, SessionRuntimeTarget, SessionSummary } from "../../../shared/types";
import { DEFAULT_IMAGE_GEN_OUTPUT_FORMAT, DEFAULT_IMAGE_GEN_SIZE, DEFAULT_IMAGE_GEN_WATERMARK, parseImageGenOutputFormat, parseImageGenSize, parseImageGenWatermark } from "../../../shared/imageGenParams";
import { resolveBusySendDelivery } from "../../../shared/busySendDelivery";
import { FILE_TREE_ABSOLUTE_MAX_DEPTH } from "../../../shared/fileTree";
import { classifyCompactError, compactOwnerReason, compactRoutedCommand, type CompactNoticeKind } from "../../../shared/compactFeedback";
import { findImageGenProvider } from "../../../shared/imageGenConfig";
import { findVideoGenProvider } from "../../../shared/videoGenConfig";
import { resolveEnhanceTargetModel } from "../../../shared/enhanceModelPreference";
import { collectPromptEnhanceContext } from "../utils/promptEnhanceContext";
import { sessionCommandsRefreshTickAtom } from "../atoms/session-commands-atoms";
import type { ImageGenMeta } from "../../../shared/types/imagegen";
import type { VideoGenMeta } from "../../../shared/types/videogen";
import {
	busySendDeliveryAtom,
	cacheSessionMessagesAtom,
	enhanceModelAtom,
	enhanceIncludeContextAtom,
	promptSuggestionEnabledAtom,
	promptSuggestionModelAtom,
	imageGenConfigAtom,
	projectByIdAtomFamily,
	sessionAttachmentsBySessionIdAtomFamily,
	sessionComposerModeBySessionIdAtomFamily,
	sessionDraftByIdAtom,
	sessionDraftBySessionIdAtomFamily,
	sessionMessageCacheBySessionIdAtomFamily,
	sessionMessagesCacheAtom,
	sessionPasteFilesBySessionIdAtomFamily,
	sessionRecordByIdAtomFamily,
	sessionRecordsAtom,
	sessionRuntimeBySessionIdAtomFamily,
	sessionRuntimeUiBySessionIdAtomFamily,
	sessionQuotesBySessionIdAtomFamily,
	sessionSendStateBySessionIdAtomFamily,
	sessionSummariesByProjectIdAtomFamily,
	setSessionAttachmentsAtom,
	setSessionComposerModeAtom,
	setSessionDraftAtom,
	setSessionPasteFilesAtom,
	setSessionSendStateAtom,
	videoGenConfigAtom,
	upsertSessionAtom,
	promoteSessionComposerStateAtom,
	removeSessionStateAtom,
	currentSessionIdAtom,
	acpToolsAtom,
	type PastedTextFile,
} from "../atoms";
import {
	appendContentToDraft,
	appendSlashCommandToDraft,
	stripMarkdownFrontmatter,
	toSkillInvocationToken,
	getComposerEnterIntent,
	resolveComposerHistoryIntent,
	isComposingKeyboardEvent,
	isPlanModeSendKey,
	parseArgumentHint,
	translateBuiltinPromptDescription,
	extractUserPrompts,
	mergePromptHistory,
	deriveComposerAgentMode,
	type PromptTemplateInfo,
} from "../composerBehavior";
import { applySuggestion, buildSuggestionItems, clearSuggestionTrigger, detectTrigger, fileNodeDragPayloadToRef, flattenFiles, mergeCommands, PI_FILE_NODE_DRAG_MIME, PI_FILE_PATH_DRAG_MIME, readFileNodeDragPayload, type SuggestionItem } from "../components/app/AppUtils";
import { SESSION_TAB_DRAG_MIME } from "../utils/sessionSplitEdge";
import { mergeFileTreeChildren, resolveAtDrillDirectory, shouldLoadFullTreeForAtSearch } from "../utils/fileTreeLazy";
import { formatFilePathRef, type ComposerChip } from "../components/session/composer/chips";
import type { ComposerCaretRequest } from "../components/session/composer/types";
import { getComposerCaretCoords, getComposerCaretOffset, getComposerCaretBlockEdge, getComposerSelectionRange, isComposerAtVisualEdge } from "../components/session/composer/caretCoords";
import { desktopApi } from "../desktopApi";
import { useAskPanel } from "./useAskPanel";
import { formatBytes } from "../../../shared/formatBytes";
import { t } from "../i18n";
import { COMPOSER_ATTACHMENT_BUDGET_BYTES, COMPOSER_IMAGE_MAX_BYTES, ComposerImageError, attachmentBytes, base64DataBytes, dataUrlToFile, getClipboardImageFiles, getDroppedImageFiles, imageMimeTypeFromPath, isImageFilePath, processComposerImageFile } from "../utils/composerImages";
import { PASTE_TO_FILE_MIN_CHARS } from "../rendererUtils";
import { resolveBackendSwitchDefaults } from "../utils/backendSwitchDefaults";
import { GUIDE_BOOTSTRAP_SESSION_ID, readLastSessionPreference, readWelcomeAcpToolPreference, readWelcomeBackendPreference, readWelcomeModelPreference, resolveGuidePageBackend, WELCOME_BACKEND_KEY } from "../utils/chatSessionBootstrap";
import { expandSessionReferences } from "../sending/outgoingExpansion";
import { showNotice } from "../utils/notice";
import { requireSessionCommand, toSessionRuntimeTarget } from "../utils/sessionCommands";
import { collectReservedCommandNames, needsTemplateRefetch } from "../utils/reservedCommandNames";
import { assembleTemplates, mergeRuntimeTemplates } from "../utils/templateCatalog";
import { buildDraftResourceCommands, draftResourceCommandsForProject, selectComposerSuggestionCommands, standbyPreviewCommandsForProject, type DraftResourceCommandSnapshot, type StandbyPreviewCommandSnapshot } from "../utils/draftResourceCommands";
import { isSessionRuntimeBusy, isUserFacingSessionStart } from "./useSessionTimelineController";
import { truncateQuoteLabel } from "../components/session/composer/quoteChip";
import { useSessionSend, type EnqueuePromptSnapshot } from "./useSessionSend";

const PASTE_FILE_CONTENT_MAX_BYTES = 2 * 1024 * 1024;
import { useVoiceTranscription } from "./useVoiceTranscription";
import { usePromptEnhance, type PromptEnhanceRequest } from "./usePromptEnhance";
import { usePromptSuggestion } from "./usePromptSuggestion";
import { isSessionTurnRunning } from "../utils/sessionActivityClock";
import { resolveVoiceTranscriptionInsertion, type VoiceTranscriptionTarget } from "../utils/voiceTranscriptionInsert";

function compactNotice(kind: CompactNoticeKind, detail?: string): string | null {
	switch (kind) {
		case "done":
			return t("app.compactDone");
		case "nothingToDo":
			return t("app.compactNothingToDo");
		case "tooSmall":
			return t("app.compactSessionTooSmall");
		case "inProgress":
			return t("app.compactInProgress");
		case "routedToOwner": {
			const command = compactRoutedCommand(detail ?? "");
			return command ? t("app.compactRoutedToOwner", { command }) : t("app.compactDone");
		}
		case "cancelledByOwner": {
			const reason = compactOwnerReason(detail ?? "");
			return reason ? t("app.compactCancelledByOwnerWithReason", { reason }) : t("app.compactCancelledByOwner");
		}
		case "interrupted":
			return t("app.compactInterrupted");
		case "timeout":
			return t("app.compactWaitTimeout");
		case "cancelled":
			return t("app.compactCancelled");
		case "failed":
			return detail ? t("app.compactFailedWithReason", { error: detail }) : t("app.compactFailed");
	}
}

function friendlyCompactError(error: unknown): { text: string; durationMs: number } | null {
	const debugDetails = error && typeof error === "object" && "debugDetails" in error ? String((error as { debugDetails?: unknown }).debugDetails ?? "").trim() : "";
	const rawMessage = error instanceof Error ? error.message.trim() : String(error ?? "").trim();
	const raw = debugDetails || rawMessage;
	const detail = raw.trim();
	const kind = classifyCompactError(detail);
	const text = compactNotice(kind, detail);
	if (!text) return null;

	const durationMs = kind === "done" ? 4000 : kind === "cancelledByOwner" || kind === "routedToOwner" || kind === "timeout" ? 10000 : 7000;
	return { text, durationMs };
}

export type ComposerPickerKind = "model" | "thinking" | "template" | "skill";

export type UseSessionComposerControllerOptions = {
	sessionId: string;

	bootstrapProjectId?: string;
	ensureSessionId?: (sessionId: string) => Promise<string>;

	onPromoteSession?: (sessionId: string) => void;

	onCreateSession?: () => Promise<void>;

	onProviderLogin?: (providerId?: string) => void;

	onReloadResources?: (target: SessionRuntimeTarget) => Promise<void>;

	enqueue?: (sessionId: string, snapshot: EnqueuePromptSnapshot) => boolean;

	suppressQueuedDrain?: (sessionId: string) => void;
};

export type ComposerDraftGuard = {
	sessionId: string;
	agentId?: string;
	runtimeGeneration: number;
	baselineDraft: string;
	version: number;
	pristine: boolean;
};

export function createComposerDraftGuard(input: { sessionId: string; agentId?: string; runtimeGeneration?: number; draft: string }): ComposerDraftGuard {
	return {
		sessionId: input.sessionId,
		agentId: input.agentId,
		runtimeGeneration: input.runtimeGeneration ?? 0,
		baselineDraft: input.draft,
		version: 0,
		pristine: input.draft.length === 0,
	};
}

export function markComposerDraftMutation(guard: ComposerDraftGuard): ComposerDraftGuard {
	return { ...guard, version: guard.version + 1, pristine: false };
}

export function canApplyRuntimeEditorText(
	guard: ComposerDraftGuard,
	input: {
		sessionId: string;
		agentId: string;
		runtimeGeneration: number;
		currentDraft: string;
	},
): boolean {
	return guard.sessionId === input.sessionId && guard.agentId === input.agentId && guard.runtimeGeneration === input.runtimeGeneration && guard.pristine && guard.baselineDraft === input.currentDraft;
}

export type LatestRequestToken = { key: string; sequence: number };

export function createLatestRequestGate() {
	let current = { key: "", sequence: 0 };
	return {
		begin(key: string): LatestRequestToken {
			current = { key, sequence: current.sequence + 1 };
			return current;
		},
		invalidate(key: string) {
			current = { key, sequence: current.sequence + 1 };
		},
		isCurrent(token: LatestRequestToken) {
			return token.key === current.key && token.sequence === current.sequence;
		},
	};
}

type SessionReferenceMessage = {
	role: string;
	content: string;
	timestamp: number;
};

const PROMPT_HISTORY_SESSION_LRU_LIMIT = 50;
const promptHistorySessionOrder = new Map<string, true>();
function markPromptHistorySessionAccess(history: Record<string, string[]>, sessionId: string) {
	promptHistorySessionOrder.delete(sessionId);
	promptHistorySessionOrder.set(sessionId, true);
	if (promptHistorySessionOrder.size <= PROMPT_HISTORY_SESSION_LRU_LIMIT) return;
	const oldest = promptHistorySessionOrder.keys().next().value;
	if (oldest !== undefined && oldest !== sessionId) {
		promptHistorySessionOrder.delete(oldest);

		delete history[oldest];
	}
}

export type SessionReferenceSelection = {
	selectedIndices: number[];
	entries: Array<{ index: number; message: SessionReferenceMessage }>;
};

export function createSessionReferenceSelection(selectedIndices: number[], selectedMessages: SessionReferenceMessage[]): SessionReferenceSelection {
	const entries = selectedIndices.map((index, position) => ({ index, message: selectedMessages[position] })).filter((entry): entry is { index: number; message: SessionReferenceMessage } => Boolean(entry.message));
	return { selectedIndices: entries.map((entry) => entry.index), entries };
}

export function selectedSessionReferenceMessages(selection: SessionReferenceSelection): SessionReferenceMessage[] {
	return [...selection.entries].sort((left, right) => left.index - right.index).map((entry) => entry.message);
}

function getBangMode(text: string): "none" | "bang" | "bang-bang" {
	if (text.startsWith("!!")) return "bang-bang";
	if (text.startsWith("!")) return "bang";
	return "none";
}

function composerImageNotice(error: unknown): string {
	if (error instanceof ComposerImageError) {
		if (error.code === "too-large") return t("app.imageTooLarge");
		if (error.code === "unsupported") return t("app.imageUnsupported");
	}
	return error instanceof Error ? error.message : String(error);
}

export function useSessionComposerController(options: UseSessionComposerControllerOptions) {
	const { sessionId, enqueue, ensureSessionId, suppressQueuedDrain, bootstrapProjectId } = options;
	const store = useStore();
	const record = useAtomValue(sessionRecordByIdAtomFamily(sessionId));
	const enhanceModelConfig = useAtomValue(enhanceModelAtom);
	const enhanceIncludeContext = useAtomValue(enhanceIncludeContextAtom);

	const effectiveProjectId = record?.projectId ?? options.bootstrapProjectId;

	const composerProject = useAtomValue(projectByIdAtomFamily(effectiveProjectId ?? ""));
	const runtime = useAtomValue(sessionRuntimeBySessionIdAtomFamily(sessionId));
	const runtimeUi = useAtomValue(sessionRuntimeUiBySessionIdAtomFamily(sessionId));
	const projectSessions = useAtomValue(sessionSummariesByProjectIdAtomFamily(effectiveProjectId ?? ""));

	const draftAtom = useMemo(() => sessionDraftBySessionIdAtomFamily(sessionId), [sessionId]);
	const attachmentsAtom = useMemo(() => sessionAttachmentsBySessionIdAtomFamily(sessionId), [sessionId]);
	const pasteFilesAtom = useMemo(() => sessionPasteFilesBySessionIdAtomFamily(sessionId), [sessionId]);
	const modeAtom = useMemo(() => sessionComposerModeBySessionIdAtomFamily(sessionId), [sessionId]);
	const sendStateAtom = useMemo(() => sessionSendStateBySessionIdAtomFamily(sessionId), [sessionId]);
	const messageCacheAtom = useMemo(() => sessionMessageCacheBySessionIdAtomFamily(sessionId), [sessionId]);
	const quotesAtom = useMemo(() => sessionQuotesBySessionIdAtomFamily(sessionId), [sessionId]);
	const draft = useAtomValue(draftAtom);
	const attachments = useAtomValue(attachmentsAtom);
	const pasteFiles = useAtomValue(pasteFilesAtom);
	const localMode = useAtomValue(modeAtom);
	const sendState = useAtomValue(sendStateAtom);
	const messageCache = useAtomValue(messageCacheAtom);
	const imageGenConfig = useAtomValue(imageGenConfigAtom);
	const setImageGenConfig = useSetAtom(imageGenConfigAtom);

	const videoGenConfig = useAtomValue(videoGenConfigAtom);
	const setVideoGenConfig = useSetAtom(videoGenConfigAtom);
	const setDraftAtom = useSetAtom(setSessionDraftAtom);
	const setAttachmentsAtom = useSetAtom(setSessionAttachmentsAtom);
	const setPasteFilesAtom = useSetAtom(setSessionPasteFilesAtom);
	const setModeAtom = useSetAtom(setSessionComposerModeAtom);
	const setSendStateAtom = useSetAtom(setSessionSendStateAtom);
	const setCacheMessages = useSetAtom(cacheSessionMessagesAtom);

	const isGuideBootstrapSession = sessionId === GUIDE_BOOTSTRAP_SESSION_ID;
	const [guideBackendOverride, setGuideBackendOverride] = useState<AgentBackend | undefined>(() => (isGuideBootstrapSession ? readWelcomeBackendPreference() : undefined));

	const [guideAcpToolOverride, setGuideAcpToolOverride] = useState<string | undefined>(() => (isGuideBootstrapSession ? readWelcomeAcpToolPreference() : undefined));

	const isAcpBackend = record?.backend === "acp" || runtime?.backend === "acp" || record?.backend === "qoder" || runtime?.backend === "qoder" || (isGuideBootstrapSession && (guideBackendOverride === "acp" || guideBackendOverride === "qoder"));
	const hasImageGenHistory = (messageCache?.messages ?? []).some((message) => Boolean(message.meta?.imageGen));

	const isVideoGenBackend = record?.backend === "videogen";

	const activeImageGenProviderId = imageGenConfig.activeProviderId;
	const activeImageGenModelId = imageGenConfig.activeModel;
	const mode: ComposerAgentMode =
		record?.backend === "imagegen" || hasImageGenHistory
			? "imagegen"
			: isVideoGenBackend
				? "videogen"
				: deriveComposerAgentMode({
						backend: isAcpBackend ? "acp" : "pi",
						localMode: localMode,
					});

	const defaultAgentBackend = "pi" as const;
	const guidePageBackend: AgentBackend = isGuideBootstrapSession ? resolveGuidePageBackend({ override: guideBackendOverride, acpToolId: guideAcpToolOverride, effectiveDefault: defaultAgentBackend }) : defaultAgentBackend;

	const guideAcpPrewarmRef = useRef(false);

	const acpToolsForPrewarm = useAtomValue(acpToolsAtom);
	useEffect(() => {
		if (!isGuideBootstrapSession || guidePageBackend !== "acp" || guideAcpPrewarmRef.current || !ensureSessionId) return;
		if (readLastSessionPreference()) return;
		const preferred = guideAcpToolOverride ? acpToolsForPrewarm.find((tool) => tool.id === guideAcpToolOverride) : undefined;
		const toolId = preferred?.id ?? acpToolsForPrewarm.find((tool) => tool.enabled)?.id;
		if (!toolId) return;

		const timer = window.setTimeout(() => {
			if (guideAcpPrewarmRef.current) return;
			guideAcpPrewarmRef.current = true;
			void ensureSessionId(GUIDE_BOOTSTRAP_SESSION_ID).catch(() => {
				guideAcpPrewarmRef.current = false;
			});
		}, 300);
		return () => window.clearTimeout(timer);
	}, [acpToolsForPrewarm, ensureSessionId, guideAcpToolOverride, guidePageBackend, isGuideBootstrapSession, store]);
	const [bootstrapDefaults, setBootstrapDefaults] = useState<ResolvedLaunchDefaults | undefined>(undefined);
	useEffect(() => {
		if (record) return;
		let cancelled = false;
		void desktopApi.sessions
			.resolveLaunchDefaults({ backend: guidePageBackend })
			.then((next) => {
				if (!cancelled) setBootstrapDefaults(next);
			})
			.catch(() => {
				if (!cancelled) setBootstrapDefaults(undefined);
			});
		return () => {
			cancelled = true;
		};
	}, [guidePageBackend, record]);
	const editorRef = useRef<HTMLDivElement | null>(null);

	const caretRef = useRef<ComposerCaretRequest | null>(null);
	const liveDomDraftRef = useRef({ sessionId, value: draft });
	const draftGuardRef = useRef(
		createComposerDraftGuard({
			sessionId,
			agentId: runtime?.agentId,
			runtimeGeneration: runtime?.runtimeGeneration,
			draft,
		}),
	);
	const templateRequestGateRef = useRef(createLatestRequestGate());
	const promptHistoryRef = useRef<Record<string, string[]>>({});

	const getPromptHistory = useCallback(() => {
		markPromptHistorySessionAccess(promptHistoryRef.current, sessionId);
		const runtimeHistory = promptHistoryRef.current[sessionId] ?? [];
		const sessionHistory = extractUserPrompts(store.get(sessionMessagesCacheAtom)[sessionId]?.messages ?? []);
		return mergePromptHistory(runtimeHistory, sessionHistory);
	}, [sessionId, store]);
	const lastEditorTextEnvelopeRef = useRef("");
	const [cursor, setCursor] = useState(0);
	const [suggestionsOpen, setSuggestionsOpen] = useState(false);
	const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
	const [historyIndex, setHistoryIndex] = useState(-1);
	const [savedDraft, setSavedDraft] = useState("");
	const [busyDraftLocked, setBusyDraftLocked] = useState(false);
	const [previewImage, setPreviewImage] = useState<ImageContent | null>(null);

	const [generatingImage, setGeneratingImage] = useState(false);

	const [submittingVideo, setSubmittingVideo] = useState(false);

	const [videoConfirmPending, setVideoConfirmPending] = useState(false);

	const [imageGenSize, setImageGenSizeState] = useState<string>(DEFAULT_IMAGE_GEN_SIZE);
	const [imageGenWatermark, setImageGenWatermarkState] = useState(DEFAULT_IMAGE_GEN_WATERMARK);
	const [imageGenOutputFormat, setImageGenOutputFormatState] = useState(DEFAULT_IMAGE_GEN_OUTPUT_FORMAT);
	const [picker, setPicker] = useState<ComposerPickerKind | null>(null);
	const [commands, setCommands] = useState<PiCommand[]>([]);

	const commandsRefreshTick = useAtomValue(sessionCommandsRefreshTickAtom);
	const [draftResourceCommandSnapshot, setDraftResourceCommandSnapshot] = useState<DraftResourceCommandSnapshot>({ projectId: undefined, commands: [] });
	const [standbyPreviewCommandSnapshot, setStandbyPreviewCommandSnapshot] = useState<StandbyPreviewCommandSnapshot>({ projectId: undefined, commands: [] });
	const [files, setFiles] = useState<FileTreeNode[]>([]);

	const loadedDirPathsRef = useRef<Set<string>>(new Set());
	const loadingDirPathsRef = useRef<Set<string>>(new Set());

	const deepTreeStateRef = useRef<{ projectId: string; loaded: boolean; loading: boolean }>({
		projectId: "",
		loaded: false,
		loading: false,
	});

	const runtimeTargetKey = runtime?.agentId && runtime.runtimeGeneration !== undefined ? `${runtime.agentId}:${runtime.runtimeGeneration}` : "";
	const templateKey = `${sessionId}:${record?.projectPath ?? ""}`;
	const [templateState, setTemplateState] = useState<{
		key: string;
		items: PromptTemplateInfo[];
	}>({ key: templateKey, items: [] });
	const templates = templateState.key === templateKey ? templateState.items : [];

	const templatesRef = useRef<PromptTemplateInfo[]>(templates);

	const templateWriteSeqRef = useRef(0);
	const templateWrittenSeqRef = useRef(0);
	const [sendShortcut, setSendShortcut] = useState<"enter-send" | "ctrl-enter-send" | "shift-enter-send">("enter-send");
	const [sessionReference, setSessionReference] = useState<SessionSummary | null>(null);
	const [sessionReferenceSelections, setSessionReferenceSelections] = useState<Record<string, SessionReferenceSelection>>({});

	const markDraftMutation = useCallback(
		(targetSessionId = sessionId) => {
			if (targetSessionId !== sessionId) return;
			draftGuardRef.current = markComposerDraftMutation(draftGuardRef.current);
		},
		[sessionId],
	);

	const setDraft = useCallback(
		(value: string | ((current: string) => string)) => {
			markDraftMutation();
			setDraftAtom({ sessionId, value });
		},
		[markDraftMutation, sessionId, setDraftAtom],
	);

	const setAttachments = useCallback(
		(value: ImageContent[] | ((current: ImageContent[]) => ImageContent[])) => {
			setAttachmentsAtom({ sessionId, value });
		},
		[sessionId, setAttachmentsAtom],
	);

	const setPasteFiles = useCallback(
		(value: PastedTextFile[] | ((current: PastedTextFile[]) => PastedTextFile[])) => {
			setPasteFilesAtom({ sessionId, value });
		},
		[sessionId, setPasteFilesAtom],
	);

	const setMode = useCallback(
		(nextMode: ComposerAgentMode) => {
			if ((hasImageGenHistory || record?.backend === "imagegen") && nextMode !== "imagegen") return;

			if (record?.backend === "videogen" && nextMode !== "videogen") return;

			if (nextMode === "normal" && mode === "goal") {
				setModeAtom({ sessionId, mode: "normal" });
				void desktopApi.sessions
					.sendPrompt({
						sessionId,
						requestId: crypto.randomUUID(),
						message: "/goal pause",
					})
					.catch((error) => {
						showNotice(error instanceof Error ? error.message : String(error), 4000);
					});
				return;
			}
			setModeAtom({ sessionId, mode: nextMode });
		},
		[hasImageGenHistory, mode, runtime?.agentId, sessionId, setModeAtom],
	);

	const loadTemplates = useCallback(async () => {
		const token = templateRequestGateRef.current.begin(templateKey);

		const sequence = ++templateWriteSeqRef.current;
		let globalTemplates: PromptTemplateInfo[] = [];
		let projectTemplates: PromptTemplateInfo[] = [];
		try {
			const globalResult = await desktopApi.prompts.list();
			globalTemplates = globalResult.templates.map((template) => ({
				...template,
				description: translateBuiltinPromptDescription(template),
				argumentHint: parseArgumentHint(template.content),
			}));
		} catch {}
		if (record?.projectId) {
			try {
				const projectResult = await desktopApi.prompts.listByProject(record.projectId);
				projectTemplates = projectResult.templates.map((template) => ({
					...template,
					argumentHint: parseArgumentHint(template.content),
				}));
			} catch {}
		}

		let next: PromptTemplateInfo[] = assembleTemplates({ project: projectTemplates, global: globalTemplates });

		const target = toSessionRuntimeTarget(sessionId, store.get(sessionRuntimeBySessionIdAtomFamily(sessionId)));
		if (target) {
			try {
				const result = await desktopApi.sessions.listRuntimePromptTemplates(target);
				if (result.ok) next = mergeRuntimeTemplates(next, result.value.value);
			} catch {}
		} else if (record?.projectId) {
			try {
				const templates = await desktopApi.sessions.draftPromptTemplates(record.projectId);
				if (templates?.length) next = mergeRuntimeTemplates(next, templates);
			} catch {}
		}

		if (sequence >= templateWrittenSeqRef.current) {
			templateWrittenSeqRef.current = sequence;
			templatesRef.current = next;
		}
		if (templateRequestGateRef.current.isCurrent(token)) {
			setTemplateState({ key: templateKey, items: next });
		}
		return next;
	}, [record?.projectId, sessionId, store, templateKey, runtimeTargetKey]);

	useEffect(() => {
		liveDomDraftRef.current = { sessionId, value: draft };
		setCursor(draft.length);
		setSuggestionsOpen(false);
		setSelectedSuggestionIndex(0);
		setHistoryIndex(-1);
		setSavedDraft("");
		setBusyDraftLocked(false);

		draftGuardRef.current = createComposerDraftGuard({
			sessionId,
			agentId: runtime?.agentId,
			runtimeGeneration: runtime?.runtimeGeneration,
			draft,
		});
		lastEditorTextEnvelopeRef.current = "";
	}, [sessionId]);

	useEffect(() => {
		const currentDraft = store.get(sessionDraftByIdAtom)[sessionId] ?? "";
		draftGuardRef.current = createComposerDraftGuard({
			sessionId,
			agentId: runtime?.agentId,
			runtimeGeneration: runtime?.runtimeGeneration,
			draft: currentDraft,
		});
		lastEditorTextEnvelopeRef.current = "";
	}, [runtime?.agentId, runtime?.runtimeGeneration, sessionId, store]);

	useEffect(() => {
		if (liveDomDraftRef.current.sessionId === sessionId && liveDomDraftRef.current.value !== draft) {
			liveDomDraftRef.current = { sessionId, value: draft };
		}
	}, [draft, sessionId]);

	useEffect(() => {
		const editorText = runtimeUi?.editorText;
		if (!runtime?.agentId || !editorText || runtimeUi.agentId !== runtime.agentId || runtimeUi.runtimeGeneration !== runtime.runtimeGeneration) {
			return;
		}
		const envelope = `${sessionId}:${runtime.runtimeGeneration}:${editorText.revision}`;
		if (lastEditorTextEnvelopeRef.current === envelope) return;
		lastEditorTextEnvelopeRef.current = envelope;
		const currentDraft = store.get(sessionDraftByIdAtom)[sessionId] ?? "";
		if (
			!canApplyRuntimeEditorText(draftGuardRef.current, {
				sessionId,
				agentId: runtime.agentId,
				runtimeGeneration: runtime.runtimeGeneration,
				currentDraft,
			})
		) {
			return;
		}
		liveDomDraftRef.current = { sessionId, value: editorText.text };
		setDraft(editorText.text);
		setCursor(editorText.text.length);
		caretRef.current = { pos: editorText.text.length, forValue: editorText.text };
	}, [runtime, runtimeUi, sessionId, setDraft, store]);

	useEffect(() => {
		void desktopApi.settings
			.get()
			.then((settings) => {
				setSendShortcut(settings.sendShortcut);
				setImageGenSizeState(parseImageGenSize(settings.imageGenSize) ?? DEFAULT_IMAGE_GEN_SIZE);
				setImageGenWatermarkState(parseImageGenWatermark(settings.imageGenWatermark));
				setImageGenOutputFormatState(parseImageGenOutputFormat(settings.imageGenOutputFormat) ?? DEFAULT_IMAGE_GEN_OUTPUT_FORMAT);
			})
			.catch(() => undefined);
	}, []);

	useEffect(() => {
		setCursor(0);
		setSuggestionsOpen(false);
		setSelectedSuggestionIndex(0);
		setHistoryIndex(-1);
		setSavedDraft("");
		setBusyDraftLocked(false);
		setPreviewImage(null);
		setGeneratingImage(false);
		setPicker(null);
		setSessionReference(null);
		setSessionReferenceSelections({});
	}, [sessionId]);

	useEffect(() => {
		if (!effectiveProjectId) {
			setFiles([]);
			return;
		}
		let current = true;

		void desktopApi.files
			.list(effectiveProjectId, { maxDepth: 0, skipGeneratedDirs: true })
			.then((next) => {
				if (current) setFiles(next);
			})
			.catch(() => {
				if (current) setFiles([]);
			});
		return () => {
			current = false;
		};
	}, [effectiveProjectId]);

	useEffect(() => {
		loadedDirPathsRef.current = new Set();
		loadingDirPathsRef.current = new Set();
	}, [effectiveProjectId]);

	useEffect(() => {
		const target = toSessionRuntimeTarget(sessionId, runtime);
		if (!target) {
			setCommands([]);
			return;
		}
		let current = true;
		void desktopApi.sessions
			.listRuntimeCommands(target)
			.then((result) => {
				if (current) setCommands(requireSessionCommand(result).value);
			})
			.catch(() => {
				if (current) setCommands([]);
			});
		return () => {
			current = false;
		};
	}, [runtime?.agentId, runtime?.runtimeGeneration, sessionId, commandsRefreshTick]);

	useEffect(() => {
		if (isAcpBackend || runtime?.agentId) {
			setDraftResourceCommandSnapshot({ projectId: effectiveProjectId, commands: [] });
			return;
		}
		let current = true;
		setDraftResourceCommandSnapshot({ projectId: effectiveProjectId, commands: [] });
		const globalSkills = desktopApi.skills
			.list()
			.then((result) => result.skills)
			.catch(() => []);
		const projectSkills = effectiveProjectId ? desktopApi.projectResources.list(effectiveProjectId).catch(() => undefined) : Promise.resolve(undefined);
		const discovered = desktopApi.projectResources.discovery(effectiveProjectId ?? undefined).catch(() => ({ projectResourcesAllowed: false, overrides: { disabledGlobalExtensions: [], disabledGlobalSkills: [], disabledGlobalPrompts: [] }, skills: [], prompts: [], extensions: [] }));
		void Promise.all([globalSkills, projectSkills, discovered]).then(([global, project, resources]) => {
			if (!current) return;
			const skills = [...(project?.skills ?? []), ...global, ...resources.skills];
			const prompts = [...templates, ...resources.prompts];
			setDraftResourceCommandSnapshot({
				projectId: effectiveProjectId,
				commands: buildDraftResourceCommands(skills, prompts, {
					projectResourcesAllowed: resources.projectResourcesAllowed,
					disabledGlobalSkillKeys: resources.overrides.disabledGlobalSkills,
					disabledGlobalPromptNames: resources.overrides.disabledGlobalPrompts,
				}),
			});
		});
		return () => {
			current = false;
		};
	}, [effectiveProjectId, isAcpBackend, runtime?.agentId, templates]);

	useEffect(() => {
		if (isAcpBackend || runtime?.agentId || !effectiveProjectId) {
			setStandbyPreviewCommandSnapshot({ projectId: effectiveProjectId, commands: [] });
			return;
		}
		let current = true;
		setStandbyPreviewCommandSnapshot({ projectId: effectiveProjectId, commands: [] });
		void desktopApi.sessions
			.draftCommands(effectiveProjectId)
			.then((preview) => {
				if (current && preview) setStandbyPreviewCommandSnapshot({ projectId: effectiveProjectId, commands: preview });
			})
			.catch(() => undefined);
		return () => {
			current = false;
		};
	}, [effectiveProjectId, isAcpBackend, runtime?.agentId]);

	useEffect(() => {
		templateRequestGateRef.current.invalidate(templateKey);
		templatesRef.current = [];
		templateWrittenSeqRef.current = ++templateWriteSeqRef.current;
		setTemplateState({ key: templateKey, items: [] });
		void loadTemplates();
	}, [loadTemplates, templateKey]);

	const flatFiles = useMemo(() => flattenFiles(files), [files]);
	const mergedCommands = useMemo(() => mergeCommands(commands), [commands]);

	const reservedCommandNames = useMemo(() => collectReservedCommandNames(commands), [commands]);
	const reservedCommandNamesRef = useRef<ReadonlySet<string>>(reservedCommandNames);
	reservedCommandNamesRef.current = reservedCommandNames;
	const validCommandNames = useMemo(() => new Set([...mergedCommands.map((command) => command.name), ...templates.map((template) => template.name)]), [mergedCommands, templates]);
	const validFilePaths = useMemo(() => new Set(flatFiles.map((file) => file.relativePath)), [flatFiles]);
	const validSessionRefs = useMemo(() => new Set(projectSessions.map((session) => session.name ?? session.filePath)), [projectSessions]);

	const sessionQuotes = useAtomValue(quotesAtom);
	const validQuotes = useMemo(() => {
		if (!sessionQuotes) return undefined;
		const entries = Object.entries(sessionQuotes);
		if (entries.length === 0) return undefined;
		return new Map(entries.map(([id, snippet]) => [id, truncateQuoteLabel(snippet.text)]));
	}, [sessionQuotes]);
	const draftResourceCommands = draftResourceCommandsForProject(draftResourceCommandSnapshot, effectiveProjectId);
	const standbyPreviewCommands = standbyPreviewCommandsForProject(standbyPreviewCommandSnapshot, effectiveProjectId);
	const suggestionCommands = selectComposerSuggestionCommands(Boolean(runtime?.agentId), commands, draftResourceCommands, standbyPreviewCommands);
	const suggestionItems = useMemo(() => (suggestionsOpen ? buildSuggestionItems(draft, cursor, suggestionCommands, flatFiles, projectSessions) : []), [cursor, draft, flatFiles, projectSessions, suggestionCommands, suggestionsOpen]);

	useEffect(() => {
		if (!effectiveProjectId) return;
		const trigger = detectTrigger(draft, cursor, validSessionRefs);
		if (!trigger || trigger.char !== "@") return;
		const dirNode = resolveAtDrillDirectory(trigger.query, files);
		if (!dirNode) return;

		if (Array.isArray(dirNode.children) || loadingDirPathsRef.current.has(dirNode.path)) {
			return;
		}
		let current = true;
		loadingDirPathsRef.current.add(dirNode.path);
		void desktopApi.files
			.list(effectiveProjectId, { maxDepth: 0, directory: dirNode.path, skipGeneratedDirs: true })
			.then((children) => {
				if (!current) return;
				setFiles((prev) => mergeFileTreeChildren(prev, dirNode.path, children));
				loadedDirPathsRef.current.add(dirNode.path);
			})
			.catch(() => {})
			.finally(() => {
				loadingDirPathsRef.current.delete(dirNode.path);
			});
		return () => {
			current = false;
		};
	}, [cursor, draft, effectiveProjectId, files, validSessionRefs]);

	useEffect(() => {
		if (!effectiveProjectId) return;

		const state = deepTreeStateRef.current;
		if (state.projectId !== effectiveProjectId) {
			deepTreeStateRef.current = { projectId: effectiveProjectId, loaded: false, loading: false };
		}
		if (deepTreeStateRef.current.loaded || deepTreeStateRef.current.loading) return;
		const trigger = detectTrigger(draft, cursor, validSessionRefs);
		if (!trigger || trigger.char !== "@" || !shouldLoadFullTreeForAtSearch(trigger.query)) {
			return;
		}

		deepTreeStateRef.current.loading = true;
		void desktopApi.files
			.list(effectiveProjectId, { maxDepth: FILE_TREE_ABSOLUTE_MAX_DEPTH, skipGeneratedDirs: true })
			.then((next) => {
				if (deepTreeStateRef.current.projectId !== effectiveProjectId) return;

				setFiles(next);
			})
			.catch(() => {})
			.finally(() => {
				if (deepTreeStateRef.current.projectId === effectiveProjectId) {
					deepTreeStateRef.current.loading = false;
					deepTreeStateRef.current.loaded = true;
				}
			});
	}, [cursor, draft, effectiveProjectId, validSessionRefs]);
	const suggestionAnchorStyle = useMemo<CSSProperties | undefined>(() => {
		if (!suggestionsOpen) return undefined;
		const menuWidth = Math.min(520, window.innerWidth - 120);
		const menuHeight = 380;
		const gap = 8;

		const fallback: CSSProperties = {
			top: "auto",
			bottom: 160,
			left: Math.max(16, (window.innerWidth - menuWidth) / 2),
		};
		const root = editorRef.current;
		if (!root) return fallback;
		const coordinates = getComposerCaretCoords(root, cursor);
		if (!coordinates) return fallback;
		let left = coordinates.left;
		if (left + menuWidth > window.innerWidth - 16) {
			left = Math.max(16, window.innerWidth - menuWidth - 16);
		}
		const below = coordinates.top + gap;
		if (below + menuHeight <= window.innerHeight - 16) {
			return { top: below, left, bottom: "auto" };
		}
		const above = coordinates.top - gap;
		if (above - menuHeight >= 0) {
			return {
				top: "auto",
				bottom: window.innerHeight - above,
				left,
			};
		}
		return { top: "auto", bottom: 16, left };
	}, [cursor, suggestionsOpen]);

	const isBusy = isSessionRuntimeBusy(runtime?.status, runtime?.state);

	const isStarting = isUserFacingSessionStart(sendState.status);
	const hasContent = Boolean(draft.trim() || attachments.length || pasteFiles.length);

	const resetEphemeralUi = useCallback(() => {
		setHistoryIndex(-1);
		setSavedDraft("");
		setSuggestionsOpen(false);
		setBusyDraftLocked(false);
		liveDomDraftRef.current = { sessionId, value: "" };
	}, [sessionId]);

	const ensureTemplatesForMessage = useCallback(
		async (message: string) => {
			const match = /^\/([^\s]+)/.exec(message.trim());
			if (!match) return;
			const name = match[1];

			if (!needsTemplateRefetch(name, templatesRef.current, reservedCommandNamesRef.current)) return;

			const hasRuntime = Boolean(toSessionRuntimeTarget(sessionId, store.get(sessionRuntimeBySessionIdAtomFamily(sessionId))));
			if (!hasRuntime && !record?.projectId) return;

			await loadTemplates().catch(() => undefined);
		},
		[loadTemplates, record?.projectId, sessionId, store],
	);

	const resolveSessionReferences = useCallback(
		async (message: string) => {
			const targets = projectSessions.map((session) => ({ id: session.id, name: session.name ?? session.filePath }));
			return await expandSessionReferences(message, targets, async (session) => {
				const saved = sessionReferenceSelections[`&${session.name}`];
				const selectedMessages = saved ? selectedSessionReferenceMessages(saved) : await desktopApi.sessions.readReferenceMessages(session.id);
				return selectedMessages.map((item) => `[${item.role === "user" ? "User" : "Assistant"}]: ${item.content}`).join("\n");
			});
		},
		[projectSessions, sessionReferenceSelections],
	);

	const runManualCompact = useCallback(
		async (target: { sessionId: string; agentId: string; runtimeGeneration: number }, prompt?: string) => {
			const live = store.get(sessionRuntimeBySessionIdAtomFamily(sessionId));
			const compacting = live?.state?.isCompacting === true;
			if (compacting) {
				showNotice(t("app.compactInProgress"), 4000);
				return;
			}
			try {
				requireSessionCommand(await desktopApi.sessions.compactRuntime(target, prompt));
				showNotice(t("app.compactDone"), 4000);
			} catch (error) {
				const notice = friendlyCompactError(error);
				if (notice) showNotice(notice.text, notice.durationMs);
			}
		},
		[sessionId, store],
	);

	const send = useSessionSend({
		sessionId,
		sendPrompt: (input) => desktopApi.sessions.sendPrompt(input),
		ensureSessionId,
		getTemplates: () => templatesRef.current,
		getReservedCommandNames: () => reservedCommandNamesRef.current,
		ensureTemplates: ensureTemplatesForMessage,
		prepareMessage: async (message) => {
			await ensureTemplatesForMessage(message);
			const resolved = await resolveSessionReferences(message);
			return resolved;
		},
		onDraftMutation: markDraftMutation,
		createNewSession: options.onCreateSession,
		openProviderLogin: options.onProviderLogin,
		reloadResources: options.onReloadResources,
		compact: async (target, prompt) => {
			await runManualCompact(target, prompt);
		},
		resetComposerUi: resetEphemeralUi,
		recordPromptHistory: (targetSessionId, message) => {
			if (!message.trim() || message.startsWith("!")) return;
			const normalized = message.trim();
			const previous = promptHistoryRef.current[targetSessionId] ?? [];
			promptHistoryRef.current[targetSessionId] = [normalized, ...previous.filter((item) => item !== normalized)].slice(0, 50);
			markPromptHistorySessionAccess(promptHistoryRef.current, targetSessionId);
		},
		showError: (message, duration) => showNotice(message, duration),
		showUnknown: () => showNotice(t("app.queuedUnknown"), 6000),

		pruneFailedAcpDraft: async (failedSessionId) => {
			const failed = store.get(sessionRecordsAtom)[failedSessionId];
			if (!failed || (failed.backend !== "acp" && failed.backend !== "qoder") || failed.status !== "draft") return false;

			store.set(promoteSessionComposerStateAtom, { fromSessionId: failedSessionId, toSessionId: GUIDE_BOOTSTRAP_SESSION_ID });
			await desktopApi.sessions.deleteRecord(failedSessionId).catch(() => undefined);

			if (store.get(currentSessionIdAtom) === failedSessionId) {
				store.set(currentSessionIdAtom, undefined);
			}
			store.set(removeSessionStateAtom, failedSessionId);
			return true;
		},
		enqueue,
	});

	const askPanel = useAskPanel();

	const persistImageGenSelection = useCallback(
		(providerId: string, modelId: string) => {
			const next = {
				...imageGenConfig,
				activeProviderId: providerId,
				activeModel: modelId,
			};
			setImageGenConfig(next);
			void desktopApi.imagegen.saveConfig(next).catch(() => undefined);
		},
		[imageGenConfig, setImageGenConfig],
	);

	const generateImage = useCallback(async () => {
		const prompt = draft.trim();
		if (!prompt || generatingImage) return;
		const provider = findImageGenProvider(imageGenConfig, activeImageGenProviderId);
		const modelId = provider?.models.includes(activeImageGenModelId) ? activeImageGenModelId : "";
		if (!provider?.id || !modelId || !provider.baseUrl.trim() || !provider.apiKey.trim()) {
			showNotice(t("imagegen.error.notConfigured"), 5000);
			return;
		}

		if (attachments.length > 0 && (provider.referenceMode ?? "none") === "none") {
			showNotice(t("imagegen.error.referenceUnsupported"), 5000);
			return;
		}

		if (record?.noSession === true) {
			showNotice(t("imagegen.transientHint"), 6000);
		}
		setGeneratingImage(true);

		const appendTimelineMessage = (message: ChatMessage) => {
			const previous = store.get(sessionMessagesCacheAtom)?.[sessionId]?.messages ?? [];
			setCacheMessages({ sessionId, messages: [...previous, message], source: "runtime" });
		};

		const updateTimelineMessage = (id: string, patch: (m: ChatMessage) => ChatMessage) => {
			const previous = store.get(sessionMessagesCacheAtom)?.[sessionId]?.messages ?? [];
			setCacheMessages({
				sessionId,
				messages: previous.map((m) => (m.id === id ? patch(m) : m)),
				source: "runtime",
			});
		};

		appendTimelineMessage({
			id: crypto.randomUUID(),
			agentId: "",
			role: "user",
			text: prompt,
			timestamp: Date.now(),

			images: attachments.length > 0 ? attachments : undefined,
		});
		const imageMessageId = crypto.randomUUID();
		appendTimelineMessage({
			id: imageMessageId,
			agentId: "",
			role: "assistant",
			text: "",
			stopReason: "stop",
			timestamp: Date.now(),
			meta: {
				imageGen: { status: "generating", prompt, size: imageGenSize } satisfies ImageGenMeta,
			},
		});
		setDraft("");

		if (attachments.length > 0) {
			setAttachmentsAtom({ sessionId, value: [] });
		}

		try {
			const result = await desktopApi.imagegen.generate({
				provider: provider.id,
				model: modelId,
				prompt,
				size: imageGenSize,
				watermark: imageGenWatermark,
				outputFormat: imageGenOutputFormat,

				referenceImages: attachments.length > 0 ? attachments : undefined,

				sessionId,
			});
			if (result.ok) {
				updateTimelineMessage(imageMessageId, (m) => ({
					...m,
					images: [result.image],
					meta: {
						imageGen: { status: "complete", prompt, size: imageGenSize } satisfies ImageGenMeta,
					},
				}));
				showNotice(t("imagegen.done"), 4000);
			} else {
				if (attachments.length > 0) {
					setAttachmentsAtom({ sessionId, value: (current) => [...attachments, ...current] });
				}
				updateTimelineMessage(imageMessageId, (m) => ({
					...m,
					meta: {
						imageGen: {
							status: "error",
							prompt,
							size: imageGenSize,
							errorDetail: mapImageGenError(result.error, result.detail),
						} satisfies ImageGenMeta,
					},
				}));
			}
		} catch {
			if (attachments.length > 0) {
				setAttachmentsAtom({ sessionId, value: (current) => [...attachments, ...current] });
			}
			updateTimelineMessage(imageMessageId, (m) => ({
				...m,
				meta: {
					imageGen: {
						status: "error",
						prompt,
						errorDetail: t("imagegen.error.network"),
					} satisfies ImageGenMeta,
				},
			}));
		} finally {
			setGeneratingImage(false);
		}
	}, [activeImageGenModelId, activeImageGenProviderId, attachments, draft, generatingImage, imageGenConfig, imageGenOutputFormat, imageGenSize, imageGenWatermark, record?.noSession, sessionId, setAttachmentsAtom, setCacheMessages, setDraft, store]);

	const submitVideo = useCallback(
		async (confirmed = false) => {
			const prompt = draft.trim();
			if (!prompt || submittingVideo) return;
			const provider = findVideoGenProvider(videoGenConfig, videoGenConfig.activeProviderId);
			const modelId = provider?.models.includes(videoGenConfig.activeModel) ? videoGenConfig.activeModel : "";
			if (!provider?.id || !modelId || !provider.baseUrl.trim() || !provider.apiKey.trim()) {
				showNotice(t("videogen.error.notConfigured"), 5000);
				return;
			}

			if (attachments.length > 0) {
				showNotice(t("videogen.error.attachmentsUnsupported"), 5000);
				return;
			}

			if (videoGenConfig.costConfirm && !confirmed) {
				setVideoConfirmPending(true);
				return;
			}
			setVideoConfirmPending(false);
			if (record?.noSession === true) {
				showNotice(t("videogen.transientHint"), 6000);
			}
			setSubmittingVideo(true);
			const appendTimelineMessage = (message: ChatMessage) => {
				const previous = store.get(sessionMessagesCacheAtom)?.[sessionId]?.messages ?? [];
				setCacheMessages({ sessionId, messages: [...previous, message], source: "runtime" });
			};
			const updateTimelineMessage = (id: string, patch: (m: ChatMessage) => ChatMessage) => {
				const previous = store.get(sessionMessagesCacheAtom)?.[sessionId]?.messages ?? [];
				setCacheMessages({ sessionId, messages: previous.map((m) => (m.id === id ? patch(m) : m)), source: "runtime" });
			};
			const params = videoGenConfig.activeParams;

			const resolution = params.resolution ?? provider.defaults?.resolution;
			const duration = params.duration ?? provider.defaults?.duration;
			const ratio = params.ratio ?? provider.defaults?.ratio;
			appendTimelineMessage({
				id: crypto.randomUUID(),
				agentId: "",
				role: "user",
				text: prompt,
				timestamp: Date.now(),
			});

			const videoMessageId = crypto.randomUUID();
			const placeholderMeta: VideoGenMeta = { status: "queued", prompt, resolution, duration, ratio };
			appendTimelineMessage({
				id: videoMessageId,
				agentId: "",
				role: "assistant",
				text: "",
				stopReason: "stop",
				timestamp: Date.now(),
				meta: { videoGen: placeholderMeta },
			});
			setDraft("");
			try {
				const result = await desktopApi.videogen.submit({
					provider: provider.id,
					model: modelId,
					prompt,
					sessionId,
					messageId: videoMessageId,
					resolution,
					duration,
					ratio,
				});
				if (result.ok) {
					updateTimelineMessage(videoMessageId, (m) => ({
						...m,
						meta: { ...m.meta, videoGen: { ...placeholderMeta, jobId: result.jobId } },
					}));
					showNotice(t("videogen.submitted"), 4000);
				} else {
					updateTimelineMessage(videoMessageId, (m) => ({
						...m,
						meta: { ...m.meta, videoGen: { ...placeholderMeta, status: "error", errorDetail: mapVideoGenError(result.error, result.detail) } },
					}));
				}
			} catch {
				updateTimelineMessage(videoMessageId, (m) => ({
					...m,
					meta: { ...m.meta, videoGen: { ...placeholderMeta, status: "error", errorDetail: t("videogen.error.network") } },
				}));
			} finally {
				setSubmittingVideo(false);
			}
		},
		[attachments.length, draft, record?.noSession, sessionId, setCacheMessages, setDraft, store, submittingVideo, videoGenConfig],
	);

	const confirmVideoGen = useCallback(() => {
		void submitVideo(true);
	}, [submitVideo]);
	const cancelVideoGen = useCallback(() => setVideoConfirmPending(false), []);

	const promoteAndSend = useCallback(
		async (behavior?: "steer" | "followUp", overrideText?: string) => {
			if (mode === "imagegen") {
				void generateImage();
				return;
			}

			if (mode === "videogen") {
				void submitVideo();
				return;
			}

			if (overrideText === undefined && pasteFiles.length) {
				const refs: string[] = [];
				for (const file of pasteFiles) {
					if (file.inProject) {
						refs.push(formatFilePathRef(file.path));
					} else {
						const content = await desktopApi.files.readContent(file.path, PASTE_FILE_CONTENT_MAX_BYTES).catch(() => "");
						if (content) refs.push(content);
					}
				}
				const liveDraft = liveDomDraftRef.current.sessionId === sessionId ? liveDomDraftRef.current.value : draft;
				const joined = [liveDraft.trim(), refs.join("\n\n")].filter(Boolean).join("\n\n");
				liveDomDraftRef.current = { sessionId, value: joined };
				setDraft(joined);

				setPasteFiles([]);
			}
			options.onPromoteSession?.(sessionId);
			return send(behavior, overrideText);
		},
		[draft, mode, generateImage, submitVideo, options.onPromoteSession, pasteFiles, send, sessionId, setDraft, setPasteFiles],
	);

	const selectSuggestion = useCallback(
		(item: SuggestionItem) => {
			const liveDraft = liveDomDraftRef.current.sessionId === sessionId ? liveDomDraftRef.current.value : draft;
			const liveCursor = editorRef.current ? getComposerCaretOffset(editorRef.current) : cursor;

			const result = applySuggestion(liveDraft, liveCursor, item.value, validSessionRefs, {
				noTrailingSpace: item.isDirectory === true,
			});
			liveDomDraftRef.current = { sessionId, value: result.text };
			setDraft(result.text);
			setCursor(result.cursor);
			caretRef.current = { pos: result.cursor, forValue: result.text };
			setSuggestionsOpen(false);
			requestAnimationFrame(() => editorRef.current?.focus());
		},
		[cursor, draft, sessionId, setDraft, validSessionRefs],
	);

	const closeSuggestions = useCallback(() => {
		const liveDraft = liveDomDraftRef.current.sessionId === sessionId ? liveDomDraftRef.current.value : draft;
		const liveCursor = editorRef.current ? getComposerCaretOffset(editorRef.current) : cursor;
		const result = clearSuggestionTrigger(liveDraft, liveCursor, validSessionRefs);
		liveDomDraftRef.current = { sessionId, value: result.text };
		setDraft(result.text);
		setCursor(result.cursor);
		caretRef.current = { pos: result.cursor, forValue: result.text };
		setSuggestionsOpen(false);
		requestAnimationFrame(() => editorRef.current?.focus());
	}, [cursor, draft, sessionId, setDraft, validSessionRefs]);

	const onChange = useCallback(
		(value: string, nextCursor: number) => {
			liveDomDraftRef.current = { sessionId, value };
			setDraft(value);
			setCursor(nextCursor);
			setSuggestionsOpen(detectTrigger(value, nextCursor, validSessionRefs) !== null);
			if (historyIndex >= 0) {
				const history = getPromptHistory();
				if (value !== history[historyIndex]) {
					setHistoryIndex(-1);
					setSavedDraft("");
				}
			}
		},
		[getPromptHistory, historyIndex, sessionId, setDraft, validSessionRefs],
	);

	const suggestionRef = useRef<{ visible: boolean; accept: () => void; dismiss: () => void; acceptKey: (event: React.KeyboardEvent<HTMLDivElement>) => boolean } | null>(null);

	const onKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			if (isComposingKeyboardEvent(event)) return;

			const ghost = suggestionRef.current;
			if (ghost?.visible) {
				if (ghost.acceptKey(event)) {
					event.preventDefault();
					ghost.accept();
					return;
				}
				if (event.key === "Escape") {
					event.preventDefault();
					ghost.dismiss();
					return;
				}
			}

			if (suggestionsOpen && suggestionItems.length > 0) {
				if (event.key === "ArrowDown") {
					event.preventDefault();
					setSelectedSuggestionIndex((index) => Math.min(index + 1, suggestionItems.length - 1));
					return;
				}
				if (event.key === "ArrowUp") {
					event.preventDefault();
					setSelectedSuggestionIndex((index) => Math.max(index - 1, 0));
					return;
				}
				if (event.key === "Enter") {
					if (isComposingKeyboardEvent(event)) return;
					event.preventDefault();
					const selected = suggestionItems[Math.min(selectedSuggestionIndex, suggestionItems.length - 1)];
					if (selected) selectSuggestion(selected);
					return;
				}
				if (event.key === "Escape") {
					event.preventDefault();
					closeSuggestions();
					return;
				}
			}

			const liveDraft = liveDomDraftRef.current.sessionId === sessionId ? liveDomDraftRef.current.value : draft;

			const liveSelection = editorRef.current ? getComposerSelectionRange(editorRef.current) : { from: cursor, to: cursor };

			const blockEdge = getComposerCaretBlockEdge(editorRef.current);
			const history = getPromptHistory();

			const measureEdge = event.key === "ArrowUp" || event.key === "ArrowDown";
			const atVisualTop = measureEdge && isComposerAtVisualEdge(editorRef.current, "up");
			const atVisualBottom = measureEdge && isComposerAtVisualEdge(editorRef.current, "down");

			const navIntent = resolveComposerHistoryIntent({
				key: event.key,
				atFirstBlock: blockEdge.atFirstBlock,
				atLastBlock: blockEdge.atLastBlock,
				atVisualTop,
				atVisualBottom,
				historyIndex,
				historyLength: history.length,
				modifier: event.shiftKey || event.ctrlKey || event.altKey || event.metaKey,
				hasSelection: liveSelection.from !== liveSelection.to,
			});

			if (navIntent === "recall-older") {
				event.preventDefault();
				const nextIndex = historyIndex < 0 ? 0 : Math.min(historyIndex + 1, history.length - 1);
				if (historyIndex < 0) setSavedDraft(liveDraft);
				setHistoryIndex(nextIndex);
				liveDomDraftRef.current = { sessionId, value: history[nextIndex] };
				setDraft(history[nextIndex]);
				caretRef.current = { pos: history[nextIndex].length, forValue: history[nextIndex] };
				return;
			}
			if (navIntent === "recall-newer") {
				event.preventDefault();
				const nextIndex = historyIndex - 1;
				const nextDraft = nextIndex >= 0 ? history[nextIndex] : savedDraft;
				setHistoryIndex(nextIndex);
				if (nextIndex < 0) setSavedDraft("");
				liveDomDraftRef.current = { sessionId, value: nextDraft };
				setDraft(nextDraft);
				caretRef.current = { pos: nextDraft.length, forValue: nextDraft };
				return;
			}
			if (navIntent === "restore-draft") {
				liveDomDraftRef.current = { sessionId, value: savedDraft };
				setDraft(savedDraft);
				setHistoryIndex(-1);
				setSavedDraft("");
				return;
			}

			const intent = mode === "plan" && isPlanModeSendKey(event) ? "send" : getComposerEnterIntent(event, sendShortcut);
			if (intent === "send") {
				event.preventDefault();

				void promoteAndSend(resolveBusySendDelivery(isBusy, store.get(busySendDeliveryAtom), isAcpBackend ? (record?.backend === "qoder" || runtime?.backend === "qoder" ? "qoder" : "acp") : undefined));
			}
		},
		[closeSuggestions, cursor, draft, getPromptHistory, historyIndex, isBusy, mode, promoteAndSend, savedDraft, selectedSuggestionIndex, selectSuggestion, sendShortcut, sessionId, setDraft, store, suggestionItems, suggestionsOpen],
	);

	const addImageFiles = useCallback(
		async (imageFiles: File[]) => {
			for (const file of imageFiles) {
				try {
					const image = await processComposerImageFile(file);

					const currentBytes = attachmentBytes(store.get(sessionAttachmentsBySessionIdAtomFamily(sessionId)));
					if (currentBytes + base64DataBytes(image.data) > COMPOSER_ATTACHMENT_BUDGET_BYTES) {
						showNotice(t("app.imageBudgetExceeded", { size: formatBytes(COMPOSER_ATTACHMENT_BUDGET_BYTES) }), 3000);
						continue;
					}
					setAttachments((current) => [...current, image]);
				} catch (error) {
					showNotice(composerImageNotice(error), 3000);
				}
			}
		},
		[sessionId, setAttachments, store],
	);

	const insertRefTexts = useCallback(
		(refTexts: string[]) => {
			if (refTexts.length === 0) return;
			const liveDraft = liveDomDraftRef.current.sessionId === sessionId ? liveDomDraftRef.current.value : draft;
			const liveCursor = editorRef.current ? getComposerCaretOffset(editorRef.current) : cursor;
			const refText = refTexts.join(" ");
			const previous = liveDraft[liveCursor - 1];
			const spacer = liveCursor > 0 && previous !== " " && previous !== "\n" ? " " : "";
			const next = liveDraft.slice(0, liveCursor) + spacer + refText + liveDraft.slice(liveCursor);
			const nextCursor = liveCursor + spacer.length + refText.length;
			liveDomDraftRef.current = { sessionId, value: next };
			setDraft(next);
			setCursor(nextCursor);
			caretRef.current = { pos: nextCursor, forValue: next };
			requestAnimationFrame(() => editorRef.current?.focus());
		},
		[cursor, draft, sessionId, setDraft],
	);

	const insertFilePathRefs = useCallback(
		(paths: string[]) => {
			insertRefTexts(paths.map((path) => formatFilePathRef(path, { isDirectory: /[\\/]$/.test(path) })));
		},
		[insertRefTexts],
	);

	const insertPlainTextAtCursor = useCallback(
		(text: string) => {
			if (!text) return;
			const liveDraft = liveDomDraftRef.current.sessionId === sessionId ? liveDomDraftRef.current.value : draft;
			const liveCursor = editorRef.current ? getComposerCaretOffset(editorRef.current) : cursor;
			const next = liveDraft.slice(0, liveCursor) + text + liveDraft.slice(liveCursor);
			const nextCursor = liveCursor + text.length;
			liveDomDraftRef.current = { sessionId, value: next };
			setDraft(next);
			setCursor(nextCursor);
			caretRef.current = { pos: nextCursor, forValue: next };
			requestAnimationFrame(() => editorRef.current?.focus());
		},
		[cursor, draft, sessionId, setDraft],
	);

	const captureVoiceTarget = useCallback((): VoiceTranscriptionTarget => {
		const liveDraft = liveDomDraftRef.current.sessionId === sessionId ? liveDomDraftRef.current.value : draft;
		const selection = editorRef.current ? getComposerSelectionRange(editorRef.current) : { from: cursor, to: cursor };
		return { sessionId, draft: liveDraft, ...selection };
	}, [cursor, draft, sessionId]);

	const applyVoiceText = useCallback(
		(target: VoiceTranscriptionTarget, text: string) => {
			const currentDraft = liveDomDraftRef.current.sessionId === sessionId ? liveDomDraftRef.current.value : (store.get(sessionDraftByIdAtom)[sessionId] ?? "");
			const result = resolveVoiceTranscriptionInsertion({
				target,
				currentSessionId: sessionId,
				currentDraft,
				text,
			});
			if (!result.ok) return false;
			liveDomDraftRef.current = { sessionId, value: result.value };
			setDraft(result.value);
			setCursor(result.caret);
			caretRef.current = { pos: result.caret, forValue: result.value };
			requestAnimationFrame(() => editorRef.current?.focus());
			return true;
		},
		[sessionId, setDraft, store],
	);

	const voice = useVoiceTranscription({
		scopeKey: sessionId,
		captureTarget: captureVoiceTarget,
		applyText: applyVoiceText,
	});

	const targetModelChain = {
		recordModel: record?.model,
		welcomeModel: readWelcomeModelPreference()?.model,
		fallback: bootstrapDefaults?.model,
	};
	const enhanceTarget = resolveEnhanceTargetModel({ ...targetModelChain, configured: enhanceModelConfig });
	const captureEnhanceRequest = useCallback((): PromptEnhanceRequest | null => {
		if (!enhanceTarget) return null;
		const draftSnapshot = liveDomDraftRef.current.sessionId === sessionId ? liveDomDraftRef.current.value : draft;

		const context = enhanceIncludeContext ? collectPromptEnhanceContext(store.get(sessionMessageCacheBySessionIdAtomFamily(sessionId))?.messages ?? []) : [];
		return { ...enhanceTarget, draft: draftSnapshot, ...(context.length ? { context } : {}) };
	}, [draft, enhanceTarget, enhanceIncludeContext, sessionId, store]);

	const applyEnhancedText = useCallback(
		(text: string) => {
			liveDomDraftRef.current = { sessionId, value: text };
			setDraft(text);
			setCursor(text.length);
			caretRef.current = { pos: text.length, forValue: text };
			requestAnimationFrame(() => editorRef.current?.focus());
		},
		[sessionId, setDraft],
	);

	const enhance = usePromptEnhance({
		scopeKey: sessionId,
		modelLabel: enhanceTarget ? `${enhanceTarget.provider}/${enhanceTarget.modelId}` : undefined,
		captureRequest: captureEnhanceRequest,
		applyText: applyEnhancedText,
	});

	const promptSuggestionEnabled = useAtomValue(promptSuggestionEnabledAtom);
	const promptSuggestionModelConfig = useAtomValue(promptSuggestionModelAtom);
	const suggestionTarget = resolveEnhanceTargetModel({ ...targetModelChain, configured: promptSuggestionModelConfig });
	const suggestion = usePromptSuggestion({
		scopeKey: sessionId,
		enabled: promptSuggestionEnabled,
		target: suggestionTarget,
		turnRunning: isSessionTurnRunning(runtime?.state, runtime?.status),

		draftEmpty: !hasContent,
		applyText: applyEnhancedText,
	});
	suggestionRef.current = suggestion;

	const pasteTextToFile = useCallback(
		async (text: string) => {
			try {
				const result = await desktopApi.pasteFiles.write({
					projectPath: composerProject?.path ?? "",
					content: text,
				});
				setPasteFiles((current) => [
					...current,
					{
						id: crypto.randomUUID(),
						path: result.path,
						fileName: result.fileName,
						bytes: result.bytes,
						inProject: result.inProject,
					},
				]);
				showNotice(t("app.pasteConvertedToFile", { name: result.fileName, size: formatBytes(result.bytes) }), 4000);
			} catch {
				showNotice(t("app.pasteConvertFailed"), 3000);
				insertPlainTextAtCursor(text);
			}
		},
		[composerProject?.path, insertPlainTextAtCursor, setPasteFiles],
	);

	const resolveLocalPathsFromFiles = useCallback((files: File[]) => {
		const getPath = desktopApi.files.getPathForFile;
		if (!getPath) return [];
		const paths: string[] = [];
		for (const file of files) {
			try {
				const path = getPath(file);
				if (path) paths.push(path);
			} catch {}
		}
		return paths;
	}, []);

	const pasteClipboardImages = useCallback(
		async (paths: string[], dataTransfer: DataTransfer | null) => {
			try {
				const files: File[] = [];
				for (const path of paths) {
					const dataUrl = await desktopApi.files.readBase64(path, COMPOSER_IMAGE_MAX_BYTES);
					if (!dataUrl) throw new Error(`Cannot read image: ${path}`);
					const fileName = path.split(/[\\/]/).pop() || path;
					files.push(dataUrlToFile(dataUrl, imageMimeTypeFromPath(path), fileName));
				}
				await addImageFiles(files);
			} catch {
				const imageFiles = dataTransfer ? getClipboardImageFiles(dataTransfer) : [];
				if (imageFiles.length) {
					await addImageFiles(imageFiles);
					return;
				}
				const imageDataUrl = desktopApi.clipboard.readImage();
				if (imageDataUrl) {
					await addImageFiles([dataUrlToFile(imageDataUrl, "image/png", "clipboard-image.png")]);
					return;
				}
				insertFilePathRefs(paths);
			}
		},
		[addImageFiles, insertFilePathRefs],
	);

	const pasteFromClipboard = useCallback(async (): Promise<boolean> => {
		const clipboardPaths = desktopApi.files.getClipboardPaths?.() ?? [];
		if (clipboardPaths.length > 0) {
			if (clipboardPaths.every(isImageFilePath)) {
				await pasteClipboardImages(clipboardPaths, null);
			} else {
				insertFilePathRefs(clipboardPaths);
			}
			return true;
		}
		const imageDataUrl = desktopApi.clipboard.readImage();
		if (imageDataUrl) {
			await addImageFiles([dataUrlToFile(imageDataUrl, "image/png", "clipboard-image.png")]);
			return true;
		}

		const text = desktopApi.clipboard.readText();
		if (text.length >= PASTE_TO_FILE_MIN_CHARS) {
			void pasteTextToFile(text);
			return true;
		}
		return false;
	}, [addImageFiles, insertFilePathRefs, pasteClipboardImages, pasteTextToFile]);

	const onPaste = useCallback(
		(event: React.ClipboardEvent<HTMLDivElement>) => {
			const clipboardPaths = desktopApi.files.getClipboardPaths?.() ?? [];
			if (clipboardPaths.length > 0) {
				event.preventDefault();

				if (clipboardPaths.every(isImageFilePath)) {
					void pasteClipboardImages(clipboardPaths, event.clipboardData);
				} else {
					insertFilePathRefs(clipboardPaths);
				}
				return;
			}

			const fileItems = Array.from(event.clipboardData.items).filter((item) => item.kind === "file");
			if (fileItems.length > 0) {
				const files = fileItems.map((item) => item.getAsFile()).filter((file): file is File => Boolean(file));
				const paths = resolveLocalPathsFromFiles(files);
				if (paths.length > 0) {
					event.preventDefault();

					if (paths.every(isImageFilePath)) {
						void pasteClipboardImages(paths, event.clipboardData);
					} else {
						insertFilePathRefs(paths);
					}
					return;
				}
			}

			// 剪贴板里没有文件路径时，位图才是用户要的内容，优先于纯文本插入。
			const imageFiles = getClipboardImageFiles(event.clipboardData);
			if (imageFiles.length) {
				event.preventDefault();
				void addImageFiles(imageFiles);
				return;
			}

			const plainText = event.clipboardData.getData("text/plain");
			if (plainText.length >= PASTE_TO_FILE_MIN_CHARS) {
				event.preventDefault();
				void pasteTextToFile(plainText);
				return;
			}
		},
		[addImageFiles, insertFilePathRefs, pasteClipboardImages, pasteTextToFile, resolveLocalPathsFromFiles],
	);

	const onDrop = useCallback(
		(event: React.DragEvent<HTMLDivElement>) => {
			event.preventDefault();
			const nodePayload = readFileNodeDragPayload(event.dataTransfer);
			if (nodePayload) {
				insertRefTexts([fileNodeDragPayloadToRef(nodePayload)]);
				return;
			}
			const files = Array.from(event.dataTransfer.files);
			if (files.length === 0) return;
			const paths = resolveLocalPathsFromFiles(files);
			if (paths.length > 0) {
				insertFilePathRefs(paths);
				return;
			}
			void addImageFiles(getDroppedImageFiles(event.dataTransfer));
		},
		[addImageFiles, insertFilePathRefs, insertRefTexts, resolveLocalPathsFromFiles],
	);

	const attachFile = useCallback(async () => {
		try {
			const paths = await desktopApi.dialog.pickFiles({ title: t("menu.attachFile") });
			insertFilePathRefs(paths);
		} catch {}
	}, [insertFilePathRefs]);

	const removePasteFile = useCallback(
		(index: number) => {
			const target = pasteFiles[index];
			setPasteFiles((current) => current.filter((_, item) => item !== index));
			if (target) void desktopApi.pasteFiles.delete(target.path).catch(() => undefined);
		},
		[pasteFiles, setPasteFiles],
	);

	const clearPasteFiles = useCallback(() => {
		for (const file of pasteFiles) {
			void desktopApi.pasteFiles.delete(file.path).catch(() => undefined);
		}
		setPasteFiles([]);
	}, [pasteFiles, setPasteFiles]);

	const onChipClick = useCallback(
		(chip: ComposerChip) => {
			if (chip.kind === "session") {
				const selected = projectSessions.find((session) => (session.name ?? session.filePath) === chip.label);
				if (selected) setSessionReference(selected);
			}
		},
		[projectSessions],
	);

	useEffect(() => {
		if (!hasContent) {
			setBusyDraftLocked(false);
		} else if (isBusy) {
			setBusyDraftLocked(true);
		}
	}, [hasContent, isBusy, sessionId]);

	const abort = useCallback(async () => {
		const target = toSessionRuntimeTarget(sessionId, runtime);
		if (!target) {
			showNotice(t("sessionCommand.runtimeUnavailable"), 4000);
			return;
		}
		try {
			suppressQueuedDrain?.(sessionId);
			requireSessionCommand(await desktopApi.sessions.abortRuntime(target));
		} catch (error) {
			showNotice(error instanceof Error ? error.message : String(error), Number.POSITIVE_INFINITY);
		}
	}, [runtime?.agentId, runtime?.runtimeGeneration, sessionId, suppressQueuedDrain]);

	const acknowledgeUnknownDelivery = useCallback(() => {
		setSendStateAtom({ sessionId, state: { status: "idle" } });
	}, [sessionId, setSendStateAtom]);

	const upsertSession = useSetAtom(upsertSessionAtom);

	const hasUserMessage = (messageCache?.messages ?? []).some((message) => message.role === "user");
	const backendLocked = record?.status === "active" || hasUserMessage;
	const changeBackend = useCallback(
		async (next: AgentBackend, explicitAcpToolId?: string) => {
			if (backendLocked) return;

			if (isGuideBootstrapSession) {
				let stored: string = next;
				let guideToolId: string | undefined;
				if (next === "acp") {
					const tools = store.get(acpToolsAtom);
					const toolId = explicitAcpToolId ?? tools[0]?.id;
					if (!toolId) {
						showNotice(t("app.acpNoTools"), 4000);
						return;
					}
					stored = `acp:${toolId}`;
					guideToolId = toolId;
				}
				setGuideBackendOverride(next);

				if (guideToolId) setGuideAcpToolOverride(guideToolId);
				try {
					localStorage.setItem(WELCOME_BACKEND_KEY, stored);
				} catch {}

				if (next === "acp" && ensureSessionId) {
					try {
						await ensureSessionId(GUIDE_BOOTSTRAP_SESSION_ID);
					} catch (error) {
						showNotice(error instanceof Error ? error.message : String(error), 4000);
					}
				}
				return;
			}

			const boundAgentId = runtime?.agentId;
			if (boundAgentId) {
				try {
					await desktopApi.system.stopAgent(boundAgentId);
				} catch {}
			}
			try {
				let acpToolId: string | undefined;
				if (next === "acp") {
					const tools = store.get(acpToolsAtom);

					acpToolId = explicitAcpToolId ?? record?.acpToolId ?? tools[0]?.id;
					if (!acpToolId) {
						showNotice(t("app.acpNoTools"), 4000);
						return;
					}
				}

				const resolved = next === "pi" ? await desktopApi.sessions.resolveLaunchDefaults({ backend: "pi" }).catch(() => undefined) : undefined;
				const defaults = resolveBackendSwitchDefaults(next, resolved);
				const updated = await desktopApi.sessions.updateRecord(sessionId, {
					backend: next,
					model: defaults.model,
					thinkingLevel: defaults.thinkingLevel,
					...(next === "acp" && acpToolId ? { acpToolId } : {}),
				});
				upsertSession(updated);
			} catch (error) {
				showNotice(error instanceof Error ? error.message : String(error), 4000);
			}
		},
		[backendLocked, ensureSessionId, isGuideBootstrapSession, record, runtime?.agentId, sessionId, showNotice, store, upsertSession],
	);

	const changeAcpTool = useCallback(
		async (toolId: string) => {
			if (backendLocked || record?.backend !== "acp") return;
			try {
				const updated = await desktopApi.sessions.updateRecord(sessionId, { acpToolId: toolId });
				upsertSession(updated);
			} catch (error) {
				showNotice(error instanceof Error ? error.message : String(error), 4000);
			}
		},
		[backendLocked, record?.backend, sessionId, upsertSession],
	);

	const compact = useCallback(async () => {
		const target = toSessionRuntimeTarget(sessionId, runtime);
		if (!target) {
			setDraft("/compact");
			caretRef.current = { pos: "/compact".length, forValue: "/compact" };
			void promoteAndSend();
			return;
		}
		await runManualCompact(target);
	}, [runtime?.agentId, runtime?.runtimeGeneration, sessionId, setDraft, promoteAndSend, runManualCompact]);

	const openPicker = useCallback(
		(kind: ComposerPickerKind) => {
			if (kind === "template") void loadTemplates();
			setPicker(kind);
		},
		[loadTemplates],
	);

	const insertTemplate = useCallback(
		(template: PromptTemplateInfo) => {
			const next = appendSlashCommandToDraft(draft, template.name);
			liveDomDraftRef.current = { sessionId, value: next };
			setDraft(next);
			caretRef.current = { pos: next.length, forValue: next };
			setPicker(null);
			requestAnimationFrame(() => editorRef.current?.focus());
		},
		[draft, sessionId, setDraft],
	);

	const insertSkillInvocation = useCallback(
		(name: string) => {
			const token = toSkillInvocationToken("pi", name);
			const next = appendSlashCommandToDraft(draft, token);
			liveDomDraftRef.current = { sessionId, value: next };
			setDraft(next);
			caretRef.current = { pos: next.length, forValue: next };
			setPicker(null);
			requestAnimationFrame(() => editorRef.current?.focus());
		},
		[draft, sessionId, setDraft],
	);

	const insertTemplateContent = useCallback(
		(template: PromptTemplateInfo) => {
			const next = appendContentToDraft(draft, stripMarkdownFrontmatter(template.content));
			liveDomDraftRef.current = { sessionId, value: next };
			setDraft(next);
			caretRef.current = { pos: next.length, forValue: next };
			setPicker(null);
			requestAnimationFrame(() => editorRef.current?.focus());
		},
		[draft, sessionId, setDraft],
	);

	const insertSkillContent = useCallback(
		(content: string) => {
			const next = appendContentToDraft(draft, stripMarkdownFrontmatter(content));
			liveDomDraftRef.current = { sessionId, value: next };
			setDraft(next);
			caretRef.current = { pos: next.length, forValue: next };
			setPicker(null);
			requestAnimationFrame(() => editorRef.current?.focus());
		},
		[draft, sessionId, setDraft],
	);

	const insertQuickMessage = useCallback(
		(text: string) => {
			const next = appendContentToDraft(draft, text.trim());
			liveDomDraftRef.current = { sessionId, value: next };
			setDraft(next);
			caretRef.current = { pos: next.length, forValue: next };
			setPicker(null);
			requestAnimationFrame(() => editorRef.current?.focus());
		},
		[draft, sessionId, setDraft],
	);

	return {
		sessionId,
		record,
		runtime,

		backend: record?.backend ?? (isGuideBootstrapSession ? guideBackendOverride : undefined) ?? "pi",

		changeBackend: backendLocked ? undefined : changeBackend,

		acpTool: record?.backend === "acp" ? { toolId: record.acpToolId, onChange: backendLocked ? undefined : changeAcpTool } : isGuideBootstrapSession && guideBackendOverride === "acp" ? { toolId: guideAcpToolOverride, onChange: backendLocked ? undefined : changeAcpTool } : undefined,

		acpToolName:
			record?.backend === "acp" && record.acpToolId
				? (store.get(acpToolsAtom).find((candidate) => candidate.id === record.acpToolId)?.name ?? runtime?.state?.modelName)
				: isGuideBootstrapSession && guideBackendOverride === "acp" && guideAcpToolOverride
					? store.get(acpToolsAtom).find((candidate) => candidate.id === guideAcpToolOverride)?.name
					: undefined,

		bootstrapDefaultModel: bootstrapDefaults?.model,
		bootstrapDefaultThinkingLevel: bootstrapDefaults?.thinkingLevel,

		bootstrapModelThinkingLevels: bootstrapDefaults?.modelThinkingLevels,
		draft,
		attachments,
		mode,
		sendState,
		templates,
		picker,
		previewImage,
		sessionReference,
		sessionReferenceSelection: sessionReference ? sessionReferenceSelections[`&${sessionReference.name ?? sessionReference.filePath}`] : undefined,
		bangMode: getBangMode(draft),
		isBusy,
		isStarting,
		hasContent,
		busyDraftLocked,
		voice,
		enhance,

		suggestion: { text: suggestion.text, visible: suggestion.visible },
		editor: {
			ref: editorRef,
			caretRef,
			cursor,
			validCommandNames,
			validFilePaths,
			validSessionRefs,
			validQuotes,
			onChange,
			onCursorChange: setCursor,
			onKeyDown,
			onPaste,
			onPasteClipboard: pasteFromClipboard,
			onDrop,
			onDragOver: (event: React.DragEvent<HTMLDivElement>) => {
				if (event.dataTransfer.types.includes(SESSION_TAB_DRAG_MIME)) return;
				event.preventDefault();

				if (event.dataTransfer.types.includes(PI_FILE_NODE_DRAG_MIME) || event.dataTransfer.types.includes(PI_FILE_PATH_DRAG_MIME)) {
					event.dataTransfer.dropEffect = "copy";
				}
			},
			onFocus: () => setSuggestionsOpen(detectTrigger(draft, cursor, validSessionRefs) !== null),
			onBlur: () => setSuggestionsOpen(false),
			onChipClick,
			attachFile,
		},
		suggestions: {
			open: suggestionsOpen,
			items: suggestionItems,
			selectedIndex: selectedSuggestionIndex,
			anchorStyle: suggestionAnchorStyle,
			setSelectedIndex: setSelectedSuggestionIndex,
			close: closeSuggestions,
			pick: selectSuggestion,
		},
		images: {
			preview: setPreviewImage,
			add: (image: ImageContent) => setAttachments((current) => [...current, image]),
			remove: (index: number) => setAttachments((current) => current.filter((_, item) => item !== index)),
			clear: () => setAttachments([]),
		},
		pasteFiles: {
			files: pasteFiles,
			remove: removePasteFile,
			clear: clearPasteFiles,
		},
		delivery: {
			send: () => {
				void promoteAndSend(resolveBusySendDelivery(isBusy, store.get(busySendDeliveryAtom), isAcpBackend ? (record?.backend === "qoder" || runtime?.backend === "qoder" ? "qoder" : "acp") : undefined));
			},

			sendSteer: isAcpBackend
				? undefined
				: () => {
						void promoteAndSend("steer");
					},
			sendFollowUp: () => {
				void promoteAndSend("followUp");
			},

			sendQuickMessage: (text: string) => {
				const trimmed = text.trim();
				if (!trimmed) return;
				void promoteAndSend(resolveBusySendDelivery(isBusy, store.get(busySendDeliveryAtom), isAcpBackend ? (record?.backend === "qoder" || runtime?.backend === "qoder" ? "qoder" : "acp") : undefined), trimmed);
			},

			canSendQuickMessage: !isStarting && !generatingImage,

			canSendParallel: Boolean(draft.trim()) && attachments.length === 0 && !isStarting && !generatingImage && Boolean(effectiveProjectId),
			sendParallel: () => {
				const text = draft.trim();
				if (!text || !effectiveProjectId) return;
				void askPanel.sendToAsk(effectiveProjectId, text, { originSessionId: sessionId }).then((ok) => {
					if (ok) setDraft("");
				});
			},
			abort: () => void abort(),
			compact: () => void compact(),

			overflowRecoveryTarget: runtime?.state?.contextOverflow ? toSessionRuntimeTarget(sessionId, runtime) : undefined,
			onOverflowRecovery: (target: SessionRuntimeTarget) => void runManualCompact(target),
			imageGenConfig,
			imageGenProviderId: activeImageGenProviderId,
			imageGenModelId: activeImageGenModelId,
			imageGenSize,
			imageGenWatermark,
			imageGenOutputFormat,
			imageGenModeLocked: hasImageGenHistory || record?.backend === "imagegen",
			videoGenConfig,
			videoGenModeLocked: isVideoGenBackend,
			submittingVideo,
			submitVideo,
			videoConfirmPending,
			confirmVideoGen,
			cancelVideoGen,
			setVideoGenSelection: (providerId: string, modelId: string) => {
				const nextProvider = findVideoGenProvider(videoGenConfig, providerId);
				if (!nextProvider?.models.includes(modelId)) return;
				const next = { ...videoGenConfig, activeProviderId: nextProvider.id, activeModel: modelId, activeParams: { ...nextProvider.defaults } };
				setVideoGenConfig(next);
				void desktopApi.videogen.saveConfig(next).catch(() => undefined);
			},
			setVideoGenParam: (key: "resolution" | "duration" | "ratio", value: string | undefined) => {
				const next = { ...videoGenConfig, activeParams: { ...videoGenConfig.activeParams, [key]: value } };
				setVideoGenConfig(next);
				void desktopApi.videogen.saveConfig(next).catch(() => undefined);
			},
			setImageGenSelection: (providerId: string, modelId: string) => {
				const nextProvider = findImageGenProvider(imageGenConfig, providerId);
				if (!nextProvider?.models.includes(modelId)) return;
				persistImageGenSelection(nextProvider.id, modelId);
			},
			setImageGenSize: (size: string) => {
				const parsed = parseImageGenSize(size);
				if (!parsed) return;
				setImageGenSizeState(parsed);
				void desktopApi.settings.update({ imageGenSize: parsed }).catch(() => undefined);
			},
			setImageGenWatermark: (watermark: boolean) => {
				setImageGenWatermarkState(watermark);
				void desktopApi.settings.update({ imageGenWatermark: watermark }).catch(() => undefined);
			},
			setImageGenOutputFormat: (format: string) => {
				const parsed = parseImageGenOutputFormat(format, null);
				if (!parsed) return;
				setImageGenOutputFormatState(parsed);
				void desktopApi.settings.update({ imageGenOutputFormat: parsed }).catch(() => undefined);
			},
			unknown: sendState.status === "unknown",
			unknownError: sendState.error,
			acknowledgeUnknown: acknowledgeUnknownDelivery,
			canSend: hasContent && !isStarting && !generatingImage && !submittingVideo,
			generatingImage,
		},
		pickers: {
			open: openPicker,
			close: () => setPicker(null),
			setMode,
			insertTemplate,
			insertTemplateContent,
			insertSkillInvocation,
			insertSkillContent,
			insertQuickMessage,
		},
		modals: {
			closePreview: () => setPreviewImage(null),
			closeSessionReference: () => setSessionReference(null),
			confirmSessionReference: (sessionName: string, messages: Array<{ role: string; content: string; timestamp: number }>, selectedIndices: number[]) => {
				setSessionReferenceSelections((current) => ({
					...current,
					[`&${sessionName}`]: createSessionReferenceSelection(selectedIndices, messages),
				}));
				setSessionReference(null);
			},
		},
	};
}

export type SessionComposerController = ReturnType<typeof useSessionComposerController>;

function mapImageGenError(error: string, detail?: string): string {
	const extra = detail?.trim() ?? "";
	switch (error) {
		case "notConfigured":
			return t("imagegen.error.notConfigured");
		case "invalidKey":
			return extra ? t("imagegen.error.invalidKeyDetail", { detail: extra }) : t("imagegen.error.invalidKey");
		case "badBaseUrl":
			return extra ? t("imagegen.error.badBaseUrlDetail", { detail: extra }) : t("imagegen.error.badBaseUrl");
		case "empty":
			return t("imagegen.error.empty");
		case "http":
			return extra ? t("imagegen.error.http", { detail: extra }) : t("imagegen.status.error");
		case "responseTooLarge":
			return t("imagegen.error.responseTooLarge");
		default:
			return t("imagegen.error.network");
	}
}

function mapVideoGenError(error: string, detail?: string): string {
	const extra = detail?.trim() ?? "";
	switch (error) {
		case "notConfigured":
			return t("videogen.error.notConfigured");
		case "invalidKey":
			return extra ? t("videogen.error.invalidKeyDetail", { detail: extra }) : t("videogen.error.invalidKey");
		case "badBaseUrl":
			return extra ? t("videogen.error.badBaseUrlDetail", { detail: extra }) : t("videogen.error.badBaseUrl");
		case "empty":
			return t("videogen.error.empty");
		case "timeout":
			return t("videogen.error.timeout");
		case "downloadFailed":
			return t("videogen.error.downloadFailed");
		case "generationFailed":
			return extra ? t("videogen.error.generationFailedDetail", { detail: extra }) : t("videogen.error.generationFailed");
		case "cancelled":
			return t("videogen.error.cancelled");
		case "http":
			return extra ? t("videogen.error.http", { detail: extra }) : t("videogen.status.error");
		default:
			return t("videogen.error.network");
	}
}
