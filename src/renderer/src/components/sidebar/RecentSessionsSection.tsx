import { ChevronDown, ChevronUp, Ellipsis } from "lucide-react";
import { useAtomValue } from "jotai";
import { sessionRecordToSummary } from "../../atoms/session-selectors";
import { sessionRuntimeUiByIdAtom } from "../../atoms/session-atoms";
import { hasPendingAskForSession } from "../../utils/askUi";
import { t } from "../../i18n";
import { cn } from "../../lib/utils";
import type { SidebarController } from "../../hooks/useSidebarController";
import type { SidebarActions } from "./SidebarContent";
import { Button } from "../ui-shadcn/button";
import { RemovalList, RemovalRow } from "../removal/RemovalList";
import { PendingAskBadge } from "./PendingAskBadge";
import { AcpBackendMark, SessionBackendMark, SessionChannelMark, SessionSourceBadge, SideTaskMark } from "../session/SessionSourceBadge";
import { isSessionExecutingStatus } from "../session/SessionActivityIndicator";
import { SidebarStatusDot } from "./SidebarStatusDot";
import { SessionHoverCard } from "./SessionHoverCard";
import { TitleScrollText } from "./TitleScrollText";
import { SESSION_TAB_DRAG_MIME } from "../../utils/sessionSplitEdge";
import { formatRelativeTime } from "../../utils/relativeTime";
import { useSessionActivityAt } from "../../hooks/sidebar/useSessionActivityClock";
import { RECENT_SESSIONS_INITIAL_VISIBLE, canCollapseRecent } from "./activitySessionsModel";
import type { RecentSessionRow } from "./activitySessionsModel";

const recentRowClass =
	"group/resource conversation agent-row relative flex min-h-8 w-full items-center gap-1.5 rounded-lg border border-transparent px-2 py-0 text-left text-body text-foreground shadow-none transition-[background-color,border-color,box-shadow] duration-base hover:border-border-subtle hover:bg-bg-hover hover:text-foreground focus-visible:bg-bg-hover focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset";

const selectedRowClass = "active bg-bg-active text-foreground";

const rowMoreActionsClass = "row-more-actions pointer-events-none absolute top-1/2 right-1 -translate-y-1/2 opacity-0 transition-opacity group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100";

const moreRowClass = "session-more-btn session-more-row h-auto min-w-0 w-auto flex-1 justify-start px-2 text-micro opacity-80 transition-opacity hover:opacity-100";

const collapseRowClass = "session-more-row h-auto shrink-0 w-auto justify-start px-2 text-micro opacity-80 transition-opacity hover:opacity-100";

export function RecentSessionsSection(props: { controller: SidebarController; actions: SidebarActions; currentSessionId?: string; rows: readonly RecentSessionRow[]; totalCount: number; visibleCount: number; onLoadMore: () => void; onCollapse: () => void }) {
	const sessionRuntimeUiById = useAtomValue(sessionRuntimeUiByIdAtom);

	if (props.rows.length === 0) return null;

	const shownCount = Math.min(props.visibleCount, props.totalCount);
	const remainingCount = Math.max(0, props.totalCount - props.visibleCount);

	const canCollapse = canCollapseRecent(props.visibleCount);
	const projectNamesById = new Map(props.controller.catalog.projects.map((project) => [project.id, project.name]));
	return (
		<section aria-label={t("app.sidebarRecentSessions")} className="mt-1 flex flex-col gap-0">
			<div className="sticky top-0 z-10 flex items-center gap-2 border-t border-border/40 bg-sidebar px-1 pt-1 pb-0.5">
				<span className="text-caption font-semibold text-muted-foreground">{t("app.sidebarRecentSessions")}</span>
				<span className="ml-auto shrink-0 text-caption tabular-nums text-muted-foreground" title={t("app.sidebarRecentShown", { shown: shownCount, total: props.totalCount })}>
					{shownCount}/{props.totalCount}
				</span>
			</div>
			{/* 访问时间排序，顺序变化不是用户动作，不开 orderSensitive。收起分页一次移除多行。 */}
			<RemovalList remainingIds={props.rows.map((row) => row.session.id)}>
				{props.rows.map((row) => (
					<RemovalRow key={row.session.id} itemId={row.session.id}>
						<RecentSessionRowItem row={row} projectName={projectNamesById.get(row.projectId)} controller={props.controller} actions={props.actions} currentSessionId={props.currentSessionId} sessionRuntimeUiById={sessionRuntimeUiById} />
					</RemovalRow>
				))}
			</RemovalList>
			{/* sticky bottom-0：仍在内容流里（保留自身行位，最后一行不会被盖住），内容高过本区时自动粘在下缘。观感与项目页「查看更多 / 收起」一致。 */}
			{(remainingCount > 0 || canCollapse) && (
				<div className="sticky bottom-0 z-20 flex min-w-0 items-center gap-1 bg-sidebar">
					{remainingCount > 0 && (
						<Button type="button" variant="ghost" size="sm" className={moreRowClass} aria-label={t("app.sidebarRecentLoadMore")} title={t("app.sidebarRecentLoadMoreHint", { count: remainingCount })} onClick={props.onLoadMore}>
							<ChevronDown size={12} aria-hidden="true" />
							<span className="truncate">{t("app.sidebarRecentLoadMore")}</span>
							<span className="ml-auto shrink-0 pl-1.5 tabular-nums">{remainingCount}</span>
						</Button>
					)}
					{canCollapse && (
						<Button type="button" variant="ghost" size="sm" className={collapseRowClass} aria-label={t("app.sidebarRecentCollapse")} title={t("app.sidebarRecentCollapseHint", { count: RECENT_SESSIONS_INITIAL_VISIBLE })} onClick={props.onCollapse}>
							<ChevronUp size={12} aria-hidden="true" />
							<span>{t("app.sidebarRecentCollapse")}</span>
						</Button>
					)}
				</div>
			)}
		</section>
	);
}

