import { useState, useRef, useEffect, useMemo, type ReactNode } from "react";
import {
	Archive,
	Boxes,
	Check,
	CircleAlert,
	CircleDot,
	CircleStop,
	Clock,
	Code2,
	Copy,
	Download,
	FileDown,
	FileText,
	Filter,
	Fingerprint,
	Folder,
	FolderSearch,
	GitBranch,
	Link2,
	List,
	LoaderCircle,
	ArrowUpDown,
	MessageCircle,
	Pencil,
	Pin,
	PinOff,
	Play,
	Plus,
	PanelRight,
	ListRestart,
	RefreshCcw,
	Radio,
	RefreshCw,
	RotateCw,
	ScrollText,
	Settings2,
	SquarePen,
	Trash2,
	UserPlus,
	XCircle,
} from "lucide-react";
import { t } from "../../i18n";
import { copyTextWithCopiedNotice } from "../../utils/clipboardNotice";
import { canRunSessionAction, type SessionReloadMode, type SessionRunAction, type SessionRunCapabilities } from "../../utils/sessionCommands";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../ui-shadcn/alert-dialog";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../ui-shadcn/dialog";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "../ui-shadcn/dropdown-menu";
import { Button } from "../ui-shadcn/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui-shadcn/table";
import type { SessionSummary, Project, AgentTab, ArchivedPiSession, SessionSortModeId } from "../../../../shared/types";
import { SESSION_SORT_MODES, resolveSessionSortMode } from "../../sessionSortModes";
import { worktreeSlugify } from "../../../../shared/worktreeSlug";
import { SessionSourceBadge, SessionBackendMark, SessionChannelMark, SideTaskMark, ImageGenSourceBadge } from "../session/SessionSourceBadge";
import { Checkbox } from "../ui-shadcn/checkbox";
import { Input } from "../ui-shadcn/input";
import { Label } from "../../components/ui-shadcn/label";
import { SESSION_FILTER_PILLS, filterSessionsByPills, pillsPresentIn, type SessionFilterPill } from "../../sessionFilterPills";
import { archivedPiWorkspaceLabel, filterArchivedPiByFamily, managerArchivedRowKey, mergeManagerArchived, sessionManagerRowKey, sessionWorkspaceLabel, worktreeFamilyProjects, type ManagerArchivedRow } from "../../sessionManagerModel";

function WorkspaceTag(props: { label: string }) {
	return (
		<span className="inline-flex shrink-0 items-center gap-0.5 rounded-xs border border-border-subtle bg-bg-muted px-1 py-px text-micro text-muted-foreground" title={t("sessionManager.workspaceTag", { name: props.label })}>
			<GitBranch size={10} strokeWidth={2} aria-hidden="true" />
			<span className="max-w-24 truncate">{props.label}</span>
		</span>
	);
}

