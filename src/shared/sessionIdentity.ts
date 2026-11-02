import type { SessionEnvironment, SessionSource, SessionSummary } from "./types";

export type SessionOriginInput = {
	source: SessionSource;
	environment: SessionEnvironment;
	filePath: string;
	wslDistro?: string;
	wslUser?: string;
	importedSourceId?: string;
};

const MARKER_PICTOGRAPH_PREFIX = /^[\p{Extended_Pictographic}️‍]+[ 	]*/u;

export function looksLikePiSessionFileStem(title: string): boolean {
	const trimmed = title.replace(/\s+/g, " ").trim();

	return /^\d{4}-\d{2}-\d{2}T\d{2}[-:]\d{2}[-:]\d{2}(?:[.,-]\d+)?Z(?:_[A-Za-z0-9-]+)?$/.test(trimmed);
}

export function looksLikeCodexSessionFileStem(title: string): boolean {
	const trimmed = title.replace(/\s+/g, " ").trim();

	return /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-[0-9a-f]{8}(?:-[0-9a-f]+)*(?:\.jsonl)?(?:\.{3})?$/i.test(trimmed);
}

const MARKER_TAG_TITLE = /^\[[A-Z][A-Z0-9_-]{1,11}\][ \t]+[\x20-\x7E]*[:_]/;

export function looksLikeToolMarkerTitle(title: string): boolean {
	const trimmed = title.replace(/\s+/g, " ").trim().replace(MARKER_PICTOGRAPH_PREFIX, "");
	return MARKER_TAG_TITLE.test(trimmed);
}

export const SUBAGENT_ARTIFACTS_DIR_NAME = "subagent-artifacts";

export function isValidPiSessionFileHead(raw: string): boolean {
	for (const line of raw.split(/\r?\n/).filter(Boolean).slice(0, 12)) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			continue;
		}
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
		const record = parsed as Record<string, unknown>;

		if (typeof record.sessionName === "string" && typeof record.type !== "string") continue;

		return typeof record.type === "string";
	}
	return false;
}

export function isInSubagentArtifactsDir(filePath: string): boolean {
	return filePath.replace(/\\/g, "/").split("/").includes(SUBAGENT_ARTIFACTS_DIR_NAME);
}

export function canonicalizeSessionPath(filePath: string, environment: SessionEnvironment): string {
	const normalized = filePath.replace(/\\/g, "/").replace(/\/+$/, "");
	if (environment === "wsl") return normalized;
	return hasWindowsDrivePrefix(filePath) || hasWindowsUncPrefix(filePath) ? normalized.toLowerCase() : normalized;
}

export function getSessionEnvironment(summary: Pick<SessionSummary, "wsl">): SessionEnvironment {
	return summary.wsl ? "wsl" : "native";
}

export function getImportedSessionSourceId(summary: Pick<SessionSummary, "source" | "codexSessionId">): string | undefined {
	return summary.source === "codex" ? summary.codexSessionId : undefined;
}

export function buildSessionOriginKey(input: SessionOriginInput): string {
	const environmentKey = input.environment === "wsl" ? `wsl:${input.wslDistro ?? "unknown"}:${input.wslUser ?? "unknown"}` : "native";
	const importedKey = input.importedSourceId ? `:${encodeURIComponent(input.importedSourceId)}` : "";
	return [input.source, environmentKey, canonicalizeSessionPath(input.filePath, input.environment)].join(":") + importedKey;
}

export function buildSummaryOriginKey(summary: SessionSummary, options?: { wslDistro?: string; wslUser?: string }): string {
	return buildSessionOriginKey({
		source: summary.source ?? "pi",
		environment: getSessionEnvironment(summary),
		filePath: summary.filePath,
		wslDistro: options?.wslDistro,
		wslUser: options?.wslUser,
		importedSourceId: getImportedSessionSourceId(summary),
	});
}

function hasWindowsDrivePrefix(path: string): boolean {
	return /^[A-Za-z]:[\\/]/.test(path);
}

function hasWindowsUncPrefix(path: string): boolean {
	return path.startsWith("\\\\");
}

function resolveSessionPathPlatform(base: string, environment: SessionEnvironment): "windows" | "posix" {
	if (environment === "wsl") return "posix";
	return hasWindowsDrivePrefix(base) || hasWindowsUncPrefix(base) ? "windows" : "posix";
}

function isAbsolutePath(filePath: string, platform: "windows" | "posix"): boolean {
	if (filePath.startsWith("/")) return true;
	if (hasWindowsDrivePrefix(filePath) || hasWindowsUncPrefix(filePath)) return true;
	return platform === "windows" && filePath.startsWith("\\");
}

