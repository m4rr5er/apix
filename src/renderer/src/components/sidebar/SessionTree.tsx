import { useEffect, useState, type ReactNode } from "react";
import { SidebarRemovalList, SidebarRemovalRow } from "./SidebarRemovalRow";
import { ChevronDown, ChevronUp, Ellipsis, HatGlasses, Image as ImageIcon, Pin, Trash2 } from "lucide-react";
import { useAtomValue } from "jotai";
import type { AgentTab, Project, SessionRecord, SessionSummary } from "../../../../shared/types";
import { collectDisplayedSessionIds, filterAgentsForSidebarDisplay, getProjectAgentSessionDisplay, type ProjectChildItem } from "../../agentListDisplay";
import { compareSessionsForSortMode } from "../../sessionSortModes";
import { sessionRecordToSummary } from "../../atoms";
import { sessionRuntimeUiByIdAtom } from "../../atoms/session-atoms";
import { t } from "../../i18n";
import { formatRelativeTime } from "../../utils/relativeTime";
import { hasPendingAskForSession } from "../../utils/askUi";
import { filterSidebarSessions, getBoundSidebarRuntimeAgent, type SidebarController } from "../../hooks/useSidebarController";
import { Button } from "../ui-shadcn/button";
import type { SidebarActions } from "./SidebarContent";
import { PendingAskBadge } from "./PendingAskBadge";
import { AcpBackendMark, SessionBackendMark, SessionChannelMark, SessionSourceBadge, SideTaskMark } from "../session/SessionSourceBadge";
import { isSessionExecutingStatus, SessionActivityIndicator } from "../session/SessionActivityIndicator";
import { SessionHoverCard } from "./SessionHoverCard";
import { TitleScrollText } from "./TitleScrollText";
import { resolveBoundSession } from "./activitySessionsModel";
import { cn } from "../../lib/utils";
import { SESSION_TAB_DRAG_MIME } from "../../utils/sessionSplitEdge";
import { useSessionActivityAt } from "../../hooks/sidebar/useSessionActivityClock";

const sessionRowClass =
	"group/resource conversation agent-row relative flex min-h-8 w-full items-center gap-1.5 rounded-lg border border-transparent px-2 py-0 text-left text-body text-foreground shadow-none transition-[background-color,border-color,box-shadow] duration-base hover:border-border-subtle hover:bg-bg-hover hover:text-foreground focus-visible:bg-bg-hover focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset";

const selectedRowClass = "active bg-bg-active text-foreground";

const rowMoreActionsClass = "row-more-actions pointer-events-none absolute top-1/2 right-1 -translate-y-1/2 opacity-0 transition-opacity group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100";

function rowMoreMenuActiveClass(menuOpen: boolean) {
	return cn(rowMoreActionsClass, menuOpen && "pointer-events-auto opacity-100");
}

const rowContainerClass = "group/row relative mt-0.5 flex min-h-8 items-center";

function matchesSearch(value: string, search: string) {
	return !search || value.toLowerCase().includes(search.toLowerCase());
}

function formatCodexSubagentName(session: SessionSummary) {
	return [session.codexAgentNickname, session.codexAgentRole].filter(Boolean).join(" · ") || session.name || t("app.codexSubagent");
}

function formatPiSubagentName(session: SessionSummary) {
	return session.name || t("app.piSubagent");
}

function renderRuntimeStatusDot(status: string | null | undefined, sessionId?: string) {
	return <SessionActivityIndicator status={status} sessionId={sessionId} />;
}