export function SessionManagerModal(props: {
	sessions: SessionSummary[];

	projects: readonly Project[];

	projectId: string;
	onClose: () => void;
	onRename: (session: SessionSummary) => void;
	onExport: (session: SessionSummary) => void;
	onDelete: (sessions: SessionSummary[]) => void;

	onArchive: (sessions: SessionSummary[]) => Promise<void>;

	onUnarchive: (session: SessionSummary) => Promise<void>;

	listArchived: () => Promise<ArchivedPiSession[]>;

	deleteArchived: (archivedPath: string) => Promise<void>;
}) {
	const family = useMemo(() => worktreeFamilyProjects(props.projects, props.projectId), [props.projects, props.projectId]);

	const [activePills, setActivePills] = useState<Set<SessionFilterPill>>(new Set(SESSION_FILTER_PILLS));
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [selectAll, setSelectAll] = useState(false);

	const [showArchived, setShowArchived] = useState(false);
	const [archivedRows, setArchivedRows] = useState<ManagerArchivedRow[] | null>(null);

	const [archivedSelected, setArchivedSelected] = useState<Set<string>>(new Set());
	const [archivedSelectAll, setArchivedSelectAll] = useState(false);

	const [pendingDeleteArchived, setPendingDeleteArchived] = useState<ManagerArchivedRow[] | null>(null);

	const filteredSessions = useMemo(() => filterSessionsByPills(props.sessions, activePills), [props.sessions, activePills]);

	const togglePill = (pill: SessionFilterPill) => {
		setActivePills((prev) => {
			const next = new Set(prev);
			if (next.has(pill)) {
				next.delete(pill);
			} else {
				next.add(pill);
			}
			return next;
		});
		setSelected(new Set());
		setSelectAll(false);
	};

	const handleToggleAll = () => {
		if (selectAll) {
			setSelected(new Set());
		} else {
			setSelected(new Set(filteredSessions.map((s) => s.id)));
		}
		setSelectAll(!selectAll);
	};

	const handleToggle = (sessionId: string) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(sessionId)) {
				next.delete(sessionId);
			} else {
				next.add(sessionId);
			}
			setSelectAll(next.size === filteredSessions.length);
			return next;
		});
	};

	const handleArchiveSelected = () => {
		const toArchive = props.sessions.filter((s) => selected.has(s.id));
		if (toArchive.length === 0) return;
		void props
			.onArchive(toArchive)

			.catch(() => undefined)
			.finally(() => {
				setSelected(new Set());
				setSelectAll(false);
			});
	};

	const handleDeleteSelected = () => {
		const toDelete = props.sessions.filter((s) => selected.has(s.id));
		if (toDelete.length === 0) return;
		props.onDelete(toDelete);
	};

	const loadArchivedRows = () => {
		void props
			.listArchived()
			.then((piSessions) => {
				setArchivedRows(mergeManagerArchived(filterArchivedPiByFamily(piSessions, family)));
				setArchivedSelected(new Set());
				setArchivedSelectAll(false);
			})
			.catch(() => setArchivedRows([]));
	};

	const handleToggleAllArchived = () => {
		if (archivedSelectAll) {
			setArchivedSelected(new Set());
		} else {
			setArchivedSelected(new Set((archivedRows ?? []).map(managerArchivedRowKey)));
		}
		setArchivedSelectAll(!archivedSelectAll);
	};

	const handleToggleArchived = (key: string) => {
		setArchivedSelected((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			setArchivedSelectAll(next.size === (archivedRows?.length ?? 0));
			return next;
		});
	};

	const handleDeleteArchivedSelected = () => {
		const rows = (archivedRows ?? []).filter((row) => archivedSelected.has(managerArchivedRowKey(row)));
		if (rows.length === 0) return;
		setPendingDeleteArchived(rows);
	};

	return (
		<Dialog open onOpenChange={(next) => !next && props.onClose()}>
			<DialogContent showCloseButton={false} size="xl" className={cn("flex flex-col gap-0 overflow-hidden p-0")}>
				<DialogHeader className="flex-row items-center justify-between px-4 py-3">
					<DialogTitle>{t("menu.manageSessions")}</DialogTitle>
					<div className="flex items-center gap-2">
						<small className="text-muted-foreground">
							{filteredSessions.length} / {props.sessions.length} sessions
						</small>
						<DialogClose asChild>
							<Button variant="ghost" size="icon" aria-label={t("common.close")} title={t("common.close")}>
								<X size={18} strokeWidth={2.2} aria-hidden="true" />
							</Button>
						</DialogClose>
					</div>
				</DialogHeader>
				<div className="flex min-h-0 flex-1 flex-col overflow-hidden border-none bg-transparent shadow-none">
					<div className="flex shrink-0 items-center justify-between border-b border-border-subtle bg-bg-muted px-5 py-2.5">
						<div className="flex items-center gap-3.5">
							{!showArchived && (
								<>
									<Label className="flex cursor-pointer items-center gap-2 text-control text-text-secondary select-none">
										<Checkbox checked={selectAll} onCheckedChange={handleToggleAll} className="m-0 size-[15px] cursor-pointer accent-[var(--color-accent)]" />
										{t("common.selectAll")}
									</Label>
									<div className="flex items-center gap-1">
										{pillsPresentIn(props.sessions).map((pill) => (
											<Button
												key={pill}
												variant="outline"
												size="sm"
												className={`h-auto rounded-full border border-border-subtle bg-transparent px-3 py-1 text-caption font-medium text-text-tertiary transition-colors duration-fast hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]${activePills.has(pill) ? " border-[var(--color-accent)] bg-bg-active font-semibold text-[var(--color-accent)]" : ""}`}
												onClick={() => togglePill(pill)}
											>
												{t(pill === "imagegen" ? "sessionBackend.imagegen" : `sessionSource.${pill}`)}
											</Button>
										))}
									</div>
								</>
							)}
							{showArchived && (
								<Label className="flex cursor-pointer items-center gap-2 text-control text-text-secondary select-none">
									<Checkbox checked={archivedSelectAll} onCheckedChange={handleToggleAllArchived} className="m-0 size-[15px] cursor-pointer accent-[var(--color-accent)]" />
									{t("common.selectAll")}
								</Label>
							)}
						</div>
						<div className="flex items-center gap-2">
							{!showArchived && selected.size > 0 && (
								<Button variant="outline" size="sm" className="h-auto gap-1 border border-border-subtle px-3 py-1 text-caption font-medium text-text-tertiary transition-colors duration-fast hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]" onClick={handleArchiveSelected}>
									{t("sessionManager.archiveSelected", { count: selected.size })}
								</Button>
							)}
							{!showArchived && selected.size > 0 && (
								<Button
									variant="outline"
									size="sm"
									className="h-auto gap-1 border border-[color-mix(in_srgb,var(--color-danger)_28%,transparent)] px-3 py-1 text-caption font-medium text-[var(--color-danger)] shadow-none transition-colors duration-fast hover:border-[var(--color-danger)] hover:bg-[var(--color-danger-soft)]"
									onClick={handleDeleteSelected}
								>
									{t("common.deleteSelected", { count: selected.size })}
								</Button>
							)}
							{showArchived && archivedSelected.size > 0 && (
								<Button
									variant="outline"
									size="sm"
									className="h-auto gap-1 border border-[color-mix(in_srgb,var(--color-danger)_28%,transparent)] px-3 py-1 text-caption font-medium text-[var(--color-danger)] shadow-none transition-colors duration-fast hover:border-[var(--color-danger)] hover:bg-[var(--color-danger-soft)]"
									onClick={handleDeleteArchivedSelected}
								>
									{t("common.deleteSelected", { count: archivedSelected.size })}
								</Button>
							)}
							<Button
								variant="outline"
								size="sm"
								className={`h-auto gap-1 rounded-full border border-border-subtle bg-transparent px-3 py-1 text-caption font-medium transition-colors duration-fast hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]${showArchived ? " border-[var(--color-accent)] bg-bg-active font-semibold text-[var(--color-accent)]" : " text-text-tertiary"}`}
								onClick={() => {
									if (showArchived) {
										setShowArchived(false);

										setArchivedSelected(new Set());
										setArchivedSelectAll(false);
									} else {
										if (archivedRows === null) loadArchivedRows();
										setShowArchived(true);
									}
								}}
							>
								<Archive size={13} aria-hidden="true" />
								{t("sessionManager.archived")}
							</Button>
						</div>
					</div>

					<div className="flex-1 overflow-y-auto bg-bg-muted [scrollbar-gutter:stable]">
						{showArchived ? (
							<Table>
								<TableHeader>
									<TableRow className="bg-bg-muted hover:bg-bg-muted">
										<TableHead className="w-10" />
										<TableHead className="w-full">{t("sessionManager.session")}</TableHead>
										<TableHead className="w-40 text-right">{t("sessionManager.actions")}</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{archivedRows === null ? (
										<TableRow>
											<TableCell colSpan={3} className="py-6 text-center text-caption text-muted-foreground">
												…
											</TableCell>
										</TableRow>
									) : archivedRows.length === 0 ? (
										<TableRow>
											<TableCell colSpan={3} className="py-6 text-center text-caption text-muted-foreground">
												{t("sessionManager.archivedEmpty")}
											</TableCell>
										</TableRow>
									) : (
										archivedRows.map((row) => {
											const workspaceLabel = archivedPiWorkspaceLabel(row.item, family);
											const rowKey = managerArchivedRowKey(row);
											const isChecked = archivedSelected.has(rowKey);
											return (
												<TableRow key={rowKey} className="group bg-bg-panel" data-state={isChecked ? "selected" : undefined}>
													<TableCell className="w-10">
														<Label className="flex shrink-0 cursor-pointer items-center">
															<Checkbox checked={isChecked} onCheckedChange={() => handleToggleArchived(rowKey)} className="m-0 size-[15px] cursor-pointer accent-[var(--color-accent)]" />
														</Label>
													</TableCell>
													<TableCell className="w-full max-w-0">
														<div className="flex min-w-0 items-center gap-2">
															<span className="truncate text-control text-text-primary">{row.item.summary.name || row.item.summary.preview?.slice(0, 60) || t("common.untitled")}</span>
															{workspaceLabel && <WorkspaceTag label={workspaceLabel} />}
															{row.item.summary.source && row.item.summary.source !== "pi" && <SessionSourceBadge source={row.item.summary.source} />}
														</div>
													</TableCell>
													<TableCell className="w-40 text-right">
														<div className="flex items-center justify-end gap-0.5">
															<Button
																variant="ghost"
																size="sm"
																className="h-auto gap-[3px] rounded-xs px-2 text-caption text-text-tertiary transition-colors duration-fast hover:bg-bg-hover hover:text-[var(--color-accent)]"
																onClick={() => {
																	const restored = props.onUnarchive(row.item.summary);
																	void restored.then(loadArchivedRows);
																}}
																title={t("sessionManager.restore")}
															>
																{t("sessionManager.restore")}
															</Button>
															<Button variant="ghost" size="sm" className="h-auto gap-[3px] rounded-xs px-2 text-caption text-text-tertiary transition-colors duration-fast hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)]" onClick={() => setPendingDeleteArchived([row])} title={t("common.delete")}>
																<Trash2 size={12} aria-hidden="true" />
																{t("common.delete")}
															</Button>
														</div>
													</TableCell>
												</TableRow>
											);
										})
									)}
								</TableBody>
							</Table>
						) : (
							<Table>
								<TableHeader>
									<TableRow className="bg-bg-muted hover:bg-bg-muted">
										<TableHead className="w-10" />
										<TableHead className="w-full">{t("sessionManager.session")}</TableHead>
										<TableHead className="w-40 text-right">{t("sessionManager.actions")}</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{filteredSessions.map((session) => {
										const isChecked = selected.has(session.id);
										return (
											<TableRow key={sessionManagerRowKey(session)} className="group bg-bg-panel" data-state={isChecked ? "selected" : undefined}>
												<TableCell className="w-10">
													<Label className="flex shrink-0 cursor-pointer items-center">
														<Checkbox checked={isChecked} onCheckedChange={() => handleToggle(session.id)} className="m-0 size-[15px] cursor-pointer accent-[var(--color-accent)]" />
													</Label>
												</TableCell>
												<TableCell className="w-full max-w-0">
													<div className="flex min-w-0 cursor-pointer items-center gap-2" onClick={() => handleToggle(session.id)}>
														<span className="truncate text-control text-text-primary">{session.name || session.preview?.slice(0, 60) || t("common.untitled")}</span>

														{sessionWorkspaceLabel(session.projectId, family) && <WorkspaceTag label={sessionWorkspaceLabel(session.projectId, family)!} />}
														{session.backend === "imagegen" || session.backend === "acp" ? <SessionBackendMark backend={session.backend} /> : session.source && session.source !== "pi" && <SessionSourceBadge source={session.source} />}

														{session.channel && <SessionChannelMark channel={session.channel} />}
														{session.sideTask && <SideTaskMark />}
													</div>
												</TableCell>
												<TableCell className="w-40 text-right">
													<div className="flex items-center justify-end gap-0.5">
														<Button variant="ghost" size="sm" className="h-auto gap-[3px] rounded-xs px-2 text-caption text-text-tertiary transition-colors duration-fast hover:bg-bg-hover hover:text-[var(--color-accent)]" onClick={() => props.onRename(session)} title={t("common.rename")}>
															{t("common.rename")}
														</Button>
														<Button variant="ghost" size="sm" className="h-auto gap-[3px] rounded-xs px-2 text-caption text-text-tertiary transition-colors duration-fast hover:bg-bg-hover hover:text-[var(--color-accent)]" onClick={() => props.onExport(session)} title={t("menu.exportHtml")}>
															{t("menu.exportHtml")}
														</Button>
														<Button variant="ghost" size="sm" className="h-auto gap-[3px] rounded-xs px-2 text-caption text-text-tertiary transition-colors duration-fast hover:bg-bg-hover hover:text-[var(--color-accent)]" onClick={() => props.onArchive([session])} title={t("sessionManager.archiveAction")}>
															<Archive size={12} aria-hidden="true" />
															{t("sessionManager.archiveAction")}
														</Button>
														<Button variant="ghost" size="sm" className="h-auto gap-[3px] rounded-xs px-2 text-caption text-text-tertiary transition-colors duration-fast hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)]" onClick={() => props.onDelete([session])} title={t("common.delete")}>
															{t("common.delete")}
														</Button>
													</div>
												</TableCell>
											</TableRow>
										);
									})}
								</TableBody>
							</Table>
						)}
					</div>
				</div>
			</DialogContent>

			<AlertDialog
				open={pendingDeleteArchived !== null}
				onOpenChange={(next) => {
					if (!next) setPendingDeleteArchived(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t("sessionManager.deleteArchivedTitle")}</AlertDialogTitle>
						<AlertDialogDescription>
							{pendingDeleteArchived !== null && pendingDeleteArchived.length > 1
								? t("sessionManager.deleteArchivedBodyMany", { count: pendingDeleteArchived.length })
								: t("sessionManager.deleteArchivedBody", {
										name: pendingDeleteArchived === null || pendingDeleteArchived.length === 0 ? "" : pendingDeleteArchived[0].item.summary.name || pendingDeleteArchived[0].item.summary.preview?.slice(0, 60) || t("common.untitled"),
									})}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
						<AlertDialogAction
							className="bg-[var(--color-danger)] text-white hover:bg-[var(--color-danger)]"
							onClick={() => {
								const pending = pendingDeleteArchived;
								setPendingDeleteArchived(null);
								if (!pending || pending.length === 0) return;
								const deleting = Promise.all(pending.map((row) => props.deleteArchived(row.item.summary.filePath)));
								void deleting.then(loadArchivedRows).catch(() => loadArchivedRows());
							}}
						>
							{t("common.delete")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</Dialog>
	);
}

function MenuShell(props: { x: number; y: number; onClose: () => void; className?: string; children: ReactNode }) {
	return (
		<DropdownMenu
			open
			onOpenChange={(open) => {
				if (!open) props.onClose();
			}}
		>
			<DropdownMenuTrigger aria-hidden tabIndex={-1} style={{ position: "fixed", left: props.x, top: props.y, width: 0, height: 0, padding: 0, border: 0, background: "transparent", pointerEvents: "none" }} />
			<DropdownMenuContent align="start" side="bottom" className={props.className}>
				{props.children}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function SessionSourceFilterMenu(props: { menu: { projectId: string; x: number; y: number }; filter: ReadonlySet<SessionFilterPill> | null; onToggleSource: (source: SessionFilterPill) => void; onClear: () => void; onClose: () => void }) {
	const sources = SESSION_FILTER_PILLS;

	const pillLabels: Record<SessionFilterPill, string> = {
		pi: t("sessionSource.pi"),
		codex: t("sessionSource.codex"),
		claude: t("sessionSource.claude"),
		qoder: t("sessionSource.qoder"),
		opencode: t("sessionSource.opencode"),
		zcode: t("sessionSource.zcode"),
		workbuddy: t("sessionSource.workbuddy"),
		cursor: t("sessionSource.cursor"),
		kimi: t("sessionSource.kimi"),
		kimiwork: t("sessionSource.kimiwork"),
		minimax: t("sessionSource.minimax"),
		imagegen: t("sessionBackend.imagegen"),
	};

	return (
		<MenuShell x={props.menu.x} y={props.menu.y} onClose={props.onClose} className="min-w-44">
			<DropdownMenuLabel>{t("menu.filterSessions")}</DropdownMenuLabel>
			<DropdownMenuCheckboxItem
				checked={props.filter === null}
				onSelect={(event) => event.preventDefault()}
				onCheckedChange={(checked) => {
					if (checked) props.onClear();
				}}
			>
				{t("menu.filterSourceAll")}
			</DropdownMenuCheckboxItem>
			<DropdownMenuSeparator />
			{sources.map((pill) => (
				<DropdownMenuCheckboxItem key={pill} checked={props.filter !== null && props.filter.has(pill)} onSelect={(event) => event.preventDefault()} onCheckedChange={() => props.onToggleSource(pill)}>
					{pill === "imagegen" ? <ImageGenSourceBadge /> : <SessionSourceBadge source={pill} />}
					<span className="text-body">{pillLabels[pill]}</span>
				</DropdownMenuCheckboxItem>
			))}
		</MenuShell>
	);
}

export function ProjectContextMenu(props: {
	menu: { x: number; y: number; project: Project };
	onClose: () => void;
	onNewSession: () => void;
	onNewAnonymousSession: () => void;
	onRevealProject: () => void;
	onOpenWithEditor: () => void;
	onImportCodexSessions: () => void;
	onImportClaudeSessions: () => void;
	onImportQoderSessions: () => void;
	onImportOpenCodeSessions: () => void;
	onImportZCodeSessions: () => void;
	onImportWorkBuddySessions: () => void;
	onImportCursorSessions: () => void;
	onImportKimiSessions: () => void;

	onImportKimiWorkSessions: () => void;

	onImportMinimaxSessions: () => void;

	onImportDirectorySessions: () => void;
	onManageProjectResources: () => void;

	onManageAutomations?: () => void;
	onManageSessions: () => void;
	onFilterSessions: () => void;
	onToggleWorktree: () => void;
	onRefreshProject: () => void;
	onCopyProjectPath: () => void;
	onRemoveProject: () => void;

	onRenameProject: () => void;

	isPinned?: boolean;
	onTogglePin?: () => void;

	sessionSortMode?: SessionSortModeId;
	onSetSessionSortMode?: (mode: SessionSortModeId) => void;

	onRemoveWorktree?: () => void;

	onChatSettings?: () => void;
}) {
	const isWorktreeEnabled = props.menu.project.worktreeEnabled ?? false;
	return (
		<MenuShell x={props.menu.x} y={props.menu.y} onClose={props.onClose} className="min-w-56">
			<DropdownMenuLabel>{t("menu.group.create")}</DropdownMenuLabel>
			<DropdownMenuItem onSelect={props.onNewSession}>
				<SquarePen className="size-3.5" aria-hidden="true" />
				{t("app.newNormalSession")}
			</DropdownMenuItem>
			<DropdownMenuItem onSelect={props.onNewAnonymousSession}>
				<UserPlus className="size-3.5" aria-hidden="true" />
				{t("app.newAnonymousSession")}
			</DropdownMenuItem>
			<DropdownMenuSeparator />

			<DropdownMenuLabel>{t("menu.group.open")}</DropdownMenuLabel>
			<DropdownMenuItem onSelect={props.onRevealProject}>
				<FolderSearch className="size-3.5" aria-hidden="true" />
				{t("menu.revealProject")}
			</DropdownMenuItem>
			<DropdownMenuItem onSelect={props.onOpenWithEditor}>
				<Code2 className="size-3.5" aria-hidden="true" />
				{t("app.openWithEditor")}
			</DropdownMenuItem>
			<DropdownMenuItem onSelect={props.onCopyProjectPath}>
				<Link2 className="size-3.5" aria-hidden="true" />
				{t("menu.copyProjectPath")}
			</DropdownMenuItem>
			<DropdownMenuSeparator />

			<DropdownMenuLabel>{t("menu.group.manage")}</DropdownMenuLabel>

			{props.onTogglePin && (
				<DropdownMenuItem onSelect={props.onTogglePin}>
					{props.isPinned ? <PinOff className="size-3.5" aria-hidden="true" /> : <Pin className="size-3.5" aria-hidden="true" />}
					{t(props.isPinned ? "menu.unpinProject" : "menu.pinProject")}
				</DropdownMenuItem>
			)}

			{!props.menu.project.kind && !props.menu.project.worktreeParentId && (
				<DropdownMenuItem onSelect={props.onRenameProject}>
					<Pencil className="size-3.5" aria-hidden="true" />
					{t("menu.renameProject")}
				</DropdownMenuItem>
			)}

			{props.menu.project.kind === "chat" && props.onChatSettings && (
				<DropdownMenuItem onSelect={props.onChatSettings}>
					<Settings2 className="size-3.5" aria-hidden="true" />
					{t("app.chatProjectSettings")}
				</DropdownMenuItem>
			)}
			<DropdownMenuItem onSelect={props.onManageSessions}>
				<List className="size-3.5" aria-hidden="true" />
				{t("menu.manageSessions")}
			</DropdownMenuItem>
			{props.onManageAutomations && (
				<DropdownMenuItem onSelect={props.onManageAutomations}>
					<Clock className="size-3.5" aria-hidden="true" />
					{t("automation.title")}
				</DropdownMenuItem>
			)}

			{props.menu.project.kind !== "chat" && (
				<DropdownMenuItem onSelect={props.onManageProjectResources}>
					<Boxes className="size-3.5" aria-hidden="true" />
					{t("menu.projectResources")}
				</DropdownMenuItem>
			)}
			<DropdownMenuItem onSelect={props.onFilterSessions}>
				<Filter className="size-3.5" aria-hidden="true" />
				{t("menu.filterSessions")}
			</DropdownMenuItem>

			{props.onSetSessionSortMode && (
				<DropdownMenuSub>
					<DropdownMenuSubTrigger>
						<ArrowUpDown className="size-3.5" aria-hidden="true" />
						{t("menu.sessionSortMode")}
					</DropdownMenuSubTrigger>
					<DropdownMenuSubContent>
						<DropdownMenuRadioGroup value={props.sessionSortMode} onValueChange={(value) => props.onSetSessionSortMode?.(resolveSessionSortMode(value))}>
							{SESSION_SORT_MODES.map((option) => (
								<DropdownMenuRadioItem key={option.id} value={option.id}>
									{t(option.labelKey)}
								</DropdownMenuRadioItem>
							))}
						</DropdownMenuRadioGroup>
					</DropdownMenuSubContent>
				</DropdownMenuSub>
			)}
			<DropdownMenuItem onSelect={props.onRefreshProject}>
				<RefreshCw className="size-3.5" aria-hidden="true" />
				{t("app.projectRefresh")}
			</DropdownMenuItem>

			{props.menu.project.kind !== "chat" && (
				<DropdownMenuItem onSelect={props.onToggleWorktree}>
					<GitBranch className="size-3.5" aria-hidden="true" />
					{isWorktreeEnabled ? t("menu.disableWorktree") : t("menu.enableWorktree")}
				</DropdownMenuItem>
			)}

			{props.menu.project.kind !== "chat" && (
				<>
					<DropdownMenuSeparator />
					<DropdownMenuSub>
						<DropdownMenuSubTrigger>
							<Download className="size-3.5" aria-hidden="true" />
							{t("menu.importSessions")}
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent>
							<DropdownMenuItem onSelect={props.onImportCodexSessions}>{t("menu.importCodex")}</DropdownMenuItem>
							<DropdownMenuItem onSelect={props.onImportClaudeSessions}>{t("menu.importClaude")}</DropdownMenuItem>
							<DropdownMenuItem onSelect={props.onImportQoderSessions}>{t("menu.importQoder")}</DropdownMenuItem>
							<DropdownMenuItem onSelect={props.onImportOpenCodeSessions}>{t("menu.importOpenCode")}</DropdownMenuItem>
							<DropdownMenuItem onSelect={props.onImportZCodeSessions}>{t("menu.importZCode")}</DropdownMenuItem>
							<DropdownMenuItem onSelect={props.onImportWorkBuddySessions}>{t("menu.importWorkBuddy")}</DropdownMenuItem>
							<DropdownMenuItem onSelect={props.onImportCursorSessions}>{t("menu.importCursor")}</DropdownMenuItem>
							<DropdownMenuItem onSelect={props.onImportKimiSessions}>{t("menu.importKimi")}</DropdownMenuItem>
							<DropdownMenuItem onSelect={props.onImportKimiWorkSessions}>{t("menu.importKimiWork")}</DropdownMenuItem>
							<DropdownMenuItem onSelect={props.onImportMinimaxSessions}>{t("menu.importMinimax")}</DropdownMenuItem>

							<DropdownMenuSeparator />
							<DropdownMenuItem onSelect={props.onImportDirectorySessions}>{t("menu.importDirectorySessions")}</DropdownMenuItem>
						</DropdownMenuSubContent>
					</DropdownMenuSub>
					<DropdownMenuSeparator />

					<DropdownMenuItem variant="destructive" onSelect={props.onRemoveWorktree ?? props.onRemoveProject}>
						<Trash2 className="size-3.5" aria-hidden="true" />
						{props.onRemoveWorktree ? t("app.worktreeRemoveConfirmTitle") : t("menu.removeProject")}
					</DropdownMenuItem>
				</>
			)}
		</MenuShell>
	);
}

export type SidebarRunControl = {
	capabilities: SessionRunCapabilities;
	busy?: boolean;

	isStopping?: boolean;
	isRestarting?: boolean;
	isReloading?: boolean;

	reloadMode?: SessionReloadMode;

	agentId?: string;
	onAction: (action: SessionRunAction) => void;
};

async function copyAgentIdToClipboard(agentId: string) {
	await copyTextWithCopiedNotice(agentId);
}

function SidebarRunControlItems(props: { runControl: SidebarRunControl }) {
	const { runControl } = props;
	const capabilities = runControl.capabilities;
	const disabled = Boolean(runControl.busy) || capabilities.pending;

	const primaryDisabled = disabled || !canRunSessionAction(capabilities, "start");
	const abortDisabled = disabled || !canRunSessionAction(capabilities, "abort");
	const reloadMode = runControl.reloadMode ?? "none";
	const reloadEntryDisabled = disabled || !canRunSessionAction(capabilities, "reloadResources") || Boolean(runControl.isReloading);
	const reloadDisabled = disabled || !canRunSessionAction(capabilities, "reload") || Boolean(runControl.isReloading);

	const primaryLabel = runControl.isRestarting ? t("app.restarting") : capabilities.primaryAction === "start" ? t("menu.startAgent") : t("menu.restartSession");

	const agentId = runControl.agentId;

	return (
		<>
			<DropdownMenuSeparator />
			<DropdownMenuItem disabled={primaryDisabled} style={primaryDisabled ? { opacity: 0.4 } : undefined} onSelect={() => runControl.onAction(capabilities.primaryAction)}>
				<span className="inline-flex items-center gap-2">
					{capabilities.primaryAction === "start" ? <Play className="size-3.5" aria-hidden="true" /> : <RotateCw className="size-3.5" aria-hidden="true" />}
					{primaryLabel}
				</span>
			</DropdownMenuItem>
			<DropdownMenuItem disabled={abortDisabled} style={abortDisabled ? { opacity: 0.4 } : undefined} title={t("menu.stopAnswerHint")} onSelect={() => runControl.onAction("abort")}>
				<span className="inline-flex items-center gap-2">
					<CircleStop className="size-3.5" aria-hidden="true" />
					{t("menu.stopAnswer")}
				</span>
			</DropdownMenuItem>
			{reloadMode === "resources" ? (
				<DropdownMenuItem disabled={reloadEntryDisabled} style={reloadEntryDisabled ? { opacity: 0.4 } : undefined} title={t("menu.reloadResourcesHint")} onSelect={() => runControl.onAction("reloadResources")}>
					<span className="inline-flex items-center gap-2">
						<RefreshCcw className={cn("size-3.5", runControl.isReloading && "animate-pideck-spin")} aria-hidden="true" />
						{runControl.isReloading ? t("app.reloading") : t("menu.reloadResources")}
					</span>
				</DropdownMenuItem>
			) : null}
			<DropdownMenuItem disabled={reloadDisabled} style={reloadDisabled ? { opacity: 0.4 } : undefined} title={t("menu.reloadMessagesHint")} onSelect={() => runControl.onAction("reload")}>
				<span className="inline-flex items-center gap-2">
					<ListRestart className={cn("size-3.5", runControl.isReloading && "animate-pulse")} aria-hidden="true" />
					{runControl.isReloading ? t("app.reloading") : t("menu.reloadMessages")}
				</span>
			</DropdownMenuItem>

			{agentId ? (
				<DropdownMenuItem onSelect={() => void copyAgentIdToClipboard(agentId)}>
					<span className="inline-flex items-center gap-2">
						<Fingerprint className="size-3.5" aria-hidden="true" />
						{t("menu.copyAgentId")}
					</span>
				</DropdownMenuItem>
			) : null}
		</>
	);
}

export function AgentContextMenu(props: {
	menu: { x: number; y: number; agent: AgentTab };
	actionLoading?: "copy" | "export" | null;
	onClose: () => void;
	onRename: () => void;
	isPinned?: boolean;
	onTogglePinned?: () => void;
	onExport: () => void;
	onCopySession: () => void;
	onCopySessionFilePath: () => void;

	onOpenRpcLogging?: () => void;

	onToggleRpcLogging?: () => void;

	rpcToggleDisabled?: boolean;
	isRpcLogging?: boolean;

	onOpenLogs?: () => void;
	onOpenSessionFile?: () => void;

	runControl?: SidebarRunControl;

	onOpenProxySetting?: () => void;

	onCreateSideTask?: () => void;
	onCloseAgent: () => void;

	onDeleteSession?: () => void;
}) {
	const busy = Boolean(props.actionLoading);
	return (
		<MenuShell x={props.menu.x} y={props.menu.y} onClose={props.onClose}>
			<DropdownMenuItem disabled={busy} onSelect={props.onRename}>
				<Pencil className="size-3.5" aria-hidden="true" />
				{t("common.rename")}
			</DropdownMenuItem>
			{props.onTogglePinned && (
				<DropdownMenuItem disabled={busy} onSelect={props.onTogglePinned}>
					{props.isPinned ? <PinOff className="size-3.5" aria-hidden="true" /> : <Pin className="size-3.5" aria-hidden="true" />}
					{t(props.isPinned ? "menu.unpinSession" : "menu.pinSession")}
				</DropdownMenuItem>
			)}

			{props.onCreateSideTask && (
				<DropdownMenuItem disabled={busy} onSelect={props.onCreateSideTask}>
					<PanelRight className="size-3.5" aria-hidden="true" />
					{t("menu.createSideTask")}
				</DropdownMenuItem>
			)}

			{props.menu.agent.backend !== "acp" && props.menu.agent.backend !== "qoder" && (
				<DropdownMenuItem disabled={busy} onSelect={props.onCopySession}>
					{props.actionLoading === "copy" && <span className="mini-loader animate-pideck-spin" />}
					<Copy className="size-3.5" aria-hidden="true" />
					{props.actionLoading === "copy" ? t("menu.copying") : t("menu.copySession")}
				</DropdownMenuItem>
			)}
			{props.menu.agent.backend !== "acp" && props.menu.agent.backend !== "qoder" && (
				<DropdownMenuItem disabled={busy} onSelect={props.onExport}>
					{props.actionLoading === "export" && <span className="mini-loader animate-pideck-spin" />}
					<FileDown className="size-3.5" aria-hidden="true" />
					{props.actionLoading === "export" ? t("menu.exporting") : t("menu.exportHtml")}
				</DropdownMenuItem>
			)}
			{props.menu.agent.sessionPath && (
				<>
					<DropdownMenuItem disabled={busy} onSelect={props.onCopySessionFilePath}>
						<Link2 className="size-3.5" aria-hidden="true" />
						{t("menu.copySessionFilePath")}
					</DropdownMenuItem>
					{
						<DropdownMenuItem disabled={busy} onSelect={props.onOpenSessionFile}>
							<FileText className="size-3.5" aria-hidden="true" />
							{t("menu.openAgentSessionFile")}
						</DropdownMenuItem>
					}
				</>
			)}

			{props.runControl && <SidebarRunControlItems runControl={props.runControl} />}

			{props.onOpenProxySetting && props.menu.agent.backend !== "acp" && props.menu.agent.backend !== "qoder" && (
				<DropdownMenuItem disabled={busy} onSelect={props.onOpenProxySetting}>
					<Settings2 className="size-3.5" aria-hidden="true" />
					{t("menu.sessionProxy")}
				</DropdownMenuItem>
			)}
			<DropdownMenuSeparator />
			<DropdownMenuItem disabled={busy || props.rpcToggleDisabled} title={props.rpcToggleDisabled ? t("menu.rpcLoggingRequiresRuntime") : undefined} onSelect={props.onToggleRpcLogging ?? props.onOpenRpcLogging}>
				<Radio className="size-3.5" aria-hidden="true" />
				{props.isRpcLogging ? t("menu.rpcLoggingOn") : t("menu.rpcLogging")}
			</DropdownMenuItem>
			{props.isRpcLogging && (
				<DropdownMenuItem disabled={busy} onSelect={props.onOpenLogs}>
					<ScrollText className="size-3.5" aria-hidden="true" />
					{t("menu.rpcLogView")}
				</DropdownMenuItem>
			)}
			<DropdownMenuSeparator />
			<DropdownMenuItem variant="destructive" disabled={busy} title={t("menu.closeAgentHint")} onSelect={props.onCloseAgent}>
				<XCircle className="size-3.5" aria-hidden="true" />
				{t("menu.closeAgent")}
			</DropdownMenuItem>
			{props.onDeleteSession && (
				<DropdownMenuItem variant="destructive" disabled={busy} onSelect={props.onDeleteSession}>
					<Trash2 className="size-3.5" aria-hidden="true" />
					{t("common.delete")}
				</DropdownMenuItem>
			)}
		</MenuShell>
	);
}

export function DraftSessionContextMenu(props: {
	menu: { x: number; y: number };
	onClose: () => void;

	runControl?: SidebarRunControl;

	onCloseAgent?: () => void;
	onDelete: () => void;
}) {
	return (
		<MenuShell x={props.menu.x} y={props.menu.y} onClose={props.onClose}>
			{props.runControl && (
				<>
					<SidebarRunControlItems runControl={props.runControl} />
					<DropdownMenuSeparator />
				</>
			)}
			{props.onCloseAgent && (
				<>
					<DropdownMenuItem variant="destructive" title={t("menu.closeAgentHint")} onSelect={props.onCloseAgent}>
						<XCircle className="size-3.5" aria-hidden="true" />
						{t("menu.closeAgent")}
					</DropdownMenuItem>
					<DropdownMenuSeparator />
				</>
			)}
			<DropdownMenuItem variant="destructive" onSelect={props.onDelete}>
				<Trash2 className="size-3.5" aria-hidden="true" />
				{t("common.delete")}
			</DropdownMenuItem>
		</MenuShell>
	);
}

export function SessionContextMenu(props: {
	menu: { x: number; y: number; session: SessionSummary };
	actionLoading?: "copy" | "export" | null;
	onClose: () => void;
	onRename: () => void;
	isPinned?: boolean;
	onTogglePinned?: () => void;
	onExport: () => void;
	onCopySession: () => void;
	onCopySessionFilePath: () => void;
	onOpenSessionFile?: () => void;

	runControl?: SidebarRunControl;

	onOpenProxySetting?: () => void;

	onCreateSideTask?: () => void;

	hasFilePath?: boolean;

	canRpcLog?: boolean;
	rpcToggleDisabled?: boolean;
	isRpcLogging?: boolean;

	onOpenRpcLogging?: () => void;

	onToggleRpcLogging?: () => void;
	onOpenLogs?: () => void;

	onCloseAgent?: () => void;
	onArchiveSession: () => void;
	onDeleteSession: () => void;
}) {
	const busy = Boolean(props.actionLoading);

	const showRpcGroup = Boolean(props.canRpcLog);
	return (
		<MenuShell x={props.menu.x} y={props.menu.y} onClose={props.onClose}>
			<DropdownMenuItem disabled={busy} onSelect={props.onRename}>
				<Pencil className="size-3.5" aria-hidden="true" />
				{t("common.rename")}
			</DropdownMenuItem>
			{props.onTogglePinned && (
				<DropdownMenuItem disabled={busy} onSelect={props.onTogglePinned}>
					{props.isPinned ? <PinOff className="size-3.5" aria-hidden="true" /> : <Pin className="size-3.5" aria-hidden="true" />}
					{t(props.isPinned ? "menu.unpinSession" : "menu.pinSession")}
				</DropdownMenuItem>
			)}

			{props.onCreateSideTask && (
				<DropdownMenuItem disabled={busy} onSelect={props.onCreateSideTask}>
					<PanelRight className="size-3.5" aria-hidden="true" />
					{t("menu.createSideTask")}
				</DropdownMenuItem>
			)}

			{props.runControl && <SidebarRunControlItems runControl={props.runControl} />}

			{props.onOpenProxySetting && props.menu.session.backend !== "acp" && props.menu.session.backend !== "qoder" && (
				<DropdownMenuItem disabled={busy} onSelect={props.onOpenProxySetting}>
					<Settings2 className="size-3.5" aria-hidden="true" />
					{t("menu.sessionProxy")}
				</DropdownMenuItem>
			)}
			{props.menu.session.backend !== "acp" && props.menu.session.backend !== "qoder" && (
				<DropdownMenuItem disabled={busy} onSelect={props.onCopySession}>
					{props.actionLoading === "copy" && <span className="mini-loader animate-pideck-spin" />}
					<Copy className="size-3.5" aria-hidden="true" />
					{props.actionLoading === "copy" ? t("menu.copying") : t("menu.copySession")}
				</DropdownMenuItem>
			)}
			{props.menu.session.backend !== "acp" && props.menu.session.backend !== "qoder" && (
				<DropdownMenuItem disabled={busy} onSelect={props.onExport}>
					{props.actionLoading === "export" && <span className="mini-loader animate-pideck-spin" />}
					<FileDown className="size-3.5" aria-hidden="true" />
					{props.actionLoading === "export" ? t("menu.exporting") : t("menu.exportHtml")}
				</DropdownMenuItem>
			)}
			{props.hasFilePath !== false && (
				<>
					<DropdownMenuSeparator />
					<DropdownMenuItem disabled={busy} onSelect={props.onCopySessionFilePath}>
						<Link2 className="size-3.5" aria-hidden="true" />
						{t("menu.copySessionFilePath")}
					</DropdownMenuItem>
					{
						<DropdownMenuItem disabled={busy} onSelect={props.onOpenSessionFile}>
							<FileText className="size-3.5" aria-hidden="true" />
							{t("menu.openSessionFile")}
						</DropdownMenuItem>
					}
				</>
			)}
			{showRpcGroup && (
				<>
					<DropdownMenuItem disabled={busy || props.rpcToggleDisabled} title={props.rpcToggleDisabled ? t("menu.rpcLoggingRequiresRuntime") : undefined} onSelect={props.onToggleRpcLogging ?? props.onOpenRpcLogging}>
						<Radio className="size-3.5" aria-hidden="true" />
						{props.isRpcLogging ? t("menu.rpcLoggingOn") : t("menu.rpcLogging")}
					</DropdownMenuItem>
					{props.isRpcLogging && (
						<DropdownMenuItem disabled={busy} onSelect={props.onOpenLogs}>
							<ScrollText className="size-3.5" aria-hidden="true" />
							{t("menu.rpcLogView")}
						</DropdownMenuItem>
					)}
				</>
			)}
			<DropdownMenuSeparator />

			{props.onCloseAgent && (
				<DropdownMenuItem variant="destructive" disabled={busy} title={t("menu.closeAgentHint")} onSelect={props.onCloseAgent}>
					<XCircle className="size-3.5" aria-hidden="true" />
					{t("menu.closeAgent")}
				</DropdownMenuItem>
			)}

			{props.menu.session.backend !== "acp" && props.menu.session.backend !== "qoder" && (
				<DropdownMenuItem disabled={busy} onSelect={props.onArchiveSession}>
					<Archive className="size-3.5" aria-hidden="true" />
					{t("menu.archiveSession")}
				</DropdownMenuItem>
			)}
			<DropdownMenuItem variant="destructive" disabled={busy} onSelect={props.onDeleteSession}>
				<Trash2 className="size-3.5" aria-hidden="true" />
				{t("common.delete")}
			</DropdownMenuItem>
		</MenuShell>
	);
}
export function ProjectAvatar(props: { name: string; kind?: "chat" | "project"; status?: "idle" | "running" | "starting" | "error" }) {
	const StatusIcon = props.status === "running" ? LoaderCircle : props.status === "starting" ? CircleDot : props.status === "error" ? CircleAlert : null;
	return (
		<div className={cn("conversation-avatar project-avatar relative", props.kind === "chat" && "chat-avatar", props.status && `avatar-status-${props.status}`)} title={t("app.projectAvatarTitle", { name: props.name })} data-avatar-status={props.status ?? "idle"}>
			{props.kind === "chat" ? <MessageCircle size={16} strokeWidth={1.9} /> : <Folder size={16} strokeWidth={1.8} />}
			{StatusIcon && (
				<span className="avatar-status-indicator" aria-label={props.status}>
					<StatusIcon size={8} strokeWidth={2.5} className={props.status === "running" ? "animate-pideck-spin" : undefined} />
				</span>
			)}
		</div>
	);
}

type EntryAction = {
	active?: boolean;
	label: string;
	onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
	icon: ReactNode;
};
export function WorktreeCreateDialog(props: { projectId: string; creating: boolean; onCreate: (branchName: string) => void; onClose: () => void }) {
	const [name, setName] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	const previewSlug = useMemo(() => worktreeSlugify(name), [name]);

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) props.onClose();
			}}
		>
			<DialogContent className="sm:max-w-sm worktree-create-dialog">
				<DialogHeader>
					<DialogTitle>{t("app.worktreeCreateTitle")}</DialogTitle>
				</DialogHeader>
				<Input
					ref={inputRef}
					type="text"
					className="worktree-create-input"
					placeholder={t("app.worktreeCreatePlaceholder")}
					value={name}
					onChange={(e) => setName(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && name.trim()) {
							props.onCreate(name.trim());
						}
						if (e.key === "Escape") props.onClose();
					}}
					disabled={props.creating}
				/>
				{name.trim() && <p className="worktree-create-preview">{t("app.worktreeBranchPreview", { name: previewSlug })}</p>}
				<DialogFooter>
					<Button variant="outline" onClick={props.onClose} disabled={props.creating}>
						{t("common.cancel")}
					</Button>
					<Button disabled={!name.trim() || props.creating} onClick={() => props.onCreate(name.trim())}>
						{props.creating ? t("app.worktreeCreating") : t("app.worktreeCreate")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