export function isUnambiguousAbsoluteSessionPath(filePath: string): boolean {
	return filePath.startsWith("/") || hasWindowsDrivePrefix(filePath) || hasWindowsUncPrefix(filePath);
}

function joinSessionPath(base: string, relative: string, platform: "windows" | "posix"): string {
	const trimmedBase = healSeparators(base, platform).replace(/[\\/]+$/, "");
	const trimmedRelative = relative.replace(/^[\\/]+/, "");
	if (platform === "windows") return `${trimmedBase}\\${trimmedRelative.replace(/\//g, "\\")}`;
	return `${trimmedBase}/${trimmedRelative.replace(/\\/g, "/")}`;
}

function windowsPathToWslBase(path: string): string {
	const drive = path.match(/^([A-Za-z]):(?:[\\/](.*))?$/);
	if (drive) {
		const suffix = drive[2]?.replace(/[\\/]+/g, "/") ?? "";
		return `/mnt/${drive[1].toLowerCase()}/${suffix}`;
	}
	return path.startsWith("/") ? path.replace(/[\\/]+/g, "/") : path;
}

export function toAbsoluteSessionPath(filePath: string, projectPath: string, environment: SessionEnvironment): string {
	if (environment === "wsl") {
		const base = windowsPathToWslBase(projectPath);
		if (isAbsolutePath(filePath, "posix")) return filePath;
		if (isPosixPathAlreadyRootedAt(filePath, base)) return healSeparators(filePath, "posix");
		return joinSessionPath(base, filePath, "posix");
	}
	const platform = resolveSessionPathPlatform(projectPath, environment);
	if (isAbsolutePath(filePath, platform)) return filePath;

	if (platform === "posix" && isPosixPathAlreadyRootedAt(filePath, projectPath)) return healSeparators(filePath, "posix");
	return joinSessionPath(projectPath, filePath, platform);
}

function healSeparators(filePath: string, platform: "windows" | "posix"): string {
	return platform === "windows" ? filePath.replace(/\//g, "\\") : filePath.replace(/\\/g, "/");
}

function isPosixPathAlreadyRootedAt(filePath: string, base: string): boolean {
	const normalizedBase = healSeparators(base, "posix").replace(/\/+$/, "");
	if (!normalizedBase.startsWith("/")) return false;
	const normalizedFile = healSeparators(filePath, "posix").replace(/^\/+/, "");
	return normalizedFile === normalizedBase.slice(1) || normalizedFile.startsWith(`${normalizedBase.slice(1)}/`);
}

export type SessionTreeNode = {
	id: string;
	filePath?: string;
	parentSessionPath?: string;
	environment?: SessionEnvironment;
};

function sessionSiblingDirPrefix(filePath: string, environment: SessionEnvironment): string | undefined {
	const canonical = canonicalizeSessionPath(filePath, environment);
	const jsonl = canonical.match(/\.jsonl$/i);
	if (!jsonl) return undefined;
	return `${canonical.slice(0, -jsonl[0].length)}/`;
}

export function isSessionDescendantOf(candidate: SessionTreeNode, ancestor: SessionTreeNode): boolean {
	if (candidate.id === ancestor.id) return false;
	if (!ancestor.filePath) return false;
	const environment = ancestor.environment ?? candidate.environment ?? "native";
	const ancestorPath = canonicalizeSessionPath(ancestor.filePath, environment);
	if (candidate.parentSessionPath && canonicalizeSessionPath(candidate.parentSessionPath, environment) === ancestorPath) {
		return true;
	}
	if (!candidate.filePath) return false;
	const siblingPrefix = sessionSiblingDirPrefix(ancestor.filePath, environment);
	if (!siblingPrefix) return false;
	return canonicalizeSessionPath(candidate.filePath, environment).startsWith(siblingPrefix);
}

export function collectSessionSubtreeIds(sessions: SessionTreeNode[], parent: SessionTreeNode): string[] {
	const byId = new Map<string, SessionTreeNode>();
	for (const session of sessions) {
		if (session.id) byId.set(session.id, session);
	}
	byId.set(parent.id, parent);

	const collected = new Set<string>([parent.id]);
	let grew = true;
	while (grew) {
		grew = false;
		for (const session of byId.values()) {
			if (collected.has(session.id)) continue;
			for (const ancestorId of collected) {
				const ancestor = byId.get(ancestorId);
				if (ancestor && isSessionDescendantOf(session, ancestor)) {
					collected.add(session.id);
					grew = true;
					break;
				}
			}
		}
	}
	return [...collected];
}
