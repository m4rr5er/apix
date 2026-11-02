import React from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { resolvePaneTerminal, terminalOwnerKey, shouldMountPaneTerminalDock } from "../../terminalDockState";
import { settingsOpenAtom } from "../../atoms";
import { claimSessionRuntimeUiResponseAtom, rollbackSessionRuntimeUiResponseAtom } from "../../atoms/session-atoms";
import { sessionRecordByIdAtomFamily, sessionRuntimeBySessionIdAtomFamily, sessionRuntimeUiBySessionIdAtomFamily } from "../../atoms/session-selectors";
import { projectByIdAtomFamily } from "../../atoms/project-atoms";
import { useSessionRuntimeController } from "../../hooks/useSessionRuntimeController";
import { createSessionRuntimeUiResponder, SessionRuntimeUiOverlay } from "../overlays/SessionRuntimeUiOverlay";
import type { QueuedPrompt } from "../../hooks/useQueuedPrompt";
import type { SessionTimelineController } from "../../hooks/useSessionTimelineController";
import { QueuedPromptPanel } from "./ComposerPanels";
import { FileLinkBaseProvider } from "./FileLinkBase";
import { SessionView } from "./SessionView";
import { useSessionPaneServices } from "./SessionPaneServices";
import { usePaneGitInfo } from "../../hooks/usePaneGitInfo";
import { useSessionCommandNames } from "../../hooks/useSessionCommandNames";
import { desktopApi } from "../../desktopApi";
import { t } from "../../i18n";
import { requireSessionCommand, resolveSessionReloadMode, sessionCommandFailureToast, toSessionRuntimeTarget } from "../../utils/sessionCommands";
import type { SessionMenuModel, SessionMenuRunControl } from "./SessionActionsMenu";
import { resolveActiveAskRequest } from "../../utils/askUi";
import { formatRelativeTime } from "../../utils/relativeTime";
import { ConfirmDialog } from "../ui-shadcn/ConfirmDialog";
import type { ChatMessage, RewindCheckpointSummary } from "../../../../shared/types";

export type SessionRuntimeInjectorProps = {
	currentSessionId: string;
	sessionTitle: string;
	sessionTimeline: SessionTimelineController;

	splitPane?: boolean;
	focused?: boolean;
	onFocusPane?: () => void;
	chatHeaderRef: React.RefObject<HTMLDivElement | null>;
	composerRef: React.RefObject<HTMLElement | null>;
	composerOffsetHeight: number;
	terminalRowHeight: number;
	activeQueuedPrompts: QueuedPrompt[];
	queuedTrackRef: React.MutableRefObject<HTMLElement | null>;
};

