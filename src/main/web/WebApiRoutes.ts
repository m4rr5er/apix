import type { IncomingMessage, ServerResponse } from "node:http";
import type { AgentRuntimeState, CreateAnonymousSessionInput, CreateSessionDraftInput, ImageContent, SendSessionPromptInput, SessionRuntimeTarget, SessionUiResponseInput, UpdateSessionRecordInput } from "../../shared/types";
import { readBoundedFile } from "./WebHttpResponders";
import { ifNoneMatchHits, stateEtag } from "./WebStateEtag";
import type { WebServiceDependencies } from "./WebServiceManager";

const CHAT_IMAGE_MAX_COUNT = 4;
const CHAT_IMAGE_MAX_BASE64_BYTES = 2 * 1024 * 1024;

export function extractChatImages(parts: Array<{ type?: string; mediaType?: string; data?: string; url?: string }>): ImageContent[] {
	const images: ImageContent[] = [];
	for (const part of parts) {
		const raw = typeof part.data === "string" && part.data ? part.data : typeof part.url === "string" ? part.url : "";
		if (part.type !== "file" || !raw) continue;
		if (images.length >= CHAT_IMAGE_MAX_COUNT) break;
		let mimeType = typeof part.mediaType === "string" ? part.mediaType : "";
		let payload = raw;
		const dataUrlMatch = raw.match(/^data:([^;]+);base64,(.*)$/s);
		if (dataUrlMatch) {
			mimeType = mimeType || dataUrlMatch[1];
			payload = dataUrlMatch[2];
		}
		if (!mimeType.startsWith("image/")) continue;
		if (payload.length > CHAT_IMAGE_MAX_BASE64_BYTES) continue;
		images.push({ type: "image", mimeType, data: payload });
	}
	return images;
}

export type WebApiRoutesPort = {
	deps: WebServiceDependencies;
	sendJson: (response: ServerResponse, body: unknown, extraHeaders?: Record<string, string>) => void;
	sendError: (response: ServerResponse, statusCode: number, code: string, error: string, params?: Record<string, string | number>) => void;
	sendNoContent: (response: ServerResponse) => void;
	readJson: <T>(request: IncomingMessage, maxBytes?: number) => Promise<T>;

	getState: () => Promise<{ projects?: unknown[]; sessions?: unknown[]; runtimes?: unknown[]; pendingUiRequests?: unknown[] }>;
	queryNumber: (url: URL, key: string) => number | undefined;
	runtimeAgentIdForSession: (sessionId: string) => string | undefined;
	runtimeTargetForSession: (sessionId: string) => SessionRuntimeTarget | undefined;
	executeRestartWithProgress: (target: SessionRuntimeTarget, response: ServerResponse) => Promise<void>;
	handleStream: (sessionId: string, request: IncomingMessage, response: ServerResponse, options?: { keepAlive?: boolean }) => void;
	writeStreamError: (response: ServerResponse, errorText: string) => void;
};

export class WebApiRoutes {
	private readonly deps: WebServiceDependencies;
	private readonly sendJson: WebApiRoutesPort["sendJson"];
	private readonly sendError: WebApiRoutesPort["sendError"];
	private readonly sendNoContent: WebApiRoutesPort["sendNoContent"];
	private readonly readJson: WebApiRoutesPort["readJson"];
	private readonly getState: WebApiRoutesPort["getState"];
	private readonly queryNumber: WebApiRoutesPort["queryNumber"];
	private readonly runtimeAgentIdForSession: WebApiRoutesPort["runtimeAgentIdForSession"];
	private readonly runtimeTargetForSession: WebApiRoutesPort["runtimeTargetForSession"];
	private readonly executeRestartWithProgress: WebApiRoutesPort["executeRestartWithProgress"];
	private readonly handleStream: WebApiRoutesPort["handleStream"];
	private readonly writeStreamError: WebApiRoutesPort["writeStreamError"];

