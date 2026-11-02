import { stat } from "node:fs/promises";
import type { HostPluginContext, HostPluginEntriesPage, HostPluginEntryCursor, HostPluginSession, HostPluginSessionPage, HostPluginSessionsChangedDetail, HostPluginSessionsRevision } from "../../shared/types/hostPlugin";
import type { SessionCatalog, SessionCatalogEntry } from "../sessions/SessionCatalog";
import { SessionHistoryReader, type PluginHistoryGuard } from "../pi/SessionHistoryReader";
import { toWindowsHostPath } from "../wsl/WslPaths";
import type { SessionHistoryReaderDeps } from "../pi/SessionHistoryReader";

export class HostPluginSessions {
	private readonly reader: SessionHistoryReader;
	constructor(private readonly catalog: Pick<SessionCatalog, "listEntries" | "get">) {
		const deps: SessionHistoryReaderDeps = {
			toHostPath: (path) => path,
			convertMessages: () => [],
			trimMessages: (messages) => messages,
			translate: (key) => key,
		};
		this.reader = new SessionHistoryReader(deps);
	}

	private path(entry: SessionCatalogEntry): string | undefined {
		if (!entry.filePath || entry.noSession) return undefined;
		if (process.platform === "win32" && entry.environment === "wsl") {
			if (!entry.wslDistro) return undefined;
			return toWindowsHostPath(entry.filePath, { distro: entry.wslDistro });
		}
		return entry.filePath;
	}

	private visible(context: HostPluginContext): SessionCatalogEntry[] {
		if (!context.projectId) return [];
		return this.catalog
			.listEntries()
			.filter((entry) => entry.projectId === context.projectId && !entry.noSession && !entry.supersededBy)
			.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
	}

	private toSession(entry: SessionCatalogEntry): HostPluginSession {
		return { id: entry.id, projectId: entry.projectId, title: entry.title, updatedAt: entry.updatedAt, createdAt: entry.createdAt, model: entry.model?.modelId, readable: Boolean(this.path(entry)) };
	}

	describe(context: HostPluginContext, projectNameOf?: (projectId: string) => string | undefined): HostPluginContext {
		const entry = context.sessionId ? this.catalog.get(context.sessionId) : undefined;
		const owned = entry && context.projectId && entry.projectId === context.projectId && !entry.noSession && !entry.supersededBy ? entry : undefined;
		return { ...context, projectName: context.projectId ? projectNameOf?.(context.projectId) : undefined, sessionTitle: owned?.title };
	}

	list(context: HostPluginContext, offset = 0): HostPluginSessionPage {
		if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) throw new Error("invalid-offset");
		const entries = this.visible(context);
		const sessions = entries.slice(offset, offset + 100).map((entry) => this.toSession(entry));
		return { sessions, nextOffset: offset + 100 < entries.length ? offset + 100 : null };
	}

	get(context: HostPluginContext, id: string): HostPluginSession {
		const entry = this.catalog.get(id);
		if (!entry || !context.projectId || entry.projectId !== context.projectId || entry.noSession || entry.supersededBy) throw new Error("session-not-authorized");
		return this.toSession(entry);
	}

	search(context: HostPluginContext, query: string, limit = 20): HostPluginSession[] {
		const needle = query.trim().toLocaleLowerCase();
		if (!needle) return [];
		const size = Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 20;
		return this.visible(context)
			.filter((entry) => entry.title.toLocaleLowerCase().includes(needle))
			.slice(0, size)
			.map((entry) => this.toSession(entry));
	}

	private static readonly HISTORY_BUDGET = { maxScanBytes: 64 * 1024 * 1024, maxEntries: 100_000, maxSummaryChars: 2000 };

	private authorizeAncestor(projectId: string, hostPath: string): boolean {
		return this.catalog.listEntries().some((entry) => entry.projectId === projectId && !entry.noSession && this.path(entry) === hostPath);
	}

	navigable(context: HostPluginContext, id: string): boolean {
		const entry = this.catalog.get(id);
		return Boolean(entry && context.projectId && entry.projectId === context.projectId && !entry.noSession && this.path(entry));
	}

	async entries(context: HostPluginContext, id: string, cursor?: HostPluginEntryCursor): Promise<HostPluginEntriesPage> {
		const entry = this.catalog.get(id);
		if (!entry || !context.projectId || entry.projectId !== context.projectId) throw new Error("session-not-authorized");
		const path = this.path(entry);
		if (!path) throw new Error("history-unavailable");
		const guard: PluginHistoryGuard = {
			...HostPluginSessions.HISTORY_BUDGET,
			authorizeSource: (hostPath) => this.authorizeAncestor(context.projectId!, hostPath),
			remaining: { bytes: 0, entries: 0 },
		};
		return this.reader.readPluginEntries(path, cursor, guard);
	}

	async revision(context: HostPluginContext): Promise<string> {
		return (await this.inspect(context)).catalog;
	}

	async changeSince(context: HostPluginContext, previous?: HostPluginSessionsRevision): Promise<{ revision: HostPluginSessionsRevision; detail: HostPluginSessionsChangedDetail }> {
		const revision = await this.inspect(context);
		const detail: HostPluginSessionsChangedDetail = { catalogChanged: false };

		if (previous) {
			detail.catalogChanged = previous.catalog !== revision.catalog;
			if (previous.active && revision.active && previous.active.sessionId === revision.active.sessionId && previous.active.file !== revision.active.file) {
				detail.sessionId = revision.active.sessionId;
			}
		}
		return { revision, detail };
	}

	private async inspect(context: HostPluginContext): Promise<HostPluginSessionsRevision> {
		const entries = this.catalog.listEntries().filter((entry) => entry.projectId === context.projectId && !entry.noSession);
		const signature: unknown[] = entries.map((entry) => [entry.id, entry.updatedAt, entry.title, entry.filePath]);
		const active = context.sessionId ? this.catalog.get(context.sessionId) : undefined;
		const path = active && active.projectId === context.projectId ? this.path(active) : undefined;
		if (path) {
			let file: string;
			try {
				const info = await stat(path);
				file = JSON.stringify([info.size, info.mtimeMs]);
			} catch {
				file = "unavailable";
			}
			return { catalog: JSON.stringify(signature), active: { sessionId: active!.id, file } };
		}
		return { catalog: JSON.stringify(signature) };
	}
}
