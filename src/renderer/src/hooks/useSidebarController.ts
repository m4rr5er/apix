import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAtom, useAtomValue } from "jotai";
import type { AgentBackend, AgentTab, Project, SessionRecord, SessionSortModeId } from "../../../shared/types";
import { agentInventoryAtom, projectInventoryAtom, rpcLoggingAgentIdsAtom, sessionCatalogLoadStateAtom, sessionIdsByProjectAtom, sessionRecordsAtom, sidebarExpandedProjectIdsAtom, sidebarNavTabAtom, sidebarRuntimeAtom, toggleRpcLoggingAgent } from "../atoms";
import { migrateLegacyCollapsedProjects, sameProjectIdSet, writeExpandedSidebarProjects } from "../utils/sidebarExpandedProjects";
import { parseSidebarNavTab, writeSidebarNavTab, type SidebarNavTab } from "../utils/sidebarNavTab";
import { SESSION_FILTER_PILLS, parseSessionFilterState, serializeSessionFilterState, sessionPillOf, type SessionFilterPill, type SessionFilterState } from "../sessionFilterPills";
import { resolveSessionSortMode } from "../sessionSortModes";

export const SIDEBAR_PROJECT_CHILD_PAGE_SIZE = 5;

export type SidebarSourceFilter = Set<SessionFilterPill> | null;
export type SidebarSourceFilters = SessionFilterState;
export type SidebarSourceFilterMenu = {
	projectId: string;
	x: number;
	y: number;
};
export type SidebarMenuTarget =
	| { kind: "project"; projectId: string; x: number; y: number }
	| { kind: "agent"; agentId: string; pinnable?: boolean; x: number; y: number }
	| { kind: "session"; projectId: string; sessionId: string; pinnable: boolean; x: number; y: number }
	| { kind: "draft"; projectId: string; sessionId: string; x: number; y: number };

export type SidebarRuntimeSummary = {
	agentId?: string;
	status: string;
};

export type SidebarCatalog = {
	projects: readonly Project[];
	agents: readonly AgentTab[];
	sessionsByProject: Readonly<Record<string, readonly SessionRecord[]>>;
	runtimeBySessionId: Readonly<Record<string, SidebarRuntimeSummary | undefined>>;
	catalogLoadStateByProject: Readonly<Record<string, { status: string } | undefined>>;
};

export function hasLiveSidebarRuntime(runtime: SidebarRuntimeSummary | undefined): boolean {
	return Boolean(runtime?.agentId && runtime.status !== "detached" && runtime.status !== "closed" && runtime.status !== "error");
}