	constructor(port: WebApiRoutesPort) {
		this.deps = port.deps;
		this.sendJson = port.sendJson;
		this.sendError = port.sendError;
		this.sendNoContent = port.sendNoContent;
		this.readJson = port.readJson;
		this.getState = port.getState;
		this.queryNumber = port.queryNumber;
		this.runtimeAgentIdForSession = port.runtimeAgentIdForSession;
		this.runtimeTargetForSession = port.runtimeTargetForSession;
		this.executeRestartWithProgress = port.executeRestartWithProgress;
		this.handleStream = port.handleStream;
		this.writeStreamError = port.writeStreamError;
	}

	async handle(url: URL, request: IncomingMessage, response: ServerResponse): Promise<boolean> {
		if (url.pathname === "/api/state") {
			const state = await this.getState();

			const etag = stateEtag(state);
			if (ifNoneMatchHits(request.headers["if-none-match"], etag)) {
				response.writeHead(304, { etag, "cache-control": "no-store" });
				response.end();
				return true;
			}
			this.sendJson(response, state, { etag });
			return true;
		}
		if (url.pathname === "/api/ui-response" && request.method === "POST") {
			const body = await this.readJson<Partial<SessionUiResponseInput>>(request);
			const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
			const requestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
			const agentId = typeof body.agentId === "string" ? body.agentId.trim() : "";
			const runtimeGeneration = typeof body.runtimeGeneration === "number" ? body.runtimeGeneration : NaN;
			if (!sessionId || !requestId || !agentId || !Number.isFinite(runtimeGeneration)) {
				this.sendError(response, 400, "webError.requestIdRequired", "ui response target is required");
				return true;
			}
			try {
				await this.deps.respondToUi({
					sessionId,
					requestId,
					agentId,
					runtimeGeneration,
					response: body.response ?? {},
				});
				this.sendJson(response, { ok: true });
			} catch (error) {
				this.sendError(response, 409, "webError.runtimeTargetRequired", error instanceof Error ? error.message : "ui response rejected");
			}
			return true;
		}
		if (url.pathname === "/api/models" && request.method === "GET") {
			const force = url.searchParams.get("force") === "1";
			this.sendJson(response, { models: await this.deps.listModels(force) });
			return true;
		}
		if (url.pathname === "/api/projects" && request.method === "POST") {
			const body = await this.readJson<{ path?: string }>(request);
			const path = body.path?.trim() ?? "";
			if (!path) {
				this.sendError(response, 400, "webError.projectPathRequired", "path is required");
				return true;
			}
			const project = await this.deps.createProject(path);
			this.sendJson(response, { project });
			return true;
		}
		const deleteProjectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/delete$/);
		if (deleteProjectMatch && request.method === "POST") {
			const projectId = decodeURIComponent(deleteProjectMatch[1]);
			const project = this.deps.listProjects().find((item) => item.id === projectId);
			if (!project) {
				this.sendError(response, 404, "webError.projectNotFound", "project not found");
				return true;
			}
			if (project.kind === "chat") {
				this.sendError(response, 400, "webError.chatProjectProtected", "the built-in chat project cannot be deleted");
				return true;
			}
			const deleted = await this.deps.deleteProject(projectId);
			this.sendJson(response, { deleted });
			return true;
		}
		const sessionsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/sessions$/);
		if (sessionsMatch && request.method === "GET") {
			const sessions = await this.deps.listSessions(decodeURIComponent(sessionsMatch[1]));
			this.sendJson(response, { sessions });
			return true;
		}
		const catalogSessionsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/sessions\/catalog$/);
		if (catalogSessionsMatch && request.method === "GET") {
			const sessions = await this.deps.listCatalogSessions(decodeURIComponent(catalogSessionsMatch[1]));
			this.sendJson(response, { sessions });
			return true;
		}

		const subagentsMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/subagents$/);
		if (subagentsMatch && request.method === "GET") {
			if (!this.deps.listSessionSubagents) {
				this.sendError(response, 503, "webError.stripsUnavailable", "session subagents are not available");
				return true;
			}
			this.sendJson(response, { subagents: await this.deps.listSessionSubagents(decodeURIComponent(subagentsMatch[1])) });
			return true;
		}

		const sessionSearchMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/search$/);
		if (sessionSearchMatch && request.method === "GET") {
			const query = (url.searchParams.get("q") ?? "").trim();
			const search = this.deps.searchSessionMessages;
			if (!search || !query || query.length > 256) {
				this.sendJson(response, { result: null });
				return true;
			}
			let result = null;
			try {
				result = await search(decodeURIComponent(sessionSearchMatch[1]), query);
			} catch {
				result = null;
			}
			this.sendJson(response, { result });
			return true;
		}

		const usageMatch = url.pathname.match(/^\/api\/usage\/([^/]+)$/);
		if (usageMatch && request.method === "GET") {
			const provider = decodeURIComponent(usageMatch[1]).trim();
			const backend = "pi" as const;
			const probe = this.deps.fetchProviderUsage;
			if (!probe || !provider || provider.length > 128) {
				this.sendJson(response, { result: { success: false, provider, disabled: true } });
				return true;
			}
			let result;
			try {
				result = await probe(provider, backend);
			} catch {
				result = { success: false, provider, disabled: true };
			}
			this.sendJson(response, { result });
			return true;
		}
		const todoMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/todo$/);
		if (todoMatch && request.method === "GET") {
			if (!this.deps.listSessionTodo) {
				this.sendError(response, 503, "webError.stripsUnavailable", "session todo is not available");
				return true;
			}
			this.sendJson(response, { todo: (await this.deps.listSessionTodo(decodeURIComponent(todoMatch[1]))) ?? null });
			return true;
		}
		if (url.pathname === "/api/sessions/runtimes" && request.method === "GET") {
			this.sendJson(response, { runtimes: this.deps.listSessionRuntimes() });
			return true;
		}
		if (url.pathname === "/api/sessions" && request.method === "POST") {
			const body = await this.readJson<CreateSessionDraftInput>(request);
			if (!body.projectId?.trim()) {
				this.sendError(response, 400, "webError.projectIdRequired", "projectId is required");
				return true;
			}
			const session = await this.deps.createSessionDraft(body);
			this.sendJson(response, { session });
			return true;
		}
		if (url.pathname === "/api/sessions/anonymous" && request.method === "POST") {
			const body = await this.readJson<CreateAnonymousSessionInput>(request);
			if (!body.projectId?.trim()) {
				this.sendError(response, 400, "webError.projectIdRequired", "projectId is required");
				return true;
			}
			const result = await this.deps.createAnonymousSession(body);
			this.sendJson(response, result);
			return true;
		}
		const sessionRecordActionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/(update|delete|copy|export-html)$/);
		if (sessionRecordActionMatch && request.method === "POST") {
			const sessionId = decodeURIComponent(sessionRecordActionMatch[1]);
			const action = sessionRecordActionMatch[2];
			if (action === "update") {
				const patch = await this.readJson<UpdateSessionRecordInput>(request);
				const session = await this.deps.updateSessionRecord(sessionId, patch);
				this.sendJson(response, { session });
			} else if (action === "delete") {
				const deleted = await this.deps.deleteSessionRecord(sessionId);
				this.sendJson(response, { deleted });
			} else if (action === "copy") {
				const result = await this.deps.copySessionRecord(sessionId);
				this.sendJson(response, { result });
			} else {
				const result = await this.deps.exportSessionRecordHtml(sessionId);
				this.sendJson(response, { result });
			}
			return true;
		}
		const sessionReferenceMessagesMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/reference-messages$/);
		if (sessionReferenceMessagesMatch && request.method === "GET") {
			const messages = await this.deps.readSessionReferenceMessages(decodeURIComponent(sessionReferenceMessagesMatch[1]));
			this.sendJson(response, { messages });
			return true;
		}

		const sessionExportHtmlDownloadMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/export-html$/);
		if (sessionExportHtmlDownloadMatch && request.method === "GET") {
			const sessionId = decodeURIComponent(sessionExportHtmlDownloadMatch[1]);
			try {
				const { path } = await this.deps.exportSessionRecordHtml(sessionId);

				const html = await readBoundedFile(path, 16 * 1024 * 1024);
				const safeTitle = sessionId.replace(/[^\w.-]+/g, "_");
				response.writeHead(200, {
					"content-type": "text/html; charset=utf-8",
					"content-disposition": `attachment; filename="pideck-session-${safeTitle}.html"`,
					"cache-control": "no-store",
				});
				response.end(html);
			} catch (error) {
				this.sendError(response, 500, "webError.internal", error instanceof Error ? error.message : "export failed");
			}
			return true;
		}
		const sessionMessagePageMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/messages\/page$/);
		if (sessionMessagePageMatch && request.method === "GET") {
			const beforeValue = url.searchParams.get("before");
			const pageSizeValue = url.searchParams.get("pageSize");
			const before = beforeValue === null ? undefined : Number(beforeValue);
			const pageSize = pageSizeValue === null ? undefined : Number(pageSizeValue);
			const page = await this.deps.readSessionMessagePage(decodeURIComponent(sessionMessagePageMatch[1]), Number.isSafeInteger(before) ? before : undefined, Number.isSafeInteger(pageSize) ? pageSize : undefined);
			this.sendJson(response, page);
			return true;
		}
		const sessionMessagesMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/messages$/);
		if (sessionMessagesMatch && request.method === "GET") {
			const window = await this.deps.readSessionMessages(decodeURIComponent(sessionMessagesMatch[1]));
			this.sendJson(response, {
				messages: window.messages,
				total: window.total,
				windowStart: window.windowStart,
				truncated: window.truncated,
			});
			return true;
		}
		const sessionPromptMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/prompt$/);
		if (sessionPromptMatch && request.method === "POST") {
			const sessionId = decodeURIComponent(sessionPromptMatch[1]);
			const body = await this.readJson<Omit<SendSessionPromptInput, "sessionId">>(request);
			const message = body.message?.trim() ?? "";
			if (!body.requestId?.trim()) {
				this.sendError(response, 400, "webError.requestIdRequired", "requestId is required");
				return true;
			}
			if (!message && !body.images?.length) {
				this.sendError(response, 400, "webError.messageRequired", "message or images is required");
				return true;
			}
			const result = await this.deps.sendSessionPrompt({
				...body,
				sessionId,
				message,
			});
			this.sendJson(response, { result });
			return true;
		}

		const streamMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/stream$/);
		if (streamMatch && request.method === "GET") {
			const sessionId = decodeURIComponent(streamMatch[1]);
			this.handleStream(sessionId, request, response, { keepAlive: true });
			return true;
		}

		if (url.pathname === "/api/chat" && request.method === "POST") {
			const CHAT_MAX_BODY_BYTES = 8 * 1024 * 1024;
			const body = await this.readJson<{
				id?: string;
				messages?: Array<{ role?: string; content?: unknown; parts?: Array<{ type?: string; text?: string; mediaType?: string; data?: string }> }>;

				messageId?: string;

				agentMessage?: string;
			}>(request, CHAT_MAX_BODY_BYTES);
			const sessionId = body.id?.trim();
			if (!sessionId) {
				this.sendError(response, 400, "webError.requestIdRequired", "session id is required");
				return true;
			}

			const lastUser = [...(body.messages ?? [])].reverse().find((message) => message.role === "user");
			const partsText = (lastUser?.parts ?? [])
				.filter((part) => part.type === "text" && typeof part.text === "string")
				.map((part) => part.text ?? "")
				.join("");
			const contentText = typeof lastUser?.content === "string" ? lastUser.content : "";
			const message = (partsText || contentText).trim();

			const images = extractChatImages(lastUser?.parts ?? []);
			if (!message && images.length === 0) {
				this.sendError(response, 400, "webError.messageRequired", "message is required");
				return true;
			}

			const requestId = body.messageId?.trim() || crypto.randomUUID();

			this.handleStream(sessionId, request, response);

			const agentMessage = typeof body.agentMessage === "string" ? body.agentMessage.trim().slice(0, 64 * 1024) : "";
			const result = await this.deps
				.sendSessionPrompt({
					sessionId,
					requestId,
					message: message || " ",
					...(images.length > 0 ? { images } : {}),
					...(agentMessage ? { agentMessage } : {}),
				})
				.catch((error: unknown) => ({
					accepted: false as const,
					error: error instanceof Error ? error.message : String(error),
				}));
			if (!result.accepted) {
				const errText = typeof result.error === "string" ? result.error : "Prompt was rejected";
				this.writeStreamError(response, errText);
				return true;
			}
			return true;
		}
		const sessionRuntimeMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/runtime\/(activate|stop|abort|restart|compact|state|commands|export-html|edit-message|delete-message|prepare-resend|models|model|thinking|permission|clone|fork|get-fork-messages|rewind-list|rewind-diff|rewind-restore)$/);
		if (sessionRuntimeMatch && request.method === "POST") {
			const sessionId = decodeURIComponent(sessionRuntimeMatch[1]);
			const action = sessionRuntimeMatch[2];
			const body = await this.readJson<{
				target?: SessionRuntimeTarget;
				prompt?: string;
				messageId?: string;
				newText?: string;
				provider?: string;
				modelId?: string;
				modelName?: string;
				level?: string;
				preset?: string;
				checkpointId?: string;
				scope?: string;

				limit?: number;
				beforeTimestamp?: number;

				entryId?: string;

				mutationFork?: boolean;

				branchMode?: boolean;
			}>(request);
			const target = body.target;

			if (action === "activate") {
				if (!this.deps.activateSessionRuntime) {
					this.sendError(response, 503, "webError.runtimeUnavailable", "Session runtime activation is not available");
					return true;
				}
				this.sendJson(response, { result: await this.deps.activateSessionRuntime(sessionId) });
				return true;
			}
			if (!target || target.sessionId !== sessionId) {
				this.sendError(response, 400, "webError.runtimeTargetRequired", "A matching Session runtime target is required");
				return true;
			}
			let result: unknown;
			switch (action) {
				case "stop":
					result = await this.deps.stopSessionRuntime(target);
					break;
				case "abort":
					result = await this.deps.abortSessionRuntime(target);
					break;
				case "restart": {
					await this.executeRestartWithProgress(target, response);

					return true;
				}
				case "compact":
					result = await this.deps.compactSessionRuntime(target, body.prompt);
					break;
				case "state":
					result = await this.deps.getSessionRuntimeState(target);
					break;
				case "commands":
					result = await this.deps.listSessionRuntimeCommands(target);
					break;
				case "models":
					result = await this.deps.listSessionRuntimeModels(target);
					break;
				case "export-html":
					result = await this.deps.exportSessionRuntimeHtml(target);
					break;
				case "edit-message":
					result = await this.deps.editSessionRuntimeMessage(target, body.messageId ?? "", body.newText ?? "");
					break;
				case "delete-message":
					result = await this.deps.deleteSessionRuntimeMessage(target, body.messageId ?? "");
					break;
				case "prepare-resend":
					result = await this.deps.prepareSessionRuntimeResend(target, body.messageId ?? "");
					break;
				case "model":
					result = await this.deps.setSessionRuntimeModel(target, typeof body.provider === "string" ? body.provider : "", typeof body.modelId === "string" ? body.modelId : "", typeof body.modelName === "string" ? body.modelName : undefined);
					break;
				case "thinking":
					result = await this.deps.setSessionRuntimeThinking(target, body.level ?? "");
					break;
				case "clone":
					result = await this.deps.cloneSessionRuntime(target);
					break;
				case "fork":
					result = await this.deps.forkRuntimeSession(target, typeof body.entryId === "string" ? body.entryId : "", {
						mutationFork: body.mutationFork === true,
						branchMode: body.branchMode === true,
					});
					break;
				case "get-fork-messages":
					result = await this.deps.getForkMessages(target);
					break;
				case "rewind-list":
					result = await this.deps.listRewindCheckpoints(target, {
						limit: typeof body.limit === "number" && Number.isFinite(body.limit) ? body.limit : undefined,
						beforeTimestamp: typeof body.beforeTimestamp === "number" && Number.isFinite(body.beforeTimestamp) ? body.beforeTimestamp : undefined,
					});
					break;
				case "rewind-diff":
					result = await this.deps.getRewindCheckpointDiff(target, body.checkpointId ?? "");
					break;
				case "rewind-restore":
					result = await this.deps.restoreRewindCheckpoint(target, body.checkpointId ?? "", body.scope === "files" ? "files" : body.scope === "conversation" ? "conversation" : "all");
					break;
			}
			this.sendJson(response, { result });
			return true;
		}
		return false;
	}
}
