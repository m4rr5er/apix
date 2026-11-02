import type { MutableRefObject } from "react";
import { useSetAtom } from "jotai";
import type { AgentBackend, ArchivedPiSession, CreateAnonymousSessionResult, Project, SessionRecord, SessionLaunchPreferences, SessionSummary } from "../../../shared/types";
import { collectSessionSubtreeIds, getSessionEnvironment } from "../../../shared/sessionIdentity";
import { isSameSessionPath } from "../agentListDisplay";
import { t } from "../i18n";
import { markSessionReadAtom } from "../atoms/session-atoms";

export const DEFAULT_AGENT_BACKEND: AgentBackend = "pi";

export const ARCHIVED_SESSION_TOAST_MS = 4500;

export function archivedSessionToastMessage(_session: { backend?: AgentBackend }): string {
	return t("app.sessionArchived");
}

export type RefreshProjectSessions = (projectId: string, silent?: boolean) => Promise<SessionSummary[] | SessionRecord[] | undefined>;

export interface UseSessionActionsOptions {
	openSessionRequestRef: MutableRefObject<number>;
	creatingSessionDraftRef: MutableRefObject<Set<string>>;
	activeProjectId: string | undefined;
	sessionsProjectId: string | undefined;
	projects: Project[];
	setActiveProjectId: (value: React.SetStateAction<string | undefined>) => void;
	setCurrentSessionId: (value: React.SetStateAction<string | undefined>) => void;
	getSessionRecord: (sessionId: string) => SessionRecord | undefined;
	getProjectSessionRecords: (projectId: string) => SessionRecord[];
	upsertSession: (session: SessionRecord) => void;
	removeSessionState: (sessionId: string) => void;
	removeSessionComposerState: (sessionId: string) => void;

	closeTabs: (sessionIds: string[]) => void;
	refreshProjectSessions: RefreshProjectSessions;

	defaultBackend?: AgentBackend;
	api: {
		sessions: {
			copyRecord: (sessionId: string) => Promise<{ cancelled?: boolean; targetSessionId?: string }>;
			exportRecordHtml: (sessionId: string) => Promise<{ path: string }>;
			deleteRecord: (sessionId: string) => Promise<boolean>;
			archiveRecord: (sessionId: string) => Promise<boolean>;
			unarchiveRecord: (archivedPath: string) => Promise<boolean>;
			listArchived: () => Promise<ArchivedPiSession[]>;
			deleteArchivedRecord: (archivedPath: string) => Promise<boolean>;
			createDraft: (input: { projectId: string; title: string; backend?: AgentBackend } & SessionLaunchPreferences) => Promise<SessionRecord>;
			createAnonymous: (input: { projectId: string; title: string; backend?: AgentBackend } & SessionLaunchPreferences) => Promise<CreateAnonymousSessionResult>;
		};
	};
	showToast: (message: string, duration?: number) => void;
}