function RecentSessionRowItem(props: { row: RecentSessionRow; projectName?: string; controller: SidebarController; actions: SidebarActions; currentSessionId?: string; sessionRuntimeUiById: Parameters<typeof hasPendingAskForSession>[1] }) {
	const { row, controller } = props;

	const activityAt = useSessionActivityAt();

	const summary = sessionRecordToSummary(row.session);
	const sessionId = row.session.id;
	const runtime = controller.catalog.runtimeBySessionId[sessionId];
	if (!summary && !runtime) return null;
	const pendingAsk = hasPendingAskForSession(sessionId, props.sessionRuntimeUiById);
	const selected = sessionId === props.currentSessionId;
	const displayTitle = summary?.name || row.session.title || t("common.untitled");

	const openSession = (tabMode?: "preview" | "permanent") => {
		void props.actions.sessions.open(row.projectId, sessionId, tabMode);
	};
	const openMenu = (x: number, y: number) => {
		void controller.openMenu(runtime?.agentId ? { kind: "agent", agentId: runtime.agentId, x, y } : { kind: "session", projectId: row.projectId, sessionId, pinnable: true, x, y });
	};
	return (
		<div
			className="group/row relative mt-0.5 flex min-h-8 items-center"
			onContextMenu={(event) => {
				event.preventDefault();
				openMenu(event.clientX, event.clientY);
			}}
		>
			<SessionHoverCard session={row.session} title={displayTitle} projectName={props.projectName} status={runtime?.status} disabled={Boolean(controller.menu)}>
				<button
					type="button"
					className={cn(recentRowClass, "session-row history-session-row mx-0 min-h-8 pl-2 pr-2 py-0", selected && selectedRowClass)}
					onClick={() => openSession()}
					onDoubleClick={props.actions.sessions.simpleNavigation ? undefined : () => openSession("permanent")}
					draggable
					onDragStart={(event) => {
						event.dataTransfer.effectAllowed = "move";
						event.dataTransfer.setData(SESSION_TAB_DRAG_MIME, sessionId);

						event.dataTransfer.setData("text/plain", sessionId);
						props.actions.sessions.beginDrag?.(sessionId);
					}}
					onDragEnd={() => props.actions.sessions.endDrag?.()}
				>
					<div className="conversation-body min-w-0 flex-1 transition-[padding-right] group-hover/row:pr-7 group-focus-within/row:pr-7">
						<div className="conversation-title flex min-w-0 items-center gap-1.5">
							<SidebarStatusDot status={runtime?.status} sessionId={row.session.id} />

							{row.session.backend === "acp" ? <AcpBackendMark acpToolId={row.session.acpToolId} /> : <SessionBackendMark backend={row.session.backend} executing={isSessionExecutingStatus(runtime?.status)} />}
							{row.session.source && row.session.source !== "pi" && <SessionSourceBadge source={row.session.source} />}
							<TitleScrollText text={displayTitle} className={runtime ? "font-medium" : "font-normal text-muted-foreground/90"} />
							{pendingAsk && <PendingAskBadge count={1} />}
							{row.session.channel && <SessionChannelMark channel={row.session.channel} />}
							{row.session.sideTask && <SideTaskMark />}

							<span className="shrink-0 text-micro tabular-nums text-muted-foreground group-hover/row:hidden group-focus-within/row:hidden" title={formatRelativeTime(activityAt(sessionId, row.sortAt))}>
								{formatRelativeTime(activityAt(sessionId, row.sortAt))}
							</span>
						</div>
					</div>
				</button>
			</SessionHoverCard>
			<Button
				type="button"
				variant="ghost"
				size="icon-xs"
				className={cn(rowMoreActionsClass, controller.menu?.kind === "session" && controller.menu.sessionId === sessionId && "pointer-events-auto opacity-100")}
				aria-label={t("sidebar.moreActions")}
				title={t("sidebar.moreActions")}
				onClick={(event) => {
					event.stopPropagation();
					const rect = event.currentTarget.getBoundingClientRect();
					openMenu(rect.right, rect.bottom);
				}}
			>
				<Ellipsis size={14} aria-hidden="true" />
			</Button>
		</div>
	);
}