export function SessionTree(props: {
	project: Project;
	sessions: readonly SessionRecord[];
	agents: readonly AgentTab[];
	currentSessionId?: string;
	controller: SidebarController;
	actions: SidebarActions;
	nested?: boolean;
	visibleChildCount?: number;
	onShowMore?: () => void;

	emptyState?: ReactNode;
}) {
	const filter = props.controller.sourceFilterFor(props.project.id);
	const search = props.controller.search.trim();

	const sessionRuntimeUiById = useAtomValue(sessionRuntimeUiByIdAtom);

	const activityAt = useSessionActivityAt();
	const allSummaries = props.sessions.flatMap((session) => {
		const summary = sessionRecordToSummary(session);
		return summary ? [summary] : [];
	});
	const summaries = filterSidebarSessions(allSummaries, filter).filter((session) => matchesSearch(`${session.name ?? ""}${session.preview}${session.filePath}`, search));
	const projectAgents = props.agents.filter((agent) => agent.projectId === props.project.id);
	const displayAgents = filterAgentsForSidebarDisplay({
		agents: projectAgents,
		allSessions: allSummaries,
		visibleSessions: summaries,
		sources: filter,
	});
	const display = getProjectAgentSessionDisplay({
		agents: displayAgents,
		sessions: summaries,
		visibleChildCount: props.visibleChildCount ?? (props.nested ? Number.MAX_SAFE_INTEGER : props.controller.visibleChildCountFor(props.project.id)),
		pinnedSessionIds: props.controller.pinnedSessionIds,
		sortMode: props.controller.sessionSortMode,
	});
	const displayedSessionIds = collectDisplayedSessionIds(display.visibleChildren, (agent) => {
		const linked = resolveBoundSession(agent, props.sessions, props.controller.catalog.runtimeBySessionId) ?? (agent.sessionPath ? summaries.find((session) => session.filePath === agent.sessionPath) : undefined);
		return linked?.id;
	});
	const draftSessions = props.sessions
		.filter((session) => session.status === "draft")
		.filter((session) => !displayedSessionIds.has(session.id))
		.filter((session) => matchesSearch(session.title, search))
		.filter((session) => filter === null || filter.has(session.source))
		.sort((left, right) => compareSessionsForSortMode(left, right, props.controller.sessionSortMode));
	const catalogLoading = props.controller.catalog.catalogLoadStateByProject[props.project.id]?.status === "loading";
	const canCollapseChildren = props.controller.hasExpandedChildren(props.project.id);

	const showMoreLabel = props.nested ? t("app.worktreeShowMoreSessions", { count: display.hiddenChildCount }) : t("app.projectShowMoreChildren", { count: display.hiddenChildCount });

	const showMoreText = props.nested ? showMoreLabel : t("app.projectShowMoreChildren", { count: "" }).replace(/\s+$/, "");
	const collapseLabel = t("app.projectCollapseChildren");
	const hasRows = catalogLoading || draftSessions.length > 0 || display.visibleChildren.length > 0 || display.hiddenChildCount > 0;
	const [retainingExit, setRetainingExit] = useState(hasRows);
	useEffect(() => {
		if (hasRows) setRetainingExit(true);
	}, [hasRows]);

	if (!hasRows && !retainingExit) return props.emptyState ? <>{props.emptyState}</> : null;

	const openSession = (sessionId: string, tabMode?: "preview" | "permanent") => {
		void props.actions.sessions.open(props.project.id, sessionId, tabMode);
	};

	const sessionDragProps = (sessionId: string) => ({
		draggable: true,
		onDragStart: (event: React.DragEvent) => {
			event.dataTransfer.effectAllowed = "move";
			event.dataTransfer.setData(SESSION_TAB_DRAG_MIME, sessionId);

			event.dataTransfer.setData("text/plain", sessionId);
			props.actions.sessions.beginDrag?.(sessionId);
		},
		onDragEnd: () => {
			props.actions.sessions.endDrag?.();
		},
	});

	const openContext = (event: React.MouseEvent, session: SessionSummary, pinnable = true) => {
		event.preventDefault();
		const runtime = getBoundSidebarRuntimeAgent(props.controller.catalog, session.id);
		void props.controller.openMenu(runtime ? { kind: "agent", agentId: runtime.id, pinnable, x: event.clientX, y: event.clientY } : { kind: "session", projectId: props.project.id, sessionId: session.id, pinnable, x: event.clientX, y: event.clientY });
	};
	const openDraftContext = (event: React.MouseEvent, session: SessionRecord) => {
		event.preventDefault();
		const runtimeAgent = getBoundSidebarRuntimeAgent(props.controller.catalog, session.id);
		if (runtimeAgent) {
			void props.controller.openMenu({
				kind: "agent",
				agentId: runtimeAgent.id,
				pinnable: false,
				x: event.clientX,
				y: event.clientY,
			});
			return;
		}
		void props.controller.openMenu({
			kind: "draft",
			projectId: props.project.id,
			sessionId: session.id,
			x: event.clientX,
			y: event.clientY,
		});
	};
	const renderSubagent = (session: SessionSummary, title: string, badge?: ReactNode) => {
		return (
			<div key={session.id} className={rowContainerClass} onContextMenu={(event) => openContext(event, session, false)}>
				<SessionHoverCard session={session} title={title} projectName={props.project.name} disabled={Boolean(props.controller.menu)}>
					<button
						type="button"
						className={cn(sessionRowClass, "session-row codex-subagent-sidebar-row pl-2", session.id === props.currentSessionId && selectedRowClass)}
						onClick={() => openSession(session.id)}
						onDoubleClick={props.actions.sessions.simpleNavigation ? undefined : () => openSession(session.id, "permanent")}
						{...sessionDragProps(session.id)}
					>
						<div className="conversation-body min-w-0 flex-1 transition-[padding-right] group-hover/row:pr-7 group-focus-within/row:pr-7">
							<div className="conversation-title flex min-w-0 items-center gap-1.5">
								{badge}
								<TitleScrollText text={title} />
							</div>
						</div>
					</button>
				</SessionHoverCard>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					className={rowMoreMenuActiveClass(props.controller.menu?.kind === "session" && props.controller.menu.sessionId === session.id)}
					aria-label={t("sidebar.moreActions")}
					title={t("sidebar.moreActions")}
					onClick={(event) => {
						event.stopPropagation();
						openContext(event, session, false);
					}}
				>
					<Ellipsis size={14} aria-hidden="true" />
				</Button>
			</div>
		);
	};
	const renderSubagents = (parentKey: string, codex: SessionSummary[], pi: SessionSummary[]) => {
		if (codex.length + pi.length === 0 || !props.controller.expandedSubagentGroups.has(parentKey)) return null;

		return (
			<div className={cn("codex-subagent-sidebar-group", !props.nested && "ml-3")}>
				{codex.map((session) => renderSubagent(session, formatCodexSubagentName(session), <SessionSourceBadge source="codex" label={t("app.codexSubagent")} />))}
				{pi.map((session) => renderSubagent(session, formatPiSubagentName(session)))}
			</div>
		);
	};

	const renderToggle = (key: string, count: number) =>
		count > 0 ? (
			<span
				className="subagent-inline-toggle px-1 py-0.5 last:mr-7"
				title={t("app.piSubagentCount", { count })}
				onClick={(event) => {
					event.stopPropagation();
					props.controller.toggleSubagentGroup(key);
				}}
			>
				<ChevronDown size={8} className={props.controller.expandedSubagentGroups.has(key) ? "expanded" : ""} />

				<span className="subagent-inline-count inline-flex h-3.5 shrink-0 items-center rounded-full px-1 text-micro font-medium tabular-nums">{count}</span>
			</span>
		) : null;

	const renderChild = (child: ProjectChildItem) => {
		const groupKey = `${props.project.id}:${child.key}`;
		const childCount = child.codexSubagents.length + child.piSubagents.length;
		if (child.type === "agent") {
			const agentSession = resolveBoundSession(child.agent, props.sessions, props.controller.catalog.runtimeBySessionId) ?? (child.agent.sessionPath ? summaries.find((session) => session.filePath === child.agent.sessionPath) : undefined);

			const displayTitle = (agentSession ? ("title" in agentSession ? agentSession.title : agentSession.name || child.agent.title) : child.agent.title) || t("common.untitled");
			return (
				<SidebarRemovalRow key={child.key} itemId={agentSession?.id ?? child.agent.id}>
					<div
						className={rowContainerClass}
						onContextMenu={(event) => {
							event.preventDefault();
							void props.controller.openMenu({ kind: "agent", agentId: child.agent.id, x: event.clientX, y: event.clientY });
						}}
					>
						<SessionHoverCard session={agentSession} title={displayTitle} projectName={props.project.name} status={child.agent.status} disabled={Boolean(props.controller.menu)}>
							<button
								type="button"
								className={cn(sessionRowClass, agentSession?.id === props.currentSessionId && selectedRowClass)}
								onClick={() => {
									if (agentSession) openSession(agentSession.id);
								}}
								onDoubleClick={
									props.actions.sessions.simpleNavigation
										? undefined
										: () => {
												if (agentSession) openSession(agentSession.id, "permanent");
											}
								}
								{...(agentSession ? sessionDragProps(agentSession.id) : {})}
							>
								{props.actions.sessions.simpleNavigation ? <SessionActivityIndicator status={child.agent.status} sessionId={agentSession?.id} /> : renderRuntimeStatusDot(child.agent.status, agentSession?.id)}
								<div className="conversation-body min-w-0 flex-1 transition-[padding-right] group-hover/row:pr-7 group-focus-within/row:pr-7">
									<div className="conversation-title flex min-w-0 items-center gap-1.5">
										{child.agent.backend === "acp" ? <AcpBackendMark acpToolId={agentSession?.acpToolId} /> : !isSessionExecutingStatus(child.agent.status) && <SessionBackendMark backend={child.agent.backend} />}

										<TitleScrollText text={displayTitle} className="font-medium" />

										{hasPendingAskForSession(agentSession?.id, sessionRuntimeUiById) && <PendingAskBadge count={1} />}
										{agentSession?.sideTask && <SideTaskMark />}
										{child.agent.noSession && (
											<span className="anonymous-indicator" title={t("app.anonymousChat")}>
												<HatGlasses size={11} aria-hidden="true" />
											</span>
										)}
										{renderToggle(groupKey, childCount)}
									</div>
								</div>
							</button>
						</SessionHoverCard>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							className={rowMoreMenuActiveClass(props.controller.menu?.kind === "agent" && props.controller.menu.agentId === child.agent.id)}
							aria-label={t("sidebar.moreActions")}
							title={t("sidebar.moreActions")}
							onClick={(event) => {
								event.stopPropagation();
								const rect = event.currentTarget.getBoundingClientRect();
								void props.controller.openMenu({ kind: "agent", agentId: child.agent.id, x: rect.right, y: rect.bottom });
							}}
						>
							<Ellipsis size={14} aria-hidden="true" />
						</Button>
					</div>
					{renderSubagents(groupKey, child.codexSubagents, child.piSubagents)}
				</SidebarRemovalRow>
			);
		}
		const runtime = getBoundSidebarRuntimeAgent(props.controller.catalog, child.session.id);
		const runtimeSnapshot = props.controller.catalog.runtimeBySessionId[child.session.id];
		const pinned = props.controller.isSessionPinned(child.session.id);
		return (
			<SidebarRemovalRow key={child.session.id} itemId={child.session.id}>
				<div className={rowContainerClass} onContextMenu={(event) => openContext(event, child.session)}>
					<SessionHoverCard session={child.session} title={child.session.name} projectName={props.project.name} status={runtimeSnapshot?.status} disabled={Boolean(props.controller.menu)}>
						<button
							type="button"
							className={cn(
								sessionRowClass,

								"session-row history-session-row mx-0 min-h-8 pl-2 pr-2 py-0",
								child.session.id === props.currentSessionId && selectedRowClass,
							)}
							onClick={() => openSession(child.session.id)}
							onDoubleClick={props.actions.sessions.simpleNavigation ? undefined : () => openSession(child.session.id, "permanent")}
							{...sessionDragProps(child.session.id)}
						>
							{props.actions.sessions.simpleNavigation ? <SessionActivityIndicator status={runtimeSnapshot?.status} sessionId={child.session.id} /> : renderRuntimeStatusDot(runtimeSnapshot?.status, child.session.id)}
							{pinned && <Pin className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />}
							<div className="conversation-body min-w-0 flex-1 transition-[padding-right] group-hover/row:pr-7 group-focus-within/row:pr-7">
								<div className="conversation-title flex min-w-0 items-center gap-1.5">
									{child.session.backend === "acp" ? <AcpBackendMark acpToolId={child.session.acpToolId} /> : !isSessionExecutingStatus(runtimeSnapshot?.status) && <SessionBackendMark backend={child.session.backend} />}
									{child.session.source && child.session.source !== "pi" && <SessionSourceBadge source={child.session.source} />}
									{/* 标题被截断时 hover 滚动展示全文（TitleScrollText，未溢出则静止）；项目/标题栏徽章只给汇总数，多会话同时等待时分不清。 */}
									<TitleScrollText text={child.session.name || t("common.untitled")} className={cn(runtime ? "font-medium" : "font-normal text-muted-foreground/90")} />
									{hasPendingAskForSession(child.session.id, sessionRuntimeUiById) && <PendingAskBadge count={1} />}
									{child.session.backend !== "imagegen" && child.session.hasImageGen && <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
									{child.session.channel && <SessionChannelMark channel={child.session.channel} />}
									{child.session.sideTask && <SideTaskMark />}
									{renderToggle(groupKey, childCount)}
									{/* 基准是「计时点」而不是文件 mtime（见 hooks/sidebar/useSessionActivityClock）：本轮开始与 turn 结束各算一次，流式期间不会一直被重置成「刚刚」。窄侧栏时间可能被截断，title 提示完整相对时间。hover 用「宽度收拢」而不是 display:none，避免时间瞬时消失让左侧胶囊跳到行尾；w-max 保证非 hover 态宽度与 auto 一致，interpolate-size 让 max-content→0 可插值。 */}
									<span
										className="w-max shrink-0 overflow-hidden whitespace-nowrap text-micro tabular-nums text-muted-foreground transition-[width,opacity] [interpolate-size:allow-keywords] group-hover/row:w-0 group-hover/row:opacity-0 group-focus-within/row:w-0 group-focus-within/row:opacity-0"
										title={formatRelativeTime(activityAt(child.session.id, child.session.updatedAt))}
									>
										{formatRelativeTime(activityAt(child.session.id, child.session.updatedAt))}
									</span>
								</div>
							</div>
						</button>
					</SessionHoverCard>
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						className={rowMoreMenuActiveClass(props.controller.menu?.kind === "session" && props.controller.menu.sessionId === child.session.id)}
						aria-label={t("sidebar.moreActions")}
						title={t("sidebar.moreActions")}
						onClick={(event) => {
							event.stopPropagation();
							openContext(event, child.session);
						}}
					>
						<Ellipsis size={14} aria-hidden="true" />
					</Button>
				</div>
				{renderSubagents(groupKey, child.codexSubagents, child.piSubagents)}
			</SidebarRemovalRow>
		);
	};

	return (
		<div className={cn(props.nested ? "worktree-children m-0 border-0 bg-transparent p-0" : "session-card", "flex flex-col gap-0")}>
			<SidebarRemovalList
				remainingIds={[...props.sessions.map((session) => session.id), ...projectAgents.map((agent) => agent.id)]}
				onExitComplete={() => {
					if (!hasRows) setRetainingExit(false);
				}}
			>
				{draftSessions.map((session) => {
					const runtime = props.controller.catalog.runtimeBySessionId[session.id];
					return (
						<SidebarRemovalRow key={`draft:${session.id}`} itemId={session.id}>
							<div className={cn("draft-session-row group/draft grid items-center gap-1", "grid-cols-[minmax(0,1fr)_2rem]")} onContextMenu={(event) => openDraftContext(event, session)}>
								<SessionHoverCard session={session} title={session.title} projectName={props.project.name} status={runtime?.status} disabled={Boolean(props.controller.menu)}>
									<button
										type="button"
										className={cn(sessionRowClass, "session-row draft-session-trigger", session.id === props.currentSessionId && selectedRowClass)}
										onClick={() => openSession(session.id)}
										onDoubleClick={props.actions.sessions.simpleNavigation ? undefined : () => openSession(session.id, "permanent")}
										{...sessionDragProps(session.id)}
									>
										<div className="conversation-body min-w-0 flex-1 transition-[padding-right] group-hover/row:pr-7 group-focus-within/row:pr-7">
											<div className="conversation-title flex min-w-0 items-center gap-1.5">
												{props.actions.sessions.simpleNavigation ? <SessionActivityIndicator status={runtime?.status} sessionId={session.id} /> : renderRuntimeStatusDot(runtime?.status, session.id)}

												{session.backend === "acp" ? <AcpBackendMark acpToolId={session.acpToolId} /> : !isSessionExecutingStatus(runtime?.status) && <SessionBackendMark backend={session.backend} />}

												<TitleScrollText text={session.title || t("common.untitled")} className="font-medium" />

												{hasPendingAskForSession(session.id, sessionRuntimeUiById) && <PendingAskBadge count={1} />}

												{session.sideTask && <SideTaskMark />}
											</div>
										</div>
									</button>
								</SessionHoverCard>
								<Button variant="ghost" size="icon" className="draft-session-delete" aria-label={t("common.delete")} title={t("common.delete")} onClick={() => void props.actions.sessions.deleteDraft(session)}>
									<Trash2 size={14} aria-hidden="true" />
								</Button>
							</div>
						</SidebarRemovalRow>
					);
				})}
				{catalogLoading && (
					<div key="catalog-loading" className="project-session-loading">
						<div className="loader animate-pideck-spin" />
						<span>{t("app.projectSessionsLoading")}</span>
					</div>
				)}
				{display.visibleChildren.map(renderChild)}
			</SidebarRemovalList>

			{(display.hiddenChildCount > 0 || canCollapseChildren) && (
				<div className="flex min-w-0 items-center gap-1">
					{display.hiddenChildCount > 0 && (
						<Button
							variant="ghost"
							size="sm"
							className={`session-more-btn h-auto min-w-0 w-auto flex-1 justify-start px-2 text-micro opacity-80 transition-opacity hover:opacity-100 ${props.nested ? "worktree-sessions-more" : "session-more-row"}`}
							aria-label={showMoreLabel}
							title={showMoreLabel}
							onClick={props.onShowMore ?? (() => props.controller.showMoreChildren(props.project.id))}
						>
							<ChevronDown size={12} aria-hidden="true" />
							<span className="truncate">{showMoreText}</span>

							{!props.nested && <span className="ml-auto shrink-0 pl-1.5 tabular-nums">{display.hiddenChildCount}</span>}
						</Button>
					)}
					{canCollapseChildren && (
						<Button
							variant="ghost"
							size="sm"
							className={`h-auto shrink-0 w-auto justify-start px-2 text-micro opacity-80 transition-opacity hover:opacity-100 ${props.nested ? "worktree-sessions-more" : "session-more-row"}`}
							aria-label={collapseLabel}
							title={collapseLabel}
							onClick={() => props.controller.collapseChildren(props.project.id)}
						>
							<ChevronUp size={12} aria-hidden="true" />
							<span>{collapseLabel}</span>
						</Button>
					)}
				</div>
			)}
		</div>
	);
}
