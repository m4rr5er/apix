import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject, type ReactNode } from "react";
import { type GroupImperativeHandle, type PanelImperativeHandle } from "react-resizable-panels";
import { ResizablePanel, ResizablePanelGroup } from "../ui-shadcn/resizable";
import type { ChatMessage, GitBranchInfo, ImageContent, TerminalTarget, TerminalThemeId } from "../../../../shared/types";
import type { SessionTimelineController } from "../../hooks/useSessionTimelineController";
import { isLanWeb, desktopApi as api } from "../../desktopApi";
import { SessionHeader } from "./SessionHeader";
import { SessionBranchBar } from "./SessionBranchBar";
import { SessionSubagentsStrip } from "./SessionSubagentsStrip";
import { SessionTodoStrip } from "./SessionTodoStrip";
import { SessionSurfaceStage } from "./SessionSurfaceStage";
import { ComposerArea } from "./ComposerArea";
import type { SessionMenuModel, SessionMenuRunControl } from "./SessionActionsMenu";
import { useReplyActions } from "../../hooks/useReplyActions";
import { useAnimationWindow } from "../../hooks/useAnimationWindow";
import { chatContentWidthStyle } from "./chatContentWidth";
import { TerminalDockPanel, TERMINAL_PANEL_COLLAPSED_SIZE, TERMINAL_PANEL_MIN_SIZE } from "../terminal/TerminalDockPanel";
import type { TerminalDockSettings } from "../terminal/TerminalDock";
import { useSessionPaneServices } from "./SessionPaneServices";
import { COMPOSER_MAX_HEIGHT, COMPOSER_MIN_HEIGHT, TIMELINE_MIN_HEIGHT, displayProjectDirectoryName, redistributeTerminalAgainstTimeline, shouldMountBottomComposer, sessionResizableGroupKey, sessionGroupDefaultLayout } from "../../rendererUtils";
import { projectByIdAtomFamily, sessionRecordByIdAtomFamily, sessionStatusInSidebarAtomFamily } from "../../atoms";
import type { EnqueuePromptSnapshot } from "../../hooks/useSessionSend";
import { countUserTurns } from "./timeline/turnRenderWindow";

const TERMINAL_PROGRAMMATIC_PROTECT_MS = 250;

export type SessionViewProps = {
	sessionId: string;
	sessionTitle: string;
	sessionTimeline: SessionTimelineController;

	splitPane?: boolean;
	focused?: boolean;
	onFocusPane?: () => void;
	activeAgentId?: string;
	activeAgent?: {
		noSession?: boolean;
		status?: string;
	} | null;
	hasActiveConversation: boolean;
	hasProject: boolean;

	chatHeaderRef: RefObject<HTMLDivElement | null>;
	composerRef: RefObject<HTMLElement | null>;
	composerOffsetHeight: number;
	terminalRowHeight: number;

	isAgentStarting: boolean;
	isRestarting: boolean;

	runControl?: SessionMenuRunControl;

	menu?: SessionMenuModel;
	sessionDuration?: number;

	showThinking: boolean;
	validCommandNames: Set<string>;
	validFilePaths: Set<string>;
	onPreviewImage: (image: ImageContent) => void;
	onOpenFile?: (path: string) => void;
	onDiffFile?: (path: string) => void;
	onResendUserMessage?: (message: ChatMessage) => void;
	onEditMessage?: (message: ChatMessage, newText: string) => void;
	onDeleteMessage?: (messageId: string, entryId?: string) => void;
	onRemoveMessageImage?: (message: ChatMessage, index: number) => void;
	onForkMessage?: (message: ChatMessage) => void;
	onRewindToMessage?: (message: ChatMessage) => void;
	forkingMessageId?: string | null;
	onToast: (message: string) => void;
	onQuickPrompt?: (prompt: string) => void;
	canMutateActiveMessages: boolean;

	onOpenBranchSession?: (sessionId: string) => void;

	enqueueSessionPrompt: (sessionId: string, snapshot: EnqueuePromptSnapshot) => boolean;
	gitInfo?: GitBranchInfo;

	onSwitchBranch?: (branch: string) => void;
	ensureSessionId?: (sessionId: string) => Promise<string>;
	queuePanel?: ReactNode;

	askPanelVisible?: boolean;
	runtimeUi?: ReactNode;

	terminalDockVisible: boolean;
	terminalOpen: boolean;
	terminalDockClosing: boolean;
	terminalCollapsed: boolean;
	availableTerminalHeight: number;

	terminalOwnerKey?: string;

	terminalTarget?: TerminalTarget;
	setTerminalOpenForOwner: (open: boolean) => void;
	setTerminalCollapsedForOwner: (collapsed: boolean) => void;

	setTerminalHeight: (height: number) => void;

	terminalSettings: TerminalDockSettings;

	onTerminalThemeChange: (themeId: TerminalThemeId) => void;

	settingsOpen: boolean;
	environmentDialog: boolean;

	runCreateSessionDraft: () => void;
	abortAgent: () => void;
};