export function useSessionActions(options: UseSessionActionsOptions) {
	const markSessionRead = useSetAtom(markSessionReadAtom);
	const { openSessionRequestRef, creatingSessionDraftRef, activeProjectId, sessionsProjectId, projects, setActiveProjectId, setCurrentSessionId, getSessionRecord, getProjectSessionRecords, upsertSession, removeSessionState, removeSessionComposerState, closeTabs, refreshProjectSessions, api, showToast } = options;

	function commitSessionSelection(projectId: string, sessionId: string | undefined, scrollToEnd: boolean) {
		setActiveProjectId(projectId);
		setCurrentSessionId(sessionId);
		if (sessionId) markSessionRead(sessionId);
		void scrollToEnd;
	}

	function selectProject(projectId: string) {
		++openSessionRequestRef.current;
		commitSessionSelection(projectId, undefined, false);
	}

	function selectSession(projectId: string, sessionId: string, scrollToEnd = true) {
		++openSessionRequestRef.current;
		commitSessionSelection(projectId, sessionId, scrollToEnd);
	}

	async function copySession(sessionId: string, projectId = sessionsProjectId ?? activeProjectId) {
		if (!projectId) return;
		const result = await api.sessions.copyRecord(sessionId);
		if (result.cancelled) {
			showToast(t("app.sessionCopyCancelled"));
			return;
		}
		showToast(t("app.sessionCopied"));
		await refreshProjectSessions(projectId);
	}

	async function exportHistorySession(session: SessionSummary) {
		const result = await api.sessions.exportRecordHtml(session.id);
		showToast(t("app.exportedPath", { path: result.path }), 3500);
	}

	function dismissSessionTree(
		session: {
			id: string;
			filePath?: string;
			parentSessionPath?: string;
			environment?: SessionRecord["environment"];
			wsl?: boolean;
		},
		projectId = sessionsProjectId ?? activeProjectId,
	) {
		const records = projectId ? getProjectSessionRecords(projectId) : [];
		const ids = collectSessionSubtreeIds(records, {
			id: session.id,
			filePath: session.filePath,
			parentSessionPath: session.parentSessionPath,
			environment: session.environment ?? getSessionEnvironment(session),
		});
		closeTabs(ids);
		for (const id of ids) {
			removeSessionState(id);
			removeSessionComposerState(id);
		}
	}

	async function deleteHistorySession(session: SessionSummary) {
		try {
			await api.sessions.deleteRecord(session.id);
		} catch (error) {
			const raw = error instanceof Error ? error.message : String(error ?? "");
			const reason = raw.trim();
			showToast(reason || t("app.sessionDeleteFailed"), 5000);
			return;
		}
		dismissSessionTree(session);
		showToast(t("app.sessionDeleted"), 3200);
		const projectId = sessionsProjectId ?? activeProjectId;

		if (projectId) await refreshProjectSessions(projectId, true);
	}

	async function archiveHistorySession(session: SessionSummary) {
		await api.sessions.archiveRecord(session.id);
		dismissSessionTree(session);
		showToast(archivedSessionToastMessage(session), ARCHIVED_SESSION_TOAST_MS);
		const projectId = sessionsProjectId ?? activeProjectId;
		if (projectId) await refreshProjectSessions(projectId);
	}

	async function unarchiveHistorySession(archivedPath: string) {
		await api.sessions.unarchiveRecord(archivedPath);
		showToast(t("app.sessionRestored"), 2200);
		const projectId = sessionsProjectId ?? activeProjectId;
		if (projectId) await refreshProjectSessions(projectId);
	}

	async function listArchivedSessions() {
		return api.sessions.listArchived();
	}

	async function deleteArchivedSession(archivedPath: string) {
		await api.sessions.deleteArchivedRecord(archivedPath);
		showToast(t("app.sessionDeletedFromArchive"), 2200);
		const projectId = sessionsProjectId ?? activeProjectId;
		if (projectId) await refreshProjectSessions(projectId);
	}

	async function openSidebarSession(projectId: string, session: SessionSummary): Promise<string | undefined> {
		const requestSequence = ++openSessionRequestRef.current;
		const cachedRecord = getSessionRecord(session.id);
		let record: SessionRecord | undefined = cachedRecord?.projectId === projectId ? cachedRecord : getProjectSessionRecords(projectId).find((candidate) => candidate.filePath && isSameSessionPath(candidate.filePath, session.filePath, candidate.environment));
		if (!record) {
			try {
				await refreshProjectSessions(projectId, true);
				if (requestSequence !== openSessionRequestRef.current) return undefined;
				record = getProjectSessionRecords(projectId).find((candidate) => candidate.filePath && isSameSessionPath(candidate.filePath, session.filePath, candidate.environment));
			} catch (error) {
				if (requestSequence !== openSessionRequestRef.current) return undefined;
				showToast(error instanceof Error ? error.message : String(error), 4000);
				return undefined;
			}
		}
		if (!record || requestSequence !== openSessionRequestRef.current) return undefined;
		commitSessionSelection(projectId, record.id, true);
		return record.id;
	}

	async function openSidebarSessionById(projectId: string, sessionId: string): Promise<string | undefined> {
		const requestSequence = ++openSessionRequestRef.current;
		let record: SessionRecord | undefined = getSessionRecord(sessionId);
		if (!record || record.projectId !== projectId) {
			try {
				await refreshProjectSessions(projectId, true);
				if (requestSequence !== openSessionRequestRef.current) return undefined;
				record = getProjectSessionRecords(projectId).find((candidate) => candidate.id === sessionId);
			} catch (error) {
				if (requestSequence !== openSessionRequestRef.current) return undefined;
				showToast(error instanceof Error ? error.message : String(error), 4000);
				return undefined;
			}
		}
		if (!record || requestSequence !== openSessionRequestRef.current) return undefined;
		commitSessionSelection(projectId, record.id, true);
		return record.id;
	}

	async function copySidebarSession(projectId: string, session: SessionSummary) {
		await copySession(session.id, projectId);
	}

	async function exportSidebarSession(_projectId: string, session: SessionSummary) {
		const result = await api.sessions.exportRecordHtml(session.id);
		showToast(t("app.exportedPath", { path: result.path }), 3500);
	}

	async function createSessionDraft(
		projectId = activeProjectId,
		preferences: SessionLaunchPreferences = {},

		backend: AgentBackend = options.defaultBackend ?? DEFAULT_AGENT_BACKEND,
	): Promise<SessionRecord | undefined> {
		if (!projectId || creatingSessionDraftRef.current.has(projectId)) return undefined;
		const project = projects.find((item) => item.id === projectId);
		if (!project) return undefined;
		creatingSessionDraftRef.current.add(projectId);
		try {
			const session = await api.sessions.createDraft({
				projectId,
				title: `${project.name} agent`,
				backend,
				...preferences,
			});
			upsertSession(session);
			commitSessionSelection(projectId, session.id, true);
			return session;
		} catch (error) {
			showToast(error instanceof Error ? error.message : String(error), 4000);
			return undefined;
		} finally {
			creatingSessionDraftRef.current.delete(projectId);
		}
	}

	async function createAnonymousSession(projectId = activeProjectId, preferences: SessionLaunchPreferences = {}, backend: AgentBackend = options.defaultBackend ?? DEFAULT_AGENT_BACKEND): Promise<SessionRecord | undefined> {
		if (!projectId || creatingSessionDraftRef.current.has(projectId)) return undefined;
		const project = projects.find((item) => item.id === projectId);
		if (!project) return undefined;
		creatingSessionDraftRef.current.add(projectId);
		try {
			const { session } = await api.sessions.createAnonymous({
				projectId,
				title: t("app.anonymousChatTitle", { name: project.name }),
				backend,
				...preferences,
			});
			upsertSession(session);
			commitSessionSelection(projectId, session.id, true);
			return session;
		} catch (error) {
			showToast(error instanceof Error ? error.message : String(error), 4000);
			return undefined;
		} finally {
			creatingSessionDraftRef.current.delete(projectId);
		}
	}

	return {
		selectProject,
		selectSession,
		copySession,
		exportHistorySession,
		deleteHistorySession,
		archiveHistorySession,
		unarchiveHistorySession,
		listArchivedSessions,
		deleteArchivedSession,
		openSidebarSession,
		openSidebarSessionById,
		copySidebarSession,
		exportSidebarSession,
		createSessionDraft,
		createAnonymousSession,
		dismissSessionTree,
	};
}
