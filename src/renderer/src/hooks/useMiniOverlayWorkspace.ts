import { useCallback, useEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import type { AgentBackend, AvailableModel, MiniOverlayState, ResolvedLaunchDefaults, SessionLaunchPreferences, SessionModelPreference, SessionRecord } from "../../../shared/types";
import { createSessionModelPreference } from "../../../shared/modelDisplayName";
import { currentSessionAtom, projectInventoryAtom } from "../atoms";
import { desktopApi } from "../desktopApi";
import { t } from "../i18n";
import { showNotice } from "../utils/notice";

export type MiniOverlayWorkspaceOptions = {
	activeProjectId?: string;
	onCreateSession: (projectId: string, preferences: SessionLaunchPreferences, backend: AgentBackend) => Promise<SessionRecord | undefined>;
	onOpenSession: (projectId: string, sessionId: string) => Promise<string | undefined>;
};

const MINI_OVERLAY_WORKSPACE_KEY = "miniOverlay:workspace";

interface PersistedMiniOverlayWorkspace {
	view: "home" | "new" | "session";
	sessionId?: string;
	projectId?: string;
}

interface RestorableSessionTarget {
	view: "session";
	sessionId: string;
	projectId: string;
}

function readPersistedWorkspace(): RestorableSessionTarget | null {
	try {
		const raw = window.localStorage.getItem(MINI_OVERLAY_WORKSPACE_KEY);
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return null;
		const record = parsed as Partial<PersistedMiniOverlayWorkspace>;
		if (record.view !== "session" || typeof record.sessionId !== "string" || typeof record.projectId !== "string") return null;
		return { view: "session", sessionId: record.sessionId, projectId: record.projectId };
	} catch {
		return null;
	}
}

export function useMiniOverlayWorkspace(options: MiniOverlayWorkspaceOptions) {
	const projects = useAtomValue(projectInventoryAtom);
	const session = useAtomValue(currentSessionAtom);
	const backend = "pi" as const;
	const [view, setView] = useState<"home" | "new" | "session">(session ? "session" : "home");
	const [projectId, setProjectId] = useState(session?.projectId ?? options.activeProjectId);
	const [selectedModel, setSelectedModel] = useState<{ projectId?: string; backend: AgentBackend; model: SessionModelPreference }>();
	const [defaults, setDefaults] = useState<ResolvedLaunchDefaults>();
	const [recentSessions, setRecentSessions] = useState<SessionRecord[]>([]);
	const [recentLoading, setRecentLoading] = useState(false);
	const [recentFailed, setRecentFailed] = useState(false);

	const [activeSessions, setActiveSessions] = useState<MiniOverlayState["activeSessions"]>([]);
	const [creating, setCreating] = useState(false);
	const [openingSessionId, setOpeningSessionId] = useState<string>();
	const pendingRef = useRef(false);
	const mountedRef = useRef(true);
	const commandsRef = useRef(options);
	commandsRef.current = options;
	const previousSessionIdRef = useRef(session?.id);

	const restorePendingRef = useRef(true);
	const project = projects.find((item) => item.id === projectId);

	const model = selectedModel?.projectId === projectId && selectedModel?.backend === backend ? selectedModel.model : undefined;

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		const apply = (state: MiniOverlayState) => {
			if (!cancelled) setActiveSessions(state.activeSessions ?? []);
		};
		void desktopApi.miniOverlay
			.getState()
			.then((state) => {
				if (state) apply(state);
			})
			.catch(() => undefined);
		const off = desktopApi.miniOverlay.onStateChanged(apply);
		return () => {
			cancelled = true;
			off();
		};
	}, []);

	useEffect(() => {
		const persisted = readPersistedWorkspace();
		if (!persisted || session?.id === persisted.sessionId) {
			restorePendingRef.current = false;
			return;
		}
		void commandsRef.current
			.onOpenSession(persisted.projectId, persisted.sessionId)
			.then((opened) => {
				if (opened && mountedRef.current) setView("session");
			})
			.catch(() => {})
			.finally(() => {
				restorePendingRef.current = false;
			});
	}, []);

	useEffect(() => {
		if (restorePendingRef.current) return;
		try {
			const entry: PersistedMiniOverlayWorkspace = view === "session" && session ? { view: "session", sessionId: session.id, projectId: session.projectId } : { view: view === "new" ? "new" : "home" };
			window.localStorage.setItem(MINI_OVERLAY_WORKSPACE_KEY, JSON.stringify(entry));
		} catch {}
	}, [view, session?.id, session?.projectId]);

	useEffect(() => {
		if (session && session.id !== previousSessionIdRef.current) {
			setProjectId(session.projectId);
			setView("session");
		}
		previousSessionIdRef.current = session?.id;
	}, [session?.id, session?.projectId]);

	useEffect(() => {
		let cancelled = false;
		setDefaults(undefined);
		void desktopApi.sessions
			.resolveLaunchDefaults({ backend })
			.then((next) => {
				if (!cancelled) setDefaults(next);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [backend]);

	useEffect(() => {
		let cancelled = false;
		setRecentSessions([]);
		setRecentFailed(false);
		setRecentLoading(Boolean(projectId && !project?.missing && view === "home"));
		if (projectId && !project?.missing && view === "home") {
			void desktopApi.sessions
				.listCatalog(projectId)
				.then((records) => {
					if (cancelled) return;
					setRecentSessions(
						records
							.filter((item) => !item.parentSessionId && !item.parentSessionPath && !item.noSession)
							.sort((a, b) => b.updatedAt - a.updatedAt)
							.slice(0, 5),
					);
					setRecentLoading(false);
				})
				.catch(() => {
					if (cancelled) return;
					setRecentFailed(true);
					setRecentLoading(false);
				});
		}
		return () => {
			cancelled = true;
		};
	}, [projectId, project?.missing, view, session?.id]);

	const selectProject = useCallback((id: string) => {
		setProjectId(id);
		setSelectedModel(undefined);
	}, []);
	const selectModel = useCallback(
		(next: AvailableModel) => {
			setSelectedModel({ projectId, backend, model: createSessionModelPreference(next.provider, next.id, next.name) });
		},
		[projectId, backend],
	);
	const showNewSession = useCallback(() => {
		setSelectedModel(undefined);
		setView("new");
	}, []);
	const showHome = useCallback(() => setView("home"), []);
	const showSession = useCallback(() => {
		if (session) setView("session");
	}, [session]);

	const createSession = useCallback(async () => {
		if (!project || project.missing || pendingRef.current) return;
		pendingRef.current = true;
		setCreating(true);
		try {
			const record = await commandsRef.current.onCreateSession(project.id, model ? { model } : {}, backend);
			if (record && mountedRef.current) setView("session");
		} catch {
			if (mountedRef.current) showNotice(t("miniOverlay.createSessionFailed"), 4000, "error");
		} finally {
			pendingRef.current = false;
			if (mountedRef.current) setCreating(false);
		}
	}, [project, model, backend]);
	const openSession = useCallback(
		async (id: string) => {
			if (!project || project.missing || pendingRef.current) return;
			pendingRef.current = true;
			setOpeningSessionId(id);
			try {
				const opened = await commandsRef.current.onOpenSession(project.id, id);
				if (opened && mountedRef.current) setView("session");
			} catch {
				if (mountedRef.current) showNotice(t("miniOverlay.openSessionFailed"), 4000, "error");
			} finally {
				pendingRef.current = false;
				if (mountedRef.current) setOpeningSessionId(undefined);
			}
		},
		[project],
	);

	const openActiveSession = useCallback(async (id: string, activeProjectId: string) => {
		if (pendingRef.current) return;
		pendingRef.current = true;
		setOpeningSessionId(id);
		try {
			const opened = await commandsRef.current.onOpenSession(activeProjectId, id);
			if (opened && mountedRef.current) setView("session");
		} catch {
			if (mountedRef.current) showNotice(t("miniOverlay.openSessionFailed"), 4000, "error");
		} finally {
			pendingRef.current = false;
			if (mountedRef.current) setOpeningSessionId(undefined);
		}
	}, []);

	return {
		view,
		projects,
		project,
		session,
		backend,
		displayModel: model ?? defaults?.model,
		selectedModel: model,
		recentSessions,
		recentLoading,
		recentFailed,
		activeSessions,
		creating,
		openingSessionId,
		selectProject,
		selectModel,
		clearModel: () => setSelectedModel(undefined),
		showNewSession,
		showHome,
		showSession,
		createSession,
		openSession,
		openActiveSession,
	};
}

export type MiniOverlayWorkspace = ReturnType<typeof useMiniOverlayWorkspace>;