export function SessionView({
	sessionId,
	sessionTitle,
	sessionTimeline,
	splitPane = false,
	focused = true,
	onFocusPane,
	activeAgentId,
	activeAgent,
	hasActiveConversation,
	hasProject,
	chatHeaderRef,
	composerRef,
	composerOffsetHeight: _composerOffsetHeight,
	terminalRowHeight,
	isAgentStarting,
	isRestarting,
	runControl,
	menu,
	sessionDuration,
	showThinking,
	validCommandNames,
	validFilePaths,
	onPreviewImage,
	onOpenFile,
	onDiffFile,
	onResendUserMessage,
	onEditMessage,
	onDeleteMessage,
	onRemoveMessageImage,
	onForkMessage,
	onRewindToMessage,
	forkingMessageId,
	onToast,
	onQuickPrompt,
	canMutateActiveMessages: _canMutateActiveMessages,
	onOpenBranchSession,
	enqueueSessionPrompt,
	gitInfo,
	onSwitchBranch,
	ensureSessionId,
	queuePanel,
	askPanelVisible = false,
	runtimeUi,
	terminalDockVisible,
	terminalOpen,
	terminalDockClosing,
	terminalCollapsed,
	availableTerminalHeight,
	terminalOwnerKey,
	terminalTarget,
	setTerminalOpenForOwner,
	setTerminalCollapsedForOwner,
	setTerminalHeight,
	terminalSettings,
	onTerminalThemeChange,
	settingsOpen,
	environmentDialog,
	runCreateSessionDraft,
	abortAgent: _abortAgent,
}: SessionViewProps) {
	const paneServices = useSessionPaneServices();

	const [replyActionsTarget, setReplyActionsTarget] = useState<HTMLDivElement | null>(null);

	const { items: replyActionRuleItems } = useReplyActions();

	const sessionRecord = useAtomValue(sessionRecordByIdAtomFamily(sessionId));
	const project = useAtomValue(projectByIdAtomFamily(sessionRecord?.projectId ?? ""));
	const projectName = project ? displayProjectDirectoryName(project) : undefined;

	const terminalPanelRef = useRef<PanelImperativeHandle | null>(null);
	const sessionGroupRef = useRef<GroupImperativeHandle | null>(null);
	const terminalProgrammaticExpireRef = useRef(0);

	const terminalCollapseAnimating = useAnimationWindow(terminalCollapsed, 200);

	const terminalPanelVisible = !isLanWeb && !settingsOpen && !environmentDialog && terminalDockVisible && terminalOpen;

	const bottomComposerVisible = shouldMountBottomComposer({
		hasActiveConversation,
		messageCount: sessionTimeline.messages.length,
		isConversationLoading: sessionTimeline.isSurfaceLoading,
	});

	const statusInSidebar = useAtomValue(sessionStatusInSidebarAtomFamily(sessionId));
	const sessionPanels = { terminal: terminalPanelVisible };
	const timelineColumnMinSize = bottomComposerVisible ? TIMELINE_MIN_HEIGHT + COMPOSER_MIN_HEIGHT : TIMELINE_MIN_HEIGHT;
	const timelineColumnStyle = {
		"--session-timeline-min": `${TIMELINE_MIN_HEIGHT}px`,
	} as CSSProperties;

	const askMaxHeight = `calc(100% - var(--session-timeline-min, ${TIMELINE_MIN_HEIGHT}px))`;
	const composerMaxHeight = askPanelVisible ? "0px" : `min(${COMPOSER_MAX_HEIGHT}px, calc(100% - var(--session-timeline-min, ${TIMELINE_MIN_HEIGHT}px)))`;

	const handleOpenExternal = useCallback((url: string, forceSystem?: boolean) => api.app.openExternal(url, forceSystem), []);
	const timelineInteractionProps = useMemo(
		() => ({
			instantSessionSwitch: paneServices.simpleNavigation,
			hasProject,
			onCreateSession: runCreateSessionDraft,
			showThinking,
			validCommandNames,
			validFilePaths,
			onPreviewImage,
			onOpenExternal: handleOpenExternal,
			onOpenFile,
			onDiffFile,
			onResendUserMessage,
			onEditMessage,
			onDeleteMessage,
			onRemoveMessageImage,
			onForkMessage,
			onRewindToMessage,
			forkingMessageId,
			onToast,
			onQuickPrompt,
			replyActionsRef: setReplyActionsTarget,
		}),
		[
			paneServices.simpleNavigation,
			hasProject,
			runCreateSessionDraft,
			showThinking,
			validCommandNames,
			validFilePaths,
			onPreviewImage,
			handleOpenExternal,
			onOpenFile,
			onDiffFile,
			onResendUserMessage,
			onEditMessage,
			onDeleteMessage,
			onRemoveMessageImage,
			onForkMessage,
			onRewindToMessage,
			forkingMessageId,
			onToast,
			onQuickPrompt,
		],
	);

	useEffect(() => {
		const panel = terminalPanelRef.current;
		if (!panel) return;
		const frame = requestAnimationFrame(() => {
			try {
				terminalProgrammaticExpireRef.current = Date.now() + TERMINAL_PROGRAMMATIC_PROTECT_MS;
				const terminalSize = terminalPanelRef.current?.getSize();
				if (!terminalSize || terminalSize.inPixels <= 0 || terminalSize.asPercentage <= 0) return;
				const groupPx = (terminalSize.inPixels / terminalSize.asPercentage) * 100;
				const terminalTargetPx = terminalCollapsed ? TERMINAL_PANEL_COLLAPSED_SIZE : Math.max(TERMINAL_PANEL_MIN_SIZE, Math.min(terminalRowHeight, availableTerminalHeight));
				const terminalPct = Math.min(100, (terminalTargetPx / groupPx) * 100);
				const layout = sessionGroupRef.current?.getLayout();
				if (!layout || layout.timeline === undefined || layout.terminal === undefined) return;
				const next = redistributeTerminalAgainstTimeline(layout, terminalPct, (timelineColumnMinSize / groupPx) * 100);
				if (next) sessionGroupRef.current?.setLayout(next);
			} catch {}
		});
		return () => cancelAnimationFrame(frame);
	}, [availableTerminalHeight, terminalCollapsed, terminalDockVisible, terminalOpen, terminalRowHeight, timelineColumnMinSize]);

	return (
		<div className={splitPane ? `session-split-pane flex h-full min-h-0 flex-col${focused ? " session-split-pane-focused" : ""}` : "contents"} onMouseDown={splitPane ? () => onFocusPane?.() : undefined}>
			{(!paneServices.simpleNavigation || splitPane) && (
				<SessionHeader
					headerRef={chatHeaderRef}
					statusSessionId={sessionId}
					title={sessionTitle}
					projectName={projectName}
					paneTitle={splitPane ? sessionTitle : undefined}
					onExitSplit={splitPane ? () => paneServices.exitSessionSplit(sessionId) : undefined}
					isAnonymous={activeAgent?.noSession}
					duration={sessionDuration}
					isStarting={isAgentStarting}
					runControl={runControl}
					menu={menu}
				/>
			)}

			<SessionBranchBar sessionId={sessionId} onOpenSession={onOpenBranchSession} />
			<ResizablePanelGroup
				key={`${sessionId}:${sessionResizableGroupKey(sessionPanels)}`}
				orientation="vertical"
				className="session-v-group"
				data-terminal-collapse-anim={terminalCollapseAnimating || undefined}
				groupRef={sessionGroupRef}
				defaultLayout={sessionGroupDefaultLayout(sessionPanels, terminalCollapsed ? TERMINAL_PANEL_COLLAPSED_SIZE : terminalRowHeight, Math.max(1, window.innerHeight - 120))}
				resizeTargetMinimumSize={{ fine: 20, coarse: 24 }}
			>
				<ResizablePanel id="timeline" minSize={timelineColumnMinSize} className="session-v-timeline flex min-h-0 flex-col" style={timelineColumnStyle}>
					<div className="session-v-timeline-stage min-h-[var(--session-timeline-min,160px)] flex-1 overflow-hidden">
						<SessionSurfaceStage sessionId={sessionId} sessionTimeline={sessionTimeline} isRestarting={isRestarting} isReloading={Boolean(runControl?.isReloading)} timelineProps={timelineInteractionProps} />
					</div>
					{/* 提问卡不随时间线滚动，用户上翻历史时仍常驻可见。宽度与消息列/输入框同源（chatContentWidthStyle + scrollbar-gutter）；内容超出「列高 - 对话区保底」时由本层滚动，时间线仍是唯一的消息滚动 owner。必须用 askPanelVisible 而不是仅 runtimeUi 门控。 */}
					{runtimeUi && askPanelVisible ? (
						<div className="session-v-ask min-h-0 shrink-0 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]" style={{ maxHeight: askMaxHeight }} aria-live="polite">
							<div className="pb-2" style={chatContentWidthStyle}>
								{runtimeUi}
							</div>
						</div>
					) : null}
					{bottomComposerVisible && (
						<div
							className="session-v-composer flex min-h-0 shrink-0 flex-col overflow-hidden [scrollbar-gutter:stable]"
							style={{
								maxHeight: composerMaxHeight,
							}}
							inert={askPanelVisible}
							aria-hidden={askPanelVisible || undefined}
						>
							<ComposerArea
								ref={composerRef}
								sessionId={sessionId}
								turnCount={sessionTimeline.totalTurns}
								gitInfo={gitInfo}
								onSwitchBranch={onSwitchBranch}
								enqueue={enqueueSessionPrompt}
								ensureSessionId={ensureSessionId}
								queuePanel={queuePanel}
								widgets={
									<>
										{!statusInSidebar && <SessionTodoStrip sessionId={sessionId} />}
										{/* 子代理条不再作为 composer 上方的常驻卡片：它属于本轮结论，而不是下一轮的输入。 */}
										{!statusInSidebar && <SessionSubagentsStrip sessionId={sessionId} onOpenChildSession={onOpenBranchSession} />}
									</>
								}
								replyActionMessages={sessionTimeline.messages}
								replyActionRules={replyActionRuleItems}
								replyActionsTarget={replyActionsTarget}
								replyActionsBlocked={askPanelVisible || isRestarting || isAgentStarting || sessionTimeline.isSurfaceLoading}
							/>
						</div>
					)}
				</ResizablePanel>

				{terminalPanelVisible && (
					<TerminalDockPanel
						target={terminalTarget}
						panelRef={terminalPanelRef}
						open={terminalOpen}
						closing={terminalDockClosing}
						collapsed={terminalCollapsed}
						height={terminalRowHeight}
						maxHeight={availableTerminalHeight}
						terminal={api.terminal}
						terminalSettings={terminalSettings}
						onThemeChange={onTerminalThemeChange}
						ownerKey={terminalOwnerKey}
						isProgrammaticResize={() => Date.now() < terminalProgrammaticExpireRef.current}
						onOpenChange={setTerminalOpenForOwner}
						onCollapsedChange={setTerminalCollapsedForOwner}
						onHeightChange={setTerminalHeight}
					/>
				)}
			</ResizablePanelGroup>
		</div>
	);
}
