import { cn } from "../../lib/utils";
import { useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronsDownUp, Folder, FolderTree, RefreshCw, X } from "lucide-react";
import { Button } from "../ui-shadcn/button";
import { Collapsible, CollapsibleContent } from "../ui-shadcn/collapsible";
import { FileSortControl } from "./FileSortControl";
import { sortFileNodes, FILE_SORT_OPTIONS, FILE_SORT_DEFAULT_DIRECTION, type FileSortMode, type FileSortDirection } from "../../utils/fileTreeSort";
import { compactMiddlePackages } from "../../utils/fileTreeCompact";
import { compactMiddlePackagesAtom, activeEditorFileAtom } from "../../atoms/app-ui-atoms";
import { t } from "../../i18n";
import type { WorkspaceDrawerPanel } from "../../hooks/useWorkspacePanels";
import type { FileTreeNode, Project, SessionSummary } from "../../../../shared/types";
import { FileSearch, Search } from "lucide-react";
import { useFileSearch } from "../../hooks/useFileSearch";
import { useFileTreeStickyAppearance } from "../../hooks/files/useFileTreeStickyAppearance";
import { useLazyListWindow } from "../../hooks/useLazyListWindow";
import { useFileTreeGitStatus } from "../../hooks/files/useFileTreeGitStatus";
import { useFileTreeGitStatusRefresh } from "../../hooks/files/useFileTreeGitStatusRefresh";
import { FileSearchResults } from "./FileSearchResults";
import { FILE_TREE_RENDER_BATCH } from "../../utils/fileTreeRenderBudget";
import { FileTreeNodeRow } from "./FileTreeRows";
import { SessionsPanel } from "./SessionHistoryPanel";
import { isEditableTarget, isFileSearchShortcut, isTypeToSearchKey } from "../../utils/fileSearchTrigger";

export { SessionHistoryModal } from "./SessionHistoryPanel";

type DiffFileHandler = (path: string, originalContent?: string, content?: string) => void;

type SessionModifiedFile = {
	path: string;
	toolName: string;
	status: string;
	changedLines?: number;
	originalContent?: string;
	content?: string;
};

export function DrawerContent(props: {
	panel: WorkspaceDrawerPanel;
	project?: Project;

	projectId?: string;
	files: FileTreeNode[];

	fileTreeContentRevision: number;
	sessions: SessionSummary[];
	sessionsLoading?: boolean;
	expandedDirs: Set<string>;
	onToggleDirectory: (path: string) => void;
	onCollapseAllDirectories: () => void;
	onClose: () => void;
	onFileContextMenu: (node: FileTreeNode, x: number, y: number) => void;
	onRefreshFiles: () => void;
	onOpenFolder?: () => void;
	onRefreshSessions: () => void;
	onOpenSession: (session: SessionSummary) => void;
	onRenameSession: (filePath: string, newName: string) => void;
	onCopySession: (session: SessionSummary) => void | Promise<void>;
	onExportSession: (session: SessionSummary) => void | Promise<void>;
	onDeleteSession: (session: SessionSummary) => void | Promise<void>;
	onOpenFile?: (path: string) => void;

	onViewFile?: (path: string, openMode?: "preview" | "permanent") => void;

	projectRoot?: string;

	onDropFiles?: (targetDir: string, files: FileList) => void;

	onPasteFiles?: (targetDir: string) => void;

	onMoveFiles?: (sourcePaths: string[], targetDir: string) => void;
}) {
	const title = props.panel === "files" ? null : props.project ? t("drawer.projectSessions", { name: props.project.name }) : t("drawer.historyTitle");
	return (
		<>
			{props.panel !== "files" && title && (
				<div className="drawer-header flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border/40 bg-bg-page-raised px-3">
					<strong className="truncate text-sm font-semibold text-foreground">{title}</strong>
					<div className="drawer-header-actions flex shrink-0 items-center gap-1">
						<Button type="button" variant="ghost" size="icon-sm" className="inline-grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground" title={t("drawer.closePanel")} aria-label={t("drawer.closePanel")} onClick={props.onClose}>
							<X size={16} />
						</Button>
					</div>
				</div>
			)}
			{props.panel === "files" && (
				<FilesPanel
					projectId={props.projectId ?? props.project?.id}
					files={props.files}
					fileTreeContentRevision={props.fileTreeContentRevision}
					expandedDirs={props.expandedDirs}
					onToggleDirectory={props.onToggleDirectory}
					onCollapseAll={props.onCollapseAllDirectories}
					onFileContextMenu={props.onFileContextMenu}
					onRefreshFiles={props.onRefreshFiles}
					onOpenFolder={props.onOpenFolder}
					onOpenFile={props.onOpenFile}
					onViewFile={props.onViewFile}
					projectRoot={props.projectRoot}
					onDropFiles={props.onDropFiles}
					onMoveFiles={props.onMoveFiles}
					onPasteFiles={props.onPasteFiles}
				/>
			)}
			{props.panel === "sessions" && <SessionsPanel sessions={props.sessions} onRefresh={props.onRefreshSessions} onOpen={props.onOpenSession} onRename={props.onRenameSession} onCopy={props.onCopySession} onExport={props.onExportSession} onDelete={props.onDeleteSession} />}
		</>
	);
}

