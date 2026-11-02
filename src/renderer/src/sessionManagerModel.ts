import type { ArchivedPiSession, Project, SessionSummary } from "../../shared/types";

export function sessionManagerRowKey(summary: SessionSummary): string {
	return summary.id;
}

export function worktreeFamilyProjects(projects: readonly Project[], openedProjectId: string): Project[] {
	const opened = projects.find((project) => project.id === openedProjectId);
	if (!opened) return [];
	const root = opened.worktreeParentId ? projects.find((project) => project.id === opened.worktreeParentId) : opened;
	if (!root) return [opened];
	const children = projects.filter((project) => project.worktreeParentId === root.id);
	return [root, ...children];
}

export function familyRootProject(family: readonly Project[]): Project | undefined {
	return family.find((project) => !project.worktreeParentId) ?? family[0];
}

export function sessionWorkspaceLabel(projectId: string | undefined, family: readonly Project[]): string | undefined {
	if (!projectId) return undefined;
	const root = familyRootProject(family);
	const project = family.find((candidate) => candidate.id === projectId);
	if (!project || !root || project.id === root.id) return undefined;
	return project.name || undefined;
}

export function canonicalWorkspacePath(path: string, wsl: boolean): string {
	const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
	return wsl ? normalized : normalized.toLowerCase();
}

function isWslLikePath(path: string): boolean {
	return path.startsWith("/");
}

function familyPathSet(family: readonly Project[], wsl: boolean): ReadonlySet<string> {
	return new Set(
		family
			.map((project) => project.path)
			.filter((path): path is string => Boolean(path))
			.map((path) => canonicalWorkspacePath(path, wsl)),
	);
}

function isPathWithinMember(canonical: string, memberPaths: ReadonlySet<string>): boolean {
	for (const member of memberPaths) {
		if (canonical === member || canonical.startsWith(`${member}/`)) return true;
	}
	return false;
}

export function filterArchivedPiByFamily(items: readonly ArchivedPiSession[], family: readonly Project[]): ArchivedPiSession[] {
	const nativeMembers = familyPathSet(family, false);
	const wslMembers = familyPathSet(family, true);
	return items.filter((item) => {
		const projectPath = item.summary.projectPath;

		if (!item.originalPath || !projectPath) return false;
		const wsl = item.summary.wsl === true || isWslLikePath(projectPath);
		const members = wsl ? wslMembers : nativeMembers;
		return isPathWithinMember(canonicalWorkspacePath(projectPath, wsl), members);
	});
}

function workspaceMemberForPath(canonical: string, wsl: boolean, family: readonly Project[]): Project | undefined {
	const root = familyRootProject(family);
	if (!root) return undefined;
	let best: Project | undefined;
	let bestLength = -1;
	for (const project of family) {
		if (project.id === root.id || !project.path) continue;
		const member = canonicalWorkspacePath(project.path, wsl);
		if (isPathWithinMember(canonical, new Set([member])) && member.length > bestLength) {
			best = project;
			bestLength = member.length;
		}
	}
	return best;
}

export function archivedPiWorkspaceLabel(item: ArchivedPiSession, family: readonly Project[]): string | undefined {
	const projectPath = item.summary.projectPath;
	if (!item.originalPath || !projectPath) return undefined;
	const wsl = item.summary.wsl === true || isWslLikePath(projectPath);
	return workspaceMemberForPath(canonicalWorkspacePath(projectPath, wsl), wsl, family)?.name;
}

export type ManagerArchivedRow = { kind: "pi"; item: ArchivedPiSession };

export function managerArchivedRowKey(row: ManagerArchivedRow): string {
	return sessionManagerRowKey(row.item.summary);
}

export function mergeManagerArchived(piSessions: readonly ArchivedPiSession[]): ManagerArchivedRow[] {
	return piSessions.map((item) => ({ kind: "pi" as const, item })).sort((a, b) => b.item.summary.updatedAt - a.item.summary.updatedAt);
}

export function isManagerSessionSummary(summary: SessionSummary): boolean {
	return Boolean(summary.filePath);
}