export type SidebarController = {
	catalog: SidebarCatalog;
	search: string;
	setSearch: (search: string) => void;

	navTab: SidebarNavTab;
	setNavTab: (tab: SidebarNavTab) => void;

	pinnedSessionIds: ReadonlySet<string>;

	sessionSortMode: SessionSortModeId;
	setSessionSortMode: (mode: SessionSortModeId) => void;
	isSessionPinned: (sessionId: string) => boolean;
	toggleSessionPin: (sessionId: string) => void;
	expandedProjectIds: ReadonlySet<string>;
	isProjectCollapsed: (projectId: string) => boolean;
	toggleProject: (projectId: string) => void;

	setProjectExpanded: (projectId: string, forceExpand?: boolean) => void;

	revealProject: (projectId: string) => void;

	toggleCollapseAllProjects: () => void;
	sourceFilterFor: (projectId: string) => SidebarSourceFilter;
	setSourceEnabled: (projectId: string, source: SessionFilterPill, enabled: boolean) => void;

	toggleSourceFilter: (projectId: string, source: SessionFilterPill) => void;
	clearSourceFilter: (projectId: string) => void;
	sourceFilterMenu?: SidebarSourceFilterMenu;
	openSourceFilter: (projectId: string, x: number, y: number) => void;
	closeSourceFilter: () => void;
	visibleChildCountFor: (projectId: string) => number;
	showMoreChildren: (projectId: string) => void;

	collapseChildren: (projectId: string) => void;

	hasExpandedChildren: (projectId: string) => boolean;
	expandedSubagentGroups: ReadonlySet<string>;
	toggleSubagentGroup: (groupId: string) => void;
	expandedWorktreePaths: ReadonlySet<string>;
	toggleWorktreeSessions: (path: string) => void;
	expandWorktreeSessions: (path: string) => void;

	drag: { sourceProjectId?: string; overProjectId?: string; overPosition?: "before" | "after" };
	startProjectDrag: (projectId: string) => void;

	setProjectDropTarget: (projectId?: string, position?: "before" | "after") => void;
	finishProjectDrag: () => void;
	menu: SidebarMenuTarget | null;
	openMenu: (target: SidebarMenuTarget) => Promise<void>;
	closeMenu: () => void;
	isAgentRpcLogging: (agentId: string) => boolean;
	sessionManagerProjectId?: string;
	openSessionManager: (projectId: string) => void;
	closeSessionManager: () => void;
	worktreeCreateProjectId?: string;
	openWorktreeCreate: (projectId: string) => void;
	closeWorktreeCreate: () => void;

	openRpcLogs: (agentId: string) => void;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const SOURCE_FILTER_STORAGE_KEY = "pideck-session-source-filter";

export function getBoundSidebarRuntimeAgent(catalog: Pick<SidebarCatalog, "agents" | "runtimeBySessionId">, sessionId: string): AgentTab | undefined {
	const runtime = catalog.runtimeBySessionId[sessionId];
	const agentId = runtime?.agentId;
	if (!hasLiveSidebarRuntime(runtime) || !agentId) return undefined;
	const agent = catalog.agents.find((candidate) => candidate.id === agentId);
	return agent && agent.status !== "closed" && agent.status !== "error" ? agent : undefined;
}

export function getBoundSidebarRuntimeAgentByAgentId(catalog: Pick<SidebarCatalog, "agents" | "runtimeBySessionId">, agentId: string): AgentTab | undefined {
	for (const [sessionId, runtime] of Object.entries(catalog.runtimeBySessionId)) {
		if (runtime?.agentId !== agentId) continue;
		return getBoundSidebarRuntimeAgent(catalog, sessionId);
	}
	return undefined;
}

export function createSidebarRequestGate() {
	let menuRequest = 0;
	return {
		beginMenu: () => ++menuRequest,
		isCurrentMenu: (request: number) => request === menuRequest,
		cancelMenu: () => {
			menuRequest += 1;
		},
	};
}

export function readSidebarSourceFilters(storage?: StorageLike): SidebarSourceFilters {
	if (!storage) return {};
	try {
		return parseSessionFilterState(storage.getItem(SOURCE_FILTER_STORAGE_KEY));
	} catch {
		return {};
	}
}

export function serializeSidebarSourceFilters(filters: SidebarSourceFilters) {
	return serializeSessionFilterState(filters);
}

export function filterSidebarSessions<T extends { source?: import("../../../shared/types").SessionSource; backend?: AgentBackend }>(sessions: readonly T[], filter: SidebarSourceFilter) {
	return filter === null || filter === undefined ? sessions : sessions.filter((session) => filter.has(sessionPillOf(session)));
}

export function useSidebarController(
	options: {
		storage?: StorageLike;
		getRpcLogging?: (agentId: string) => Promise<boolean>;

		openRpcLogViewer?: (agentId: string) => void;
		pageSize?: number;

		persistExpandedProjectIds?: (projectIds: string[]) => void;

		settingsExpandedProjectIds?: readonly string[];

		persistNavTab?: (tab: SidebarNavTab) => void;

		settingsNavTab?: SidebarNavTab;

		settingsPinnedSessionIds?: readonly string[];

		persistPinnedSessionIds?: (sessionIds: string[]) => void;

		settingsSessionSortMode?: SessionSortModeId;

		persistSessionSortMode?: (mode: SessionSortModeId) => void;

		settingsLoaded?: boolean;

		onExpandedProjectsReady?: () => void;
	} = {},
): SidebarController {
	const projects = useAtomValue(projectInventoryAtom);
	const agents = useAtomValue(agentInventoryAtom);
	const sessionRecords = useAtomValue(sessionRecordsAtom);
	const sessionIdsByProject = useAtomValue(sessionIdsByProjectAtom);
	const sessionRuntimeById = useAtomValue(sidebarRuntimeAtom);
	const sessionCatalogLoadStateByProject = useAtomValue(sessionCatalogLoadStateAtom);
	const pageSize = options.pageSize ?? SIDEBAR_PROJECT_CHILD_PAGE_SIZE;
	const [search, setSearch] = useState("");
	const [expandedProjectIds, setExpandedProjectIds] = useAtom(sidebarExpandedProjectIdsAtom);
	const [navTab, setNavTabState] = useAtom(sidebarNavTabAtom);
	const [pinnedSessionIds, setPinnedSessionIds] = useState<ReadonlySet<string>>(() => new Set());

	const [sessionSortMode, setSessionSortModeState] = useState<SessionSortModeId>(() => resolveSessionSortMode(undefined));
	const sessionSortModeHydratedRef = useRef(false);
	const persistSessionSortModeRef = useRef(options.persistSessionSortMode);
	persistSessionSortModeRef.current = options.persistSessionSortMode;
	const [sourceFilters, setSourceFilters] = useState<SidebarSourceFilters>(() => readSidebarSourceFilters(options.storage ?? (typeof window === "undefined" ? undefined : window.localStorage)));
	const [visibleChildCountByProject, setVisibleChildCountByProject] = useState<Record<string, number>>({});
	const [sourceFilterMenu, setSourceFilterMenu] = useState<SidebarSourceFilterMenu>();
	const [expandedSubagentGroups, setExpandedSubagentGroups] = useState<Set<string>>(() => new Set());
	const [expandedWorktreePaths, setExpandedWorktreePaths] = useState<Set<string>>(() => new Set());
	const [drag, setDrag] = useState<{ sourceProjectId?: string; overProjectId?: string; overPosition?: "before" | "after" }>({});
	const [menu, setMenu] = useState<SidebarMenuTarget | null>(null);

	const [agentRpcLogging, setAgentRpcLoggingById] = useAtom(rpcLoggingAgentIdsAtom);
	const patchRpcLogging = useCallback((agentId: string, enabled: boolean) => {
		setAgentRpcLoggingById((current) => toggleRpcLoggingAgent(current, agentId, enabled));
	}, []);
	const [sessionManagerProjectId, setSessionManagerProjectId] = useState<string>();
	const [worktreeCreateProjectId, setWorktreeCreateProjectId] = useState<string>();
	const requestGateRef = useRef(createSidebarRequestGate());
	const pinnedSessionIdsRef = useRef(pinnedSessionIds);
	pinnedSessionIdsRef.current = pinnedSessionIds;
	const pinnedSessionIdsHydratedRef = useRef(false);
	const persistPinnedSessionIdsRef = useRef(options.persistPinnedSessionIds);
	persistPinnedSessionIdsRef.current = options.persistPinnedSessionIds;

	const openRpcLogViewerRef = useRef(options.openRpcLogViewer);
	openRpcLogViewerRef.current = options.openRpcLogViewer;

	useEffect(() => {
		const storage = options.storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
		if (!storage) return;
		try {
			storage.setItem(SOURCE_FILTER_STORAGE_KEY, serializeSidebarSourceFilters(sourceFilters));
		} catch {}
	}, [options.storage, sourceFilters]);

	useEffect(() => {
		if (pinnedSessionIdsHydratedRef.current || !options.settingsLoaded) return;
		pinnedSessionIdsHydratedRef.current = true;
		const hydrated = new Set((options.settingsPinnedSessionIds ?? []).filter((id): id is string => typeof id === "string" && id.trim().length > 0));
		pinnedSessionIdsRef.current = hydrated;
		setPinnedSessionIds(hydrated);
	}, [options.settingsLoaded, options.settingsPinnedSessionIds]);

	useEffect(() => {
		if (sessionSortModeHydratedRef.current || !options.settingsLoaded) return;
		sessionSortModeHydratedRef.current = true;
		const hydrated = resolveSessionSortMode(options.settingsSessionSortMode);
		setSessionSortModeState(hydrated);
	}, [options.settingsLoaded, options.settingsSessionSortMode]);

	const setSessionSortMode = useCallback((mode: SessionSortModeId) => {
		sessionSortModeHydratedRef.current = true;
		const next = resolveSessionSortMode(mode);
		setSessionSortModeState(next);
		persistSessionSortModeRef.current?.(next);
	}, []);

	const toggleSessionPin = useCallback((sessionId: string) => {
		if (!sessionId) return;
		pinnedSessionIdsHydratedRef.current = true;
		const next = new Set(pinnedSessionIdsRef.current);
		if (next.has(sessionId)) next.delete(sessionId);
		else next.add(sessionId);
		pinnedSessionIdsRef.current = next;
		setPinnedSessionIds(next);
		persistPinnedSessionIdsRef.current?.([...next]);
	}, []);

	const navTabRef = useRef(navTab);
	navTabRef.current = navTab;

	const navTabHydratedRef = useRef(false);
	const persistNavTabRef = useRef(options.persistNavTab);
	persistNavTabRef.current = options.persistNavTab;

	const commitNavTab = useCallback(
		(tab: SidebarNavTab) => {
			navTabRef.current = tab;
			setNavTabState(tab);
			writeSidebarNavTab(storageRef.current, tab);
			persistNavTabRef.current?.(tab);
		},
		[setNavTabState],
	);

	const setNavTab = useCallback(
		(tab: SidebarNavTab) => {
			navTabHydratedRef.current = true;
			commitNavTab(tab);
		},
		[commitNavTab],
	);

	const settingsNavTab = options.settingsNavTab;
	useEffect(() => {
		if (navTabHydratedRef.current || !options.settingsLoaded) return;
		navTabHydratedRef.current = true;
		const parsed = parseSidebarNavTab(settingsNavTab);
		if (parsed === null || parsed === navTabRef.current) return;
		navTabRef.current = parsed;
		setNavTabState(parsed);
		writeSidebarNavTab(storageRef.current, parsed);
	}, [options.settingsLoaded, settingsNavTab, setNavTabState]);

	const expandedProjectIdsRef = useRef(expandedProjectIds);
	expandedProjectIdsRef.current = expandedProjectIds;

	const settingsHydratedRef = useRef(false);
	const persistExpandedRef = useRef(options.persistExpandedProjectIds);
	persistExpandedRef.current = options.persistExpandedProjectIds;
	const onExpandedProjectsReadyRef = useRef(options.onExpandedProjectsReady);
	onExpandedProjectsReadyRef.current = options.onExpandedProjectsReady;
	const expandedProjectsReadyNotifiedRef = useRef(false);
	const localStorageOrUndefined = options.storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
	const storageRef = useRef(localStorageOrUndefined);
	storageRef.current = localStorageOrUndefined;

	const commitExpandedProjectIds = useCallback(
		(next: ReadonlySet<string>) => {
			expandedProjectIdsRef.current = next;
			setExpandedProjectIds(next);
			writeExpandedSidebarProjects(storageRef.current, next);
			persistExpandedRef.current?.([...next]);
		},
		[setExpandedProjectIds],
	);

	const settingsExpanded = options.settingsExpandedProjectIds;
	useEffect(() => {
		if (settingsHydratedRef.current || !options.settingsLoaded) return;
		settingsHydratedRef.current = true;

		if (!Array.isArray(settingsExpanded)) return;
		const fromSettings = new Set(settingsExpanded.filter((id): id is string => typeof id === "string"));
		if (sameProjectIdSet(fromSettings, expandedProjectIdsRef.current)) return;
		expandedProjectIdsRef.current = fromSettings;
		setExpandedProjectIds(fromSettings);
		writeExpandedSidebarProjects(storageRef.current, fromSettings);
	}, [options.settingsLoaded, settingsExpanded, setExpandedProjectIds]);

	const projectIdsKey = projects.map((project) => project.id).join("|");
	useEffect(() => {
		if (projects.length === 0 || !options.settingsLoaded) return;
		const projectIds = projects.map((project) => project.id);

		if (options.settingsLoaded && !Array.isArray(options.settingsExpandedProjectIds)) {
			const migrated = migrateLegacyCollapsedProjects(storageRef.current, projectIds);
			if (migrated) {
				commitExpandedProjectIds(migrated);
				return;
			}
		}

		const previous = expandedProjectIdsRef.current;
		const known = new Set(projectIds);
		const pruned = new Set([...previous].filter((id) => known.has(id)));
		if (sameProjectIdSet(pruned, previous)) return;

		commitExpandedProjectIds(pruned);
	}, [projectIdsKey, commitExpandedProjectIds, options.settingsExpandedProjectIds, options.settingsLoaded]);

	useEffect(() => {
		if (expandedProjectsReadyNotifiedRef.current || !options.settingsLoaded || projects.length === 0) return;
		expandedProjectsReadyNotifiedRef.current = true;
		onExpandedProjectsReadyRef.current?.();
	}, [options.settingsLoaded, projectIdsKey]);

	const sessionsByProject = useMemo(() => Object.fromEntries(Object.entries(sessionIdsByProject).map(([projectId, sessionIds]) => [projectId, sessionIds.map((id) => sessionRecords[id]).filter((session): session is SessionRecord => Boolean(session))])), [sessionIdsByProject, sessionRecords]);
	const catalog = useMemo<SidebarCatalog>(
		() => ({
			projects,
			agents,
			sessionsByProject,
			runtimeBySessionId: sessionRuntimeById,
			catalogLoadStateByProject: sessionCatalogLoadStateByProject,
		}),
		[agents, projects, sessionCatalogLoadStateByProject, sessionRuntimeById, sessionsByProject],
	);

	const setProjectExpanded = useCallback(
		(projectId: string, forceExpand?: boolean) => {
			const previous = expandedProjectIdsRef.current;
			const next = new Set(previous);
			const shouldExpand = forceExpand ?? !next.has(projectId);
			if (shouldExpand) next.add(projectId);
			else next.delete(projectId);
			if (sameProjectIdSet(next, previous)) return;

			settingsHydratedRef.current = true;
			commitExpandedProjectIds(next);
		},
		[commitExpandedProjectIds],
	);
	const toggleProject = useCallback(
		(projectId: string) => {
			setProjectExpanded(projectId);
		},
		[setProjectExpanded],
	);

	const revealProject = useCallback(
		(projectId: string) => {
			setProjectExpanded(projectId, true);
		},
		[setProjectExpanded],
	);
	const toggleCollapseAllProjects = useCallback(() => {
		const previous = expandedProjectIdsRef.current;

		const workspaceIds = projects.filter((project) => project.kind !== "chat" && !project.worktreeParentId).map((project) => project.id);
		const hasExpanded = workspaceIds.some((id) => previous.has(id));
		const next = new Set(previous);
		if (hasExpanded) {
			workspaceIds.forEach((id) => next.delete(id));
		} else {
			workspaceIds.forEach((id) => next.add(id));
		}
		if (sameProjectIdSet(next, previous)) return;
		settingsHydratedRef.current = true;
		commitExpandedProjectIds(next);
	}, [commitExpandedProjectIds, projects]);
	const setSourceEnabled = useCallback((projectId: string, source: SessionFilterPill, enabled: boolean) => {
		setSourceFilters((current) => {
			const previous = current[projectId] ?? null;
			const next = new Set(previous ?? SESSION_FILTER_PILLS);
			if (enabled) next.add(source);
			else next.delete(source);
			return { ...current, [projectId]: next.size === SESSION_FILTER_PILLS.length ? null : next };
		});
	}, []);
	const toggleSourceFilter = useCallback((projectId: string, source: SessionFilterPill) => {
		setSourceFilters((current) => {
			const previous = current[projectId] ?? null;
			if (previous === null) return { ...current, [projectId]: new Set([source]) };
			const next = new Set(previous);
			if (next.has(source)) next.delete(source);
			else next.add(source);
			return { ...current, [projectId]: next.size === 0 ? null : next };
		});
	}, []);
	const clearSourceFilter = useCallback((projectId: string) => {
		setSourceFilters((current) => ({ ...current, [projectId]: null }));
	}, []);
	const showMoreChildren = useCallback(
		(projectId: string) => {
			setVisibleChildCountByProject((current) => ({
				...current,
				[projectId]: (current[projectId] ?? pageSize) + pageSize,
			}));
		},
		[pageSize],
	);
	const collapseChildren = useCallback((projectId: string) => {
		setVisibleChildCountByProject((current) => {
			const next = { ...current };
			delete next[projectId];
			return next;
		});
	}, []);
	const hasExpandedChildren = useCallback((projectId: string) => visibleChildCountByProject[projectId] !== undefined, [visibleChildCountByProject]);
	const toggleSubagentGroup = useCallback((groupId: string) => {
		setExpandedSubagentGroups((current) => {
			const next = new Set(current);
			if (next.has(groupId)) next.delete(groupId);
			else next.add(groupId);
			return next;
		});
	}, []);
	const toggleWorktreeSessions = useCallback((path: string) => {
		setExpandedWorktreePaths((current) => {
			const next = new Set(current);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});
	}, []);
	const expandWorktreeSessions = useCallback((path: string) => {
		setExpandedWorktreePaths((current) => new Set(current).add(path));
	}, []);
	const openMenu = useCallback(
		async (target: SidebarMenuTarget) => {
			const request = requestGateRef.current.beginMenu();
			if (target.kind === "agent" && options.getRpcLogging) {
				const logging = await options.getRpcLogging(target.agentId).catch(() => false);
				if (!requestGateRef.current.isCurrentMenu(request)) return;
				patchRpcLogging(target.agentId, logging);
			}
			if (requestGateRef.current.isCurrentMenu(request)) setMenu(target);
		},
		[options.getRpcLogging],
	);
	const openRpcLogs = useCallback((agentId: string) => {
		openRpcLogViewerRef.current?.(agentId);
	}, []);

	return {
		catalog,
		search,
		setSearch,
		navTab,
		setNavTab,
		pinnedSessionIds,
		isSessionPinned: (sessionId) => pinnedSessionIds.has(sessionId),
		toggleSessionPin,
		sessionSortMode,
		setSessionSortMode,
		expandedProjectIds,
		isProjectCollapsed: (projectId) => !expandedProjectIds.has(projectId),
		toggleProject,
		setProjectExpanded,
		revealProject,
		toggleCollapseAllProjects,
		sourceFilterFor: (projectId) => sourceFilters[projectId] ?? null,
		setSourceEnabled,
		toggleSourceFilter,
		clearSourceFilter,
		sourceFilterMenu,
		openSourceFilter: (projectId, x, y) => setSourceFilterMenu({ projectId, x, y }),
		closeSourceFilter: () => setSourceFilterMenu(undefined),
		visibleChildCountFor: (projectId) => visibleChildCountByProject[projectId] ?? pageSize,
		showMoreChildren,
		collapseChildren,
		hasExpandedChildren,
		expandedSubagentGroups,
		toggleSubagentGroup,
		expandedWorktreePaths,
		toggleWorktreeSessions,
		expandWorktreeSessions,
		drag,
		startProjectDrag: (projectId) => setDrag({ sourceProjectId: projectId }),
		setProjectDropTarget: (projectId, position) => setDrag((current) => ({ ...current, overProjectId: projectId, overPosition: projectId ? position : undefined })),
		finishProjectDrag: () => setDrag({}),
		menu,
		openMenu,
		closeMenu: () => {
			requestGateRef.current.cancelMenu();
			setMenu(null);
		},
		isAgentRpcLogging: (agentId) => agentRpcLogging.has(agentId),
		sessionManagerProjectId,
		openSessionManager: setSessionManagerProjectId,
		closeSessionManager: () => setSessionManagerProjectId(undefined),
		worktreeCreateProjectId,
		openWorktreeCreate: setWorktreeCreateProjectId,
		closeWorktreeCreate: () => setWorktreeCreateProjectId(undefined),
		openRpcLogs,
	};
}