function FilesPanel(props: {
	projectId?: string;
	files: FileTreeNode[];

	fileTreeContentRevision: number;
	expandedDirs: Set<string>;
	onToggleDirectory: (path: string) => void;
	onFileContextMenu: (node: FileTreeNode, x: number, y: number) => void;
	onRefreshFiles: () => void;

	onCollapseAll?: () => void;
	onOpenFolder?: () => void;
	onOpenFile?: (path: string) => void;

	onViewFile?: (path: string, openMode?: "preview" | "permanent") => void;

	projectRoot?: string;

	onDropFiles?: (targetDir: string, files: FileList) => void;

	onPasteFiles?: (targetDir: string) => void;

	onMoveFiles?: (sourcePaths: string[], targetDir: string) => void;
}) {
	const FILE_SORT_KEY = "pi-desktop:file-sort";
	const FILE_SORT_DIR_KEY = "pi-desktop:file-sort-dir";
	const [sortMode, setSortMode] = useState<FileSortMode>(() => {
		const saved = typeof window !== "undefined" ? localStorage.getItem(FILE_SORT_KEY) : null;
		return FILE_SORT_OPTIONS.some((o) => o.value === saved) ? (saved as FileSortMode) : "name";
	});
	const [sortDirection, setSortDirection] = useState<FileSortDirection>(() => {
		const saved = typeof window !== "undefined" ? localStorage.getItem(FILE_SORT_DIR_KEY) : null;
		return saved === "asc" || saved === "desc" ? saved : FILE_SORT_DEFAULT_DIRECTION["name"];
	});
	useEffect(() => {
		localStorage.setItem(FILE_SORT_KEY, sortMode);

		setSortDirection(FILE_SORT_DEFAULT_DIRECTION[sortMode]);
	}, [sortMode]);
	useEffect(() => {
		localStorage.setItem(FILE_SORT_DIR_KEY, sortDirection);
	}, [sortDirection]);

	const [compactPackages, setCompactPackages] = useAtom(compactMiddlePackagesAtom);

	const fileSearch = useFileSearch({ projectId: props.projectId });

	const gitStatus = useFileTreeGitStatus({ projectId: props.projectId, projectRoot: props.projectRoot });

	useFileTreeGitStatusRefresh(props.fileTreeContentRevision, gitStatus.refresh);
	const [searchOpen, setSearchOpen] = useState(false);

	const panelRef = useRef<HTMLDivElement | null>(null);

	const closeSearch = useCallback(() => {
		setSearchOpen(false);
		fileSearch.clearSearch();
		panelRef.current?.focus();
	}, [fileSearch]);

	const sortedFiles = useMemo(() => sortFileNodes(props.files, sortMode, sortDirection), [props.files, sortMode, sortDirection]);

	const displayFiles = useMemo(() => (compactPackages ? compactMiddlePackages(sortedFiles) : sortedFiles), [sortedFiles, compactPackages]);

	const [dragOverDir, setDragOverDir] = useState<string | null>(null);
	const dragCountRef = useRef(0);

	const activeEditorFile = useAtomValue(activeEditorFileAtom);

	const latestPropsRef = useRef(props);
	latestPropsRef.current = props;
	const stableToggleDirectory = useCallback((path: string) => latestPropsRef.current.onToggleDirectory(path), []);
	const stableFileContextMenu = useCallback((node: FileTreeNode, x: number, y: number) => latestPropsRef.current.onFileContextMenu(node, x, y), []);
	const stableOpenFile = useCallback((path: string) => latestPropsRef.current.onOpenFile?.(path), []);
	const stableViewFile = useCallback((path: string, openMode?: "preview" | "permanent") => latestPropsRef.current.onViewFile?.(path, openMode), []);
	const stableDropFiles = useCallback((targetDir: string, files: FileList) => latestPropsRef.current.onDropFiles?.(targetDir, files), []);
	const stableMoveFiles = useCallback((sourcePaths: string[], targetDir: string) => latestPropsRef.current.onMoveFiles?.(sourcePaths, targetDir), []);

	const rootWindow = useLazyListWindow(displayFiles, { pageSize: FILE_TREE_RENDER_BATCH, scrollRef: panelRef, resetKey: props.projectId });
	useFileTreeStickyAppearance(panelRef, rootWindow.visible, props.expandedDirs, !searchOpen);

	const handlePanelDragOver = (event: React.DragEvent) => {
		event.preventDefault();
		event.dataTransfer.dropEffect = "copy";
	};
	const handlePanelDrop = (event: React.DragEvent) => {
		event.preventDefault();
		setDragOverDir(null);
		dragCountRef.current = 0;
		if (event.dataTransfer.files.length > 0 && props.onDropFiles && props.projectRoot) {
			props.onDropFiles(props.projectRoot, event.dataTransfer.files);
		}
	};
	const handlePanelKeyDown = (event: React.KeyboardEvent) => {
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
			if (props.onPasteFiles && props.projectRoot) {
				props.onPasteFiles(props.projectRoot);
			}
			return;
		}

		if (!props.projectId) return;

		if (isFileSearchShortcut(event)) {
			if (isEditableTarget(event.target)) return;
			event.preventDefault();
			setSearchOpen(true);
			return;
		}

		if (searchOpen || isEditableTarget(event.target)) return;
		if (isTypeToSearchKey(event)) {
			event.preventDefault();
			setSearchOpen(true);
			fileSearch.setQuery(event.key);
		}
	};

	const handlePanelMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
		if (isEditableTarget(event.target)) return;
		event.currentTarget.focus();
	};
	const handlePanelContextMenu = (event: React.MouseEvent) => {
		if (event.target !== event.currentTarget) return;
		event.preventDefault();
		if (props.projectRoot) {
			props.onFileContextMenu(
				{
					path: props.projectRoot,
					name: "",
					type: "directory",
					relativePath: "",
					children: undefined,
				} as FileTreeNode,
				event.clientX,
				event.clientY,
			);
		}
	};
	return (
		<div
			className="files-panel group/file-tree flex min-h-0 flex-1 flex-col overflow-x-hidden p-0"
			ref={panelRef}
			tabIndex={-1}
			onMouseDown={handlePanelMouseDown}
			onDragOver={handlePanelDragOver}
			onDragLeave={() => {
				setDragOverDir(null);
				dragCountRef.current = 0;
			}}
			onDrop={handlePanelDrop}
			onKeyDown={handlePanelKeyDown}
			onContextMenu={handlePanelContextMenu}
		>
			<div data-file-tree-toolbar="" className="panel-action-row flex h-7 min-w-0 shrink-0 items-center justify-end gap-1 border-b border-border/40 bg-bg-page-raised px-2 text-xs text-muted-foreground sticky top-0 z-20">
				<div className="panel-action-buttons flex min-w-0 items-center gap-0.5">
					<FileSortControl sortMode={sortMode} sortDirection={sortDirection} onSortModeChange={setSortMode} onToggleDirection={() => setSortDirection((d) => (d === "asc" ? "desc" : "asc"))} />

					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						className={cn("icon-only inline-grid size-6 place-items-center rounded-md", compactPackages ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground")}
						onClick={() => setCompactPackages((v) => !v)}
						title={t("drawer.compactPackages")}
						aria-label={t("drawer.compactPackages")}
						aria-pressed={compactPackages}
					>
						<FolderTree size={13} aria-hidden="true" />
					</Button>

					{props.projectId && (
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							className={cn("icon-only inline-grid size-6 place-items-center rounded-md", searchOpen ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground")}
							onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
							title={t("drawer.fileSearch")}
							aria-label={t("drawer.fileSearch")}
							aria-pressed={searchOpen}
						>
							<Search size={13} aria-hidden="true" />
						</Button>
					)}
					{props.onOpenFolder && (
						<Button type="button" variant="ghost" size="icon-sm" className="icon-only inline-grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground" onClick={props.onOpenFolder} title={t("drawer.openFolder")} aria-label={t("drawer.openFolder")}>
							<Folder size={13} />
						</Button>
					)}

					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						className="icon-only inline-grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
						onClick={() => {
							props.onRefreshFiles();
							void gitStatus.refresh();
						}}
						title={t("common.refresh")}
						aria-label={t("common.refresh")}
					>
						<RefreshCw size={13} />
					</Button>
					{props.onCollapseAll && (
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							className="icon-only inline-grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-40"
							onClick={props.onCollapseAll}
							title={t("drawer.collapseAllDirs")}
							aria-label={t("drawer.collapseAllDirs")}
							disabled={props.expandedDirs.size === 0}
						>
							<ChevronsDownUp size={13} />
						</Button>
					)}
				</div>
			</div>
			{searchOpen ? (
				<FileSearchResults
					query={fileSearch.query}
					onQueryChange={fileSearch.setQuery}
					results={fileSearch.results}
					isSearching={fileSearch.isSearching}
					contentResults={fileSearch.contentResults}
					isContentSearching={fileSearch.isContentSearching}
					onViewFile={props.onViewFile}
					onFileContextMenu={props.onFileContextMenu}
					onClear={closeSearch}
				/>
			) : (
				<>
					{rootWindow.visible.map((node) => (
						<FileTreeNodeRow
							key={node.path}
							node={node}
							depth={0}
							expandedDirs={props.expandedDirs}
							activeEditorFile={activeEditorFile}
							onToggleDirectory={stableToggleDirectory}
							onFileContextMenu={stableFileContextMenu}
							onOpenFile={stableOpenFile}
							onViewFile={stableViewFile}
							onDropFiles={stableDropFiles}
							onMoveFiles={stableMoveFiles}
							dragOverDir={dragOverDir}
							onDragOverDirChange={setDragOverDir}
							scrollRef={panelRef}
							gitStatusOf={gitStatus.statusOf}
						/>
					))}
					{rootWindow.hasMore && <div ref={rootWindow.sentinelRef} aria-hidden="true" className="h-px shrink-0" />}
				</>
			)}
		</div>
	);
}

const SESSION_FILE_SUMMARY_COLLAPSED_KEY_PREFIX = "pid:session-file-summary-collapsed:";
const SESSION_FILE_SUMMARY_FILE_LIST_EXPANDED_KEY_PREFIX = "pid:session-file-summary-file-list-expanded:";

function loadCollapsed(sessionKey: string | null): boolean {
	if (!sessionKey || typeof window === "undefined") return true;
	const stored = localStorage.getItem(SESSION_FILE_SUMMARY_COLLAPSED_KEY_PREFIX + sessionKey);
	return stored !== null ? stored === "true" : true;
}

function loadFileListExpanded(sessionKey: string | null): boolean {
	if (!sessionKey || typeof window === "undefined") return false;
	const stored = localStorage.getItem(SESSION_FILE_SUMMARY_FILE_LIST_EXPANDED_KEY_PREFIX + sessionKey);
	return stored !== null ? stored === "true" : false;
}

export function SessionFileSummary(props: {
	files: SessionModifiedFile[];
	onOpenFile?: (path: string) => void;
	onDiffFile?: DiffFileHandler;

	sessionIdOrPath?: string;
}) {
	const [collapsed, setCollapsed] = useState(() => loadCollapsed(props.sessionIdOrPath ?? null));
	const [fileListExpanded, setFileListExpanded] = useState(() => loadFileListExpanded(props.sessionIdOrPath ?? null));
	const prevSessionRef = useRef(props.sessionIdOrPath);

	useEffect(() => {
		if (prevSessionRef.current === props.sessionIdOrPath) return;
		prevSessionRef.current = props.sessionIdOrPath;
		setCollapsed(loadCollapsed(props.sessionIdOrPath ?? null));
		setFileListExpanded(loadFileListExpanded(props.sessionIdOrPath ?? null));
	}, [props.sessionIdOrPath]);

	const handleToggleCollapsed = useCallback(() => {
		setCollapsed((prev) => {
			const next = !prev;
			if (props.sessionIdOrPath) {
				localStorage.setItem(SESSION_FILE_SUMMARY_COLLAPSED_KEY_PREFIX + props.sessionIdOrPath, String(next));
			}
			return next;
		});
	}, [props.sessionIdOrPath]);

	const handleToggleFileList = useCallback(() => {
		setFileListExpanded((prev) => {
			const next = !prev;
			if (props.sessionIdOrPath) {
				localStorage.setItem(SESSION_FILE_SUMMARY_FILE_LIST_EXPANDED_KEY_PREFIX + props.sessionIdOrPath, String(next));
			}
			return next;
		});
	}, [props.sessionIdOrPath]);

	const visibleFiles = fileListExpanded ? props.files : props.files.slice(0, 4);
	const hiddenCount = Math.max(0, props.files.length - visibleFiles.length);

	if (props.files.length === 0) return null;

	return (
		<section className="session-file-summary-list-card" aria-label={t("drawer.modifiedFilesAria")}>
			<button className="session-file-summary-header" type="button" onClick={handleToggleCollapsed} aria-expanded={!collapsed}>
				<ChevronDown size={14} className={`session-file-summary-chevron${collapsed ? "" : " open"}`} />
				<span className="session-file-summary-title-span">{t("drawer.modifiedFiles")}</span>
				<small className="session-file-summary-count">
					{props.files.length} {t("app.files")}
				</small>
			</button>

			<Collapsible open={!collapsed} className="contents">
				<CollapsibleContent>
					<ul className="session-file-summary-list">
						{visibleFiles.map((file) => {
							const fileName = file.path.split(/[/\\]/).pop() ?? file.path;
							return (
								<li key={file.path}>
									<button className="session-file-summary-row" type="button" title={file.path} onClick={() => props.onDiffFile?.(file.path, file.originalContent, file.content)}>
										<span className="session-file-summary-name">{fileName}</span>
									</button>
								</li>
							);
						})}
					</ul>
					{props.files.length > 4 && (
						<button className="session-file-summary-toggle" type="button" onClick={handleToggleFileList}>
							{fileListExpanded ? t("common.collapse") : t("drawer.moreFiles", { count: hiddenCount })}
						</button>
					)}
				</CollapsibleContent>
			</Collapsible>
		</section>
	);
}