export const SessionRuntimeInjector = React.memo(function SessionRuntimeInjector(props: SessionRuntimeInjectorProps) {
	const { currentSessionId, sessionTitle, sessionTimeline, splitPane = false, focused = true, onFocusPane, chatHeaderRef, composerRef, composerOffsetHeight, terminalRowHeight, activeQueuedPrompts, queuedTrackRef } = props;

	const services = useSessionPaneServices();
	const settingsOpen = useAtomValue(settingsOpenAtom);
	const sessionRecord = useAtomValue(sessionRecordByIdAtomFamily(currentSessionId));
	const currentSessionRuntime = useAtomValue(sessionRuntimeBySessionIdAtomFamily(currentSessionId));
	const currentSessionRuntimeUi = useAtomValue(sessionRuntimeUiBySessionIdAtomFamily(currentSessionId));
	const claimSessionUiResponse = useSetAtom(claimSessionRuntimeUiResponseAtom);
	const rollbackSessionUiResponse = useSetAtom(rollbackSessionRuntimeUiResponseAtom);
	const runtimeRef = React.useRef(currentSessionRuntime);
	runtimeRef.current = currentSessionRuntime;

	const paneProjectId = currentSessionRuntime?.projectId ?? sessionRecord?.projectId ?? "";
	const paneProject = useAtomValue(projectByIdAtomFamily(paneProjectId));
	const paneFileContext = React.useMemo(
		() => ({
			baseDir: currentSessionRuntime?.cwd ?? paneProject?.path,
			projectId: paneProjectId || undefined,
			projectRoot: paneProject?.path,

			sessionId: currentSessionId,
		}),
		[currentSessionId, currentSessionRuntime?.cwd, paneProject?.path, paneProjectId],
	);
	const openPaneFile = React.useCallback((path: string, line?: number) => services.onOpenFile(path, line, paneFileContext), [paneFileContext, services.onOpenFile]);
	const paneTerminal = React.useMemo(
		() =>
			resolvePaneTerminal({
				sessionId: currentSessionId,
				runtime: currentSessionRuntime,
				projectId: paneProjectId || undefined,
				project: paneProject,
			}),
		[currentSessionId, currentSessionRuntime, paneProjectId, paneProject],
	);
	const paneOwnerKey = paneTerminal ? terminalOwnerKey(paneTerminal.owner) : undefined;
	const paneTerminalState = paneOwnerKey ? services.terminalStatesByOwner[paneOwnerKey] : undefined;
	const paneTerminalOpen = Boolean(paneTerminalState?.open) && Boolean(paneTerminal);
	const paneTerminalCollapsed = Boolean(paneTerminalState?.collapsed);
	const paneTerminalDockVisible = shouldMountPaneTerminalDock({
		ownerKey: paneOwnerKey,
		activeOwnerKey: services.activeTerminalOwnerKey,
		focused,
		open: paneTerminalOpen,
	});

	const setPaneTerminalOpen = React.useCallback(
		(open: boolean) => {
			if (paneOwnerKey) services.setTerminalOpenByOwnerKey(paneOwnerKey, open);
		},
		[paneOwnerKey, services.setTerminalOpenByOwnerKey],
	);
	const setPaneTerminalCollapsed = React.useCallback(
		(collapsed: boolean) => {
			if (paneOwnerKey) services.setTerminalCollapsedByOwnerKey(paneOwnerKey, collapsed);
		},
		[paneOwnerKey, services.setTerminalCollapsedByOwnerKey],
	);

	const paneValidCommandNames = useSessionCommandNames(currentSessionId);

	const paneGit = usePaneGitInfo(paneProjectId, {
		onChanged: services.onProjectGitChanged,
		onSwitchError: (error) =>
			services.showToast(
				t("app.branchSwitchFailed", {
					error: error instanceof Error ? error.message : String(error),
				}),
			),
	});

	const runtimeUiResponder = React.useMemo(() => {
		if (!currentSessionRuntime?.agentId) return undefined;
		const binding = {
			sessionId: currentSessionId,
			agentId: currentSessionRuntime.agentId,
			runtimeGeneration: currentSessionRuntime.runtimeGeneration,
		};

		return createSessionRuntimeUiResponder({
			binding,
			readBinding: () => {
				const latest = runtimeRef.current;
				return latest?.agentId
					? {
							sessionId: currentSessionId,
							agentId: latest.agentId,
							runtimeGeneration: latest.runtimeGeneration,
						}
					: undefined;
			},
			claim: claimSessionUiResponse,
			rollback: rollbackSessionUiResponse,
			send: services.api.sessions.sendUiResponse,
			onError: (error) => services.showToast(error instanceof Error ? error.message : String(error), 4000),
		});
	}, [claimSessionUiResponse, currentSessionId, currentSessionRuntime?.agentId, currentSessionRuntime?.runtimeGeneration, rollbackSessionUiResponse, services.api.sessions.sendUiResponse, services.showToast]);

	const runtime = useSessionRuntimeController({
		sessionId: currentSessionId,
		agents: services.agents,
		queueFlushBySessionRef: services.queueFlushBySessionRef,
		activeQueuedPrompts,
		restartingAgentId: services.restartingAgentId,
		sessionDurationByAgent: services.sessionDurationByAgent,
		activeProjectId: services.activeProjectId,
		showNotice: services.showNotice,
	});

	const askPanelVisible = React.useMemo(() => Boolean(resolveActiveAskRequest(currentSessionRuntime, currentSessionRuntimeUi)), [currentSessionRuntime, currentSessionRuntimeUi]);

	const activeAgent = runtime.activeAgentId ? services.agents.find((a) => a.id === runtime.activeAgentId) : undefined;
	const canMutateActiveMessages = runtime.canMutateActiveMessages;

	const isAcpBackend = sessionRecord?.backend === "acp" || activeAgent?.backend === "acp" || sessionRecord?.backend === "qoder" || activeAgent?.backend === "qoder";
	const canEditOrDeleteMessages = !isAcpBackend;
	const canResend = !isAcpBackend;

	const paneRunCapabilities = services.getSessionRunCapabilities(currentSessionId);
	const paneAgentId = currentSessionRuntime?.agentId;
	const paneRunControl: SessionMenuRunControl | undefined = paneRunCapabilities
		? {
				capabilities: paneRunCapabilities,
				isStopping: Boolean(services.stoppingAgentId && services.stoppingAgentId === paneAgentId),
				isRestarting: runtime.isRestartingThisAgent || services.activatingSessionId === currentSessionId,
				isReloading: services.reloadingSessionId === currentSessionId,
				reloadMode: services.isLanWeb ? "none" : resolveSessionReloadMode(sessionRecord?.backend),
				agentId: paneAgentId,
				onCloseAgent: paneAgentId && services.requestCloseAgentForSession ? () => services.requestCloseAgentForSession?.(currentSessionId) : undefined,
				onAction: (action) => void services.runSessionControl(currentSessionId, action),
			}
		: undefined;

	const paneMenu: SessionMenuModel | undefined = services.getSessionMenu?.(currentSessionId);

	const [rewindConfirm, setRewindConfirm] = React.useState<RewindCheckpointSummary | null>(null);
	const [rewinding, setRewinding] = React.useState(false);
	const handleRewindToMessage = React.useCallback(
		async (message: ChatMessage) => {
			const target = toSessionRuntimeTarget(currentSessionId, currentSessionRuntime);
			if (!target) {
				services.showToast(t("rewind.unavailable"));
				return;
			}
			let list: RewindCheckpointSummary[];
			try {
				list = requireSessionCommand(await desktopApi.sessions.listRewindCheckpoints(target)).value.items;
			} catch (error) {
				services.showToast(
					sessionCommandFailureToast(error, (raw) => t("rewind.loadFailed", { error: raw })),
					4000,
				);
				return;
			}

			const nearest = [...list].sort((a, b) => b.timestamp - a.timestamp).find((cp) => cp.timestamp <= message.timestamp);
			if (!nearest) {
				services.showToast(t("rewind.empty"), 3000);
				return;
			}
			setRewindConfirm(nearest);
		},
		[currentSessionId, currentSessionRuntime, services],
	);
	const performRewindRestore = React.useCallback(async () => {
		if (!rewindConfirm) return;
		const target = toSessionRuntimeTarget(currentSessionId, currentSessionRuntime);
		if (!target) return;
		setRewinding(true);
		try {
			await requireSessionCommand(await desktopApi.sessions.restoreRewindCheckpoint(target, rewindConfirm.id, "files"));
			services.showToast(t("rewind.restoreDone", { id: rewindConfirm.id }));
		} catch (error) {
			services.showToast(
				sessionCommandFailureToast(error, (raw) => t("rewind.restoreFailed", { error: raw })),
				4000,
			);
		} finally {
			setRewinding(false);
			setRewindConfirm(null);
		}
	}, [currentSessionId, currentSessionRuntime, rewindConfirm, services]);

	return (
		<FileLinkBaseProvider baseDir={paneFileContext.baseDir} projectId={paneFileContext.projectId} projectRoot={paneFileContext.projectRoot} sessionId={currentSessionId}>
			<>
				<SessionView
					sessionId={currentSessionId}
					sessionTitle={sessionTitle}
					sessionTimeline={sessionTimeline}
					splitPane={splitPane}
					focused={focused}
					onFocusPane={onFocusPane}
					activeAgentId={runtime.activeAgentId ?? undefined}
					activeAgent={activeAgent}
					hasActiveConversation={runtime.hasActiveConversation}
					hasProject={runtime.sessionHasProject}
					chatHeaderRef={chatHeaderRef}
					composerRef={composerRef}
					composerOffsetHeight={composerOffsetHeight}
					terminalRowHeight={terminalRowHeight}
					isAgentStarting={runtime.isAgentStarting}
					isRestarting={runtime.isRestartingThisAgent}
					runControl={paneRunControl}
					menu={paneMenu}
					sessionDuration={runtime.sessionDuration}
					showThinking={services.showThinking}
					validCommandNames={paneValidCommandNames}
					validFilePaths={services.validFilePaths}
					onPreviewImage={services.onPreviewImage}
					onOpenFile={openPaneFile}
					onDiffFile={services.onDiffFile}
					onResendUserMessage={canResend ? services.resendUserMessage : undefined}
					onEditMessage={canEditOrDeleteMessages ? services.editMessage : undefined}
					onDeleteMessage={canEditOrDeleteMessages ? services.deleteMessage : undefined}
					onRemoveMessageImage={!services.isLanWeb && (!sessionRecord?.backend || sessionRecord.backend === "pi") && sessionRecord?.filePath && services.removeMessageImage ? (message, index) => services.removeMessageImage?.(currentSessionId, message, index) : undefined}
					onForkMessage={isAcpBackend ? undefined : services.forkFromUserMessage}
					onRewindToMessage={isAcpBackend ? undefined : handleRewindToMessage}
					forkingMessageId={services.forkingMessageId}
					onToast={(message: string) => services.showToast(message)}
					onQuickPrompt={(message) => services.insertQuickPrompt(currentSessionId, message)}
					canMutateActiveMessages={canMutateActiveMessages}
					onOpenBranchSession={
						services.activeProjectId && services.openSidebarSessionById
							? (sessionId: string) => {
									void services.openSidebarSessionById?.(services.activeProjectId!, sessionId);
								}
							: undefined
					}
					enqueueSessionPrompt={services.enqueueSessionPrompt}
					gitInfo={paneGit.gitInfo}
					onSwitchBranch={paneGit.switchBranch}
					ensureSessionId={services.ensureSessionId}
					askPanelVisible={askPanelVisible}
					runtimeUi={runtimeUiResponder ? <SessionRuntimeUiOverlay sessionId={currentSessionId} runtime={currentSessionRuntime} ui={currentSessionRuntimeUi} responder={runtimeUiResponder} onExpandedChange={() => undefined} /> : null}
					queuePanel={currentSessionId ? <QueuedPromptPanel trackRef={queuedTrackRef} sessionId={currentSessionId} prompts={activeQueuedPrompts} visiblePrompts={activeQueuedPrompts} onRetract={services.queueRetract} onDiscard={services.queueDiscard} onChangeBehavior={services.queueChangeBehavior} /> : undefined}
					terminalDockVisible={paneTerminalDockVisible}
					terminalOpen={paneTerminalOpen}
					terminalDockClosing={false}
					terminalCollapsed={paneTerminalCollapsed}
					availableTerminalHeight={services.availableTerminalHeight ?? 120}
					terminalOwnerKey={paneOwnerKey}
					terminalTarget={paneTerminal?.target}
					setTerminalOpenForOwner={setPaneTerminalOpen}
					setTerminalCollapsedForOwner={setPaneTerminalCollapsed}
					setTerminalHeight={services.setTerminalHeight}
					terminalSettings={services.terminalSettings}
					onTerminalThemeChange={services.onTerminalThemeChange}
					settingsOpen={settingsOpen}
					environmentDialog={services.environmentDialog}
					runCreateSessionDraft={services.runCreateSessionDraft}
					abortAgent={services.abortAgent}
				/>
				{rewindConfirm && (
					<ConfirmDialog
						title={t("rewind.restoreConfirmTitle")}
						message={t("rewind.restoreConfirmMessage", {
							id: rewindConfirm.id,
							time: formatRelativeTime(rewindConfirm.timestamp),
						})}
						confirmLabel={t("rewind.restoreConfirmRestore")}
						danger
						onConfirm={() => void performRewindRestore()}
						onCancel={() => setRewindConfirm(null)}
					/>
				)}
			</>
		</FileLinkBaseProvider>
	);
});
