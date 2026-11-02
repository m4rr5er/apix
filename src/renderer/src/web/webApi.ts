import type { UIMessage } from "ai";
import type { AvailableModel, AgentBackend, ChatMessage, SessionCommandResult, SessionLaunchPreferences, SessionMessagePage, SessionRuntimeInfo, SessionRuntimeTarget, SessionSearchResult, SessionTargetedValue, SessionTodoSnapshot, UpdateSessionRecordInput } from "../../../shared/types";
import type { CommitEntry, GitBranchInfo, GitResourceGroups, ImageContent, PiExtensionSummary, PiSkillLocation, PiSkillSummary, PiSubagentEntry, YaoPromptCategory, ProviderUsageResult, UsageProbeBackend } from "../../../shared/types";
import type { AgentUiResponse } from "../../../shared/types";
import type { WebContextUsage, WebFileNodeLite, WebState } from "./webTypes";

export const WEB_TOKEN_STORAGE_KEY = "pideck-web-token";

let webToken: string | null = null;
if (typeof window !== "undefined") {
	const tokenFromUrl = new URLSearchParams(window.location.search).get("token");
	if (tokenFromUrl) window.localStorage.setItem(WEB_TOKEN_STORAGE_KEY, tokenFromUrl);
	webToken = window.localStorage.getItem(WEB_TOKEN_STORAGE_KEY);
}

export function getWebAuthHeaders(): Record<string, string> {
	return webToken ? { authorization: `Bearer ${webToken}` } : {};
}

export function getWebToken(): string | null {
	return webToken;
}

let authFailureNotified = false;
function apiFetch(input: string, init?: RequestInit): Promise<Response> {
	return fetch(input, {
		...init,
		headers: { ...getWebAuthHeaders(), ...init?.headers },
	}).then((res) => {
		if (res.status === 401) {
			if (!authFailureNotified && typeof window !== "undefined") {
				authFailureNotified = true;
				window.dispatchEvent(new CustomEvent("pideck-web-auth-failed"));
			}
		} else if (res.ok) {
			authFailureNotified = false;
		}
		return res;
	});
}

let lastStateEtag: string | null = null;
export async function fetchState(): Promise<WebState | null> {
	const res = await apiFetch("/api/state", {
		headers: lastStateEtag ? { "if-none-match": lastStateEtag } : undefined,
	});
	if (res.status === 304) return null;
	if (!res.ok) throw new Error(`state ${res.status}`);
	const etag = res.headers.get("etag");
	lastStateEtag = etag ?? null;
	return (await res.json()) as WebState;
}

export async function createProject(path: string): Promise<WebState["projects"][number]> {
	const res = await apiFetch("/api/projects", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ path }),
	});
	if (!res.ok) throw new Error(`create project ${res.status}`);
	const result = (await res.json()) as { project?: WebState["projects"][number] };
	if (!result.project) throw new Error("create project: missing project");
	return result.project;
}

export async function deleteProject(projectId: string): Promise<void> {
	const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/delete`, { method: "POST" });
	if (!res.ok) throw new Error(`delete project ${res.status}`);
}

export async function fetchModels(force = false): Promise<AvailableModel[]> {
	const res = await apiFetch(force ? "/api/models?force=1" : "/api/models");
	if (!res.ok) throw new Error(`models ${res.status}`);
	const result = (await res.json()) as { models?: AvailableModel[] };
	return result.models ?? [];
}

export async function createSession(projectId: string, preferences?: SessionLaunchPreferences & { backend?: AgentBackend }): Promise<string> {
	const res = await apiFetch("/api/sessions", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ projectId, ...preferences }),
	});
	if (!res.ok) throw new Error(`create session ${res.status}`);
	const result = (await res.json()) as { session?: { id?: string } };
	const id = result.session?.id;
	if (!id) throw new Error("create session: missing session id");
	return id;
}

export async function updateSessionRecord(sessionId: string, patch: UpdateSessionRecordInput): Promise<void> {
	const res = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/update`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(patch),
	});
	if (!res.ok) throw new Error(`update session ${res.status}`);
}

async function callRuntimeCommand<T>(sessionId: string, target: SessionRuntimeTarget, action: string, body: Record<string, unknown> = {}): Promise<T> {
	const res = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/runtime/${action}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ target, ...body }),
	});
	if (!res.ok) throw new Error(`runtime ${action} ${res.status}`);
	const payload = (await res.json()) as { result?: SessionCommandResult<SessionTargetedValue<T>> };
	const result = payload.result;
	if (!result || !result.ok) {
		throw new Error(result?.error.code ?? `runtime ${action} failed`);
	}
	return result.value.value;
}

export type WebForkResult = { cancelled?: boolean; text?: string; targetSessionId?: string; [key: string]: unknown };

async function callForkCommand(sessionId: string, target: SessionRuntimeTarget | null, action: string, body: Record<string, unknown> = {}): Promise<WebForkResult> {
	const res = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/runtime/${action}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ target, ...body }),
	});
	if (!res.ok) throw new Error(`runtime ${action} ${res.status}`);
	const payload = (await res.json()) as { result?: SessionCommandResult<WebForkResult> };
	const result = payload.result;
	if (!result || !result.ok) {
		throw new Error(result?.error.code ?? `runtime ${action} failed`);
	}
	return result.value ?? {};
}

export function setRuntimeModel(target: SessionRuntimeTarget, provider: string, modelId: string, modelName?: string): Promise<unknown> {
	return callRuntimeCommand(target.sessionId, target, "model", { provider, modelId, modelName });
}

export function setRuntimeThinking(target: SessionRuntimeTarget, level: string): Promise<unknown> {
	return callRuntimeCommand(target.sessionId, target, "thinking", { level });
}

export async function respondToUi(input: { sessionId: string; requestId: string; agentId: string; runtimeGeneration: number; response: AgentUiResponse }): Promise<void> {
	const res = await apiFetch("/api/ui-response", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
	if (!res.ok) throw new Error(`ui-response ${res.status}`);
}

export async function fetchSessionSearch(sessionId: string, query: string): Promise<SessionSearchResult | null> {
	const trimmed = query.trim();
	if (!trimmed) return null;
	const params = new URLSearchParams({ q: trimmed });
	const res = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/search?${params.toString()}`);
	if (!res.ok) return null;
	const body = (await res.json()) as { result?: SessionSearchResult | null };
	return body.result ?? null;
}

export async function fetchMessagePage(sessionId: string, before?: number, pageSize?: number): Promise<SessionMessagePage> {
	const params = new URLSearchParams();
	if (before != null) params.set("before", String(before));
	if (pageSize != null) params.set("pageSize", String(pageSize));
	const qs = params.toString();
	const res = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/messages/page${qs ? `?${qs}` : ""}`);
	if (!res.ok) throw new Error(`messages ${res.status}`);
	return (await res.json()) as SessionMessagePage;
}

export function chatMessagesToUiMessages(messages: ChatMessage[]): UIMessage[] {
	const result: UIMessage[] = [];
	for (const message of messages) {
		const role = message.role === "user" ? "user" : message.role === "assistant" ? "assistant" : "assistant";
		const parts: UIMessage["parts"] = [];
		if (message.role === "tool") {
			const meta = message.meta as Record<string, unknown> | undefined;
			const toolName = typeof meta?.toolName === "string" && meta.toolName ? meta.toolName : "";
			if (toolName) {
				const isError = meta?.isError === true || message.text.startsWith("✗");
				let input: unknown = meta?.args;
				if (typeof input === "string" && input) {
					try {
						input = JSON.parse(input);
					} catch {}
				}

				const toolPart = {
					type: `tool-${toolName}` as `tool-${string}`,
					toolCallId: `hist-${message.id}`,
					state: isError ? "output-error" : "output-available",
					input,
					output: meta?.result,
					errorText: isError ? (typeof meta?.detailText === "string" ? meta.detailText : message.text) : undefined,
				};
				parts.push(toolPart as unknown as UIMessage["parts"][number]);
			} else if (message.text) {
				parts.push({ type: "text", text: message.text });
			}

			result.push({ id: message.id ?? `hist-${message.timestamp ?? Math.random()}`, role: "assistant", parts, metadata: message.meta as UIMessage["metadata"] });
			continue;
		}
		if (message.thinking) {
			parts.push({ type: "reasoning", text: message.thinking });
		}
		if (message.text) {
			parts.push({ type: "text", text: message.text });
		}

		if (role === "user" && Array.isArray(message.images)) {
			for (const image of message.images) {
				if (image?.type !== "image" || typeof image.mimeType !== "string" || typeof image.data !== "string") continue;
				if (image.data.length > 4 * 1024 * 1024) continue;
				parts.push({ type: "file", mediaType: image.mimeType, data: `data:${image.mimeType};base64,${image.data}` } as unknown as UIMessage["parts"][number]);
			}
		}
		result.push({
			id: message.id ?? `hist-${message.timestamp ?? Math.random()}`,
			role,
			parts,

			metadata: message.meta as UIMessage["metadata"],
		});
	}
	return result;
}

export function stopRuntime(sessionId: string, target: SessionRuntimeTarget): Promise<unknown> {
	return callRuntimeCommand<unknown>(sessionId, target, "stop");
}

export function abortRuntime(sessionId: string, target: SessionRuntimeTarget): Promise<unknown> {
	return callRuntimeCommand<unknown>(sessionId, target, "abort");
}

export function restartRuntime(sessionId: string, target: SessionRuntimeTarget): Promise<unknown> {
	return callRuntimeCommand<unknown>(sessionId, target, "restart");
}

export function compactRuntime(sessionId: string, target: SessionRuntimeTarget, prompt?: string): Promise<unknown> {
	return callRuntimeCommand<unknown>(sessionId, target, "compact", prompt ? { prompt } : {});
}

export function cloneRuntime(sessionId: string, target: SessionRuntimeTarget): Promise<WebForkResult> {
	return callForkCommand(sessionId, target, "clone");
}

export async function renameSession(sessionId: string, title: string): Promise<void> {
	const res = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/update`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ title }),
	});
	if (!res.ok) throw new Error(`rename session ${res.status}`);
}

export async function deleteSession(sessionId: string): Promise<void> {
	const res = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/delete`, { method: "POST" });
	if (!res.ok) throw new Error(`delete session ${res.status}`);
}

export async function copySession(sessionId: string): Promise<string | undefined> {
	const res = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/copy`, { method: "POST" });
	if (!res.ok) throw new Error(`copy session ${res.status}`);
	const payload = (await res.json()) as { result?: { session?: { id?: string } } };
	return payload.result?.session?.id;
}

export async function downloadSessionHtml(sessionId: string): Promise<void> {
	const res = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/export-html`);
	if (!res.ok) throw new Error(`export html ${res.status}`);
	const blob = await res.blob();
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = `pideck-session-${sessionId.replace(/[^\w.-]+/g, "_")}.html`;
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(url);
}

export function editRuntimeMessage(sessionId: string, target: SessionRuntimeTarget, messageId: string, newText: string): Promise<void> {
	return callRuntimeCommand<void>(sessionId, target, "edit-message", { messageId, newText });
}

export function deleteRuntimeMessage(sessionId: string, target: SessionRuntimeTarget, messageId: string): Promise<void> {
	return callRuntimeCommand<void>(sessionId, target, "delete-message", { messageId });
}

export function prepareResend(sessionId: string, target: SessionRuntimeTarget, messageId: string): Promise<{ text: string; images?: ImageContent[] }> {
	return callRuntimeCommand<{ text: string; images?: ImageContent[] }>(sessionId, target, "prepare-resend", { messageId });
}

export async function activateRuntime(sessionId: string): Promise<SessionRuntimeTarget> {
	const res = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/runtime/activate`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({}),
	});
	if (!res.ok) throw new Error(`runtime activate ${res.status}`);
	const payload = (await res.json()) as { result?: SessionCommandResult<SessionRuntimeInfo> };
	const result = payload.result;
	if (!result || !result.ok) {
		throw new Error(result?.error.code ?? "runtime activate failed");
	}
	return { sessionId, agentId: result.value.agentId, runtimeGeneration: result.value.runtimeGeneration };
}

export function getForkMessages(sessionId: string, target: SessionRuntimeTarget): Promise<Array<{ entryId: string; text: string }>> {
	return callRuntimeCommand<Array<{ entryId: string; text: string }>>(sessionId, target, "get-fork-messages");
}

export function forkRuntimeSession(sessionId: string, target: SessionRuntimeTarget, entryId: string, options: { mutationFork?: boolean; branchMode?: boolean } = {}): Promise<WebForkResult> {
	return callForkCommand(sessionId, target, "fork", { entryId, ...options });
}

export async function fetchRuntimeContextUsage(sessionId: string, target: SessionRuntimeTarget): Promise<WebContextUsage> {
	const usage = await callRuntimeCommand<WebContextUsage>(sessionId, target, "state");
	return usage ?? {};
}

export async function fetchProviderUsage(provider: string, backend: UsageProbeBackend = "pi"): Promise<ProviderUsageResult> {
	const params = new URLSearchParams();
	const query = params.toString();
	const res = await apiFetch(`/api/usage/${encodeURIComponent(provider)}${query ? `?${query}` : ""}`);
	if (!res.ok) return { success: false, provider, disabled: true };
	const body = (await res.json()) as { result?: ProviderUsageResult };
	return body.result ?? { success: false, provider, disabled: true };
}

export async function fetchPrompts(search?: string, category?: string, page = 1, pageSize = 20): Promise<{ categories: YaoPromptCategory[]; prompts: Array<{ slug: string; title: string; category: string; subcategory: string; tags: string[]; description: string }>; total?: number }> {
	const params = new URLSearchParams();
	if (search) params.set("search", search);
	if (category) params.set("category", category);
	params.set("page", String(page));
	params.set("pageSize", String(pageSize));
	const res = await apiFetch(`/api/prompts?${params.toString()}`);
	if (!res.ok) throw new Error(`prompts ${res.status}`);
	return (await res.json()) as { categories: YaoPromptCategory[]; prompts: Array<{ slug: string; title: string; category: string; subcategory: string; tags: string[]; description: string }>; total?: number };
}

export async function fetchPromptContent(slug: string, category: string): Promise<string> {
	const params = new URLSearchParams({ category });
	const res = await apiFetch(`/api/prompts/${encodeURIComponent(slug)}?${params.toString()}`);
	if (!res.ok) throw new Error(`prompt detail ${res.status}`);
	const payload = (await res.json()) as { detail?: { promptContent?: string } };
	return payload.detail?.promptContent ?? "";
}

export async function fetchGitStatus(projectId: string): Promise<{ repo: false } | { repo: true; branch: GitBranchInfo; groups: GitResourceGroups }> {
	const res = await apiFetch(`/api/git/status?projectId=${encodeURIComponent(projectId)}`);
	if (!res.ok) throw new Error(`git status ${res.status}`);
	return (await res.json()) as { repo: false } | { repo: true; branch: GitBranchInfo; groups: GitResourceGroups };
}

export async function fetchGitDiff(projectId: string, group: "merge" | "index" | "workingTree" | "untracked", path: string): Promise<{ originalContent: string; modifiedContent: string } | null> {
	const params = new URLSearchParams({ group, path });
	const res = await apiFetch(`/api/git/diff?projectId=${encodeURIComponent(projectId)}&${params.toString()}`);
	if (!res.ok) throw new Error(`git diff ${res.status}`);
	const payload = (await res.json()) as { diff?: { originalContent: string; modifiedContent: string } | null };
	return payload.diff ?? null;
}

export async function fetchGitLog(projectId: string, limit = 15): Promise<CommitEntry[]> {
	const res = await apiFetch(`/api/git/log?projectId=${encodeURIComponent(projectId)}&limit=${limit}`);
	if (!res.ok) throw new Error(`git log ${res.status}`);
	const payload = (await res.json()) as { commits?: CommitEntry[] };
	return payload.commits ?? [];
}

export async function fetchFileList(projectId: string, dir?: string): Promise<WebFileNodeLite[]> {
	const params = new URLSearchParams();
	if (dir) params.set("dir", dir);
	const qs = params.toString();
	const res = await apiFetch(`/api/files?projectId=${encodeURIComponent(projectId)}${qs ? `&${qs}` : ""}`);
	if (!res.ok) throw new Error(`files ${res.status}`);
	const payload = (await res.json()) as { nodes?: WebFileNodeLite[] };
	return payload.nodes ?? [];
}

export async function fetchFileContent(projectId: string, path: string): Promise<{ content?: string; size?: number; tooLarge?: boolean; truncated?: boolean; binary?: boolean }> {
	const params = new URLSearchParams({ path });
	const res = await apiFetch(`/api/file-content?projectId=${encodeURIComponent(projectId)}&${params.toString()}`);
	if (!res.ok) throw new Error(`file content ${res.status}`);
	return (await res.json()) as { content?: string; size?: number; tooLarge?: boolean; truncated?: boolean; binary?: boolean };
}

export async function fetchSessionSubagents(sessionId: string): Promise<PiSubagentEntry[]> {
	const res = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/subagents`);
	if (!res.ok) throw new Error(`subagents ${res.status}`);
	const payload = (await res.json()) as { subagents?: PiSubagentEntry[] };
	return payload.subagents ?? [];
}

export async function fetchSessionTodo(sessionId: string): Promise<SessionTodoSnapshot | null> {
	const res = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/todo`);
	if (!res.ok) throw new Error(`todo ${res.status}`);
	const payload = (await res.json()) as { todo?: SessionTodoSnapshot | null };
	return payload.todo ?? null;
}

export type WebSkillLocation = Omit<PiSkillLocation, "path">;
export type WebSkillSummary = Omit<PiSkillSummary, "path" | "dir">;
export type WebExtensionSummary = Omit<PiExtensionSummary, "path">;

export async function listWebSkills(): Promise<{ locations: WebSkillLocation[]; skills: WebSkillSummary[] }> {
	const res = await apiFetch("/api/skills");
	if (!res.ok) throw new Error(`skills ${res.status}`);
	return (await res.json()) as { locations: WebSkillLocation[]; skills: WebSkillSummary[] };
}

export async function toggleWebSkill(name: string, sourceId: WebSkillSummary["sourceId"], enabled: boolean): Promise<WebSkillSummary> {
	const res = await apiFetch("/api/skills/toggle", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ name, sourceId, enabled }),
	});
	if (!res.ok) throw new Error(`skill toggle ${res.status}`);
	const payload = (await res.json()) as { skill?: WebSkillSummary };
	if (!payload.skill) throw new Error("skill toggle returned no skill");
	return payload.skill;
}

export async function listWebExtensions(): Promise<{ extensions: WebExtensionSummary[]; conflicts: { builtIn: string; thirdParty: string }[] }> {
	const res = await apiFetch("/api/extensions");
	if (!res.ok) throw new Error(`extensions ${res.status}`);
	const payload = (await res.json()) as { extensions?: WebExtensionSummary[]; conflicts?: { builtIn: string; thirdParty: string }[] };
	return { extensions: payload.extensions ?? [], conflicts: payload.conflicts ?? [] };
}

export async function toggleWebExtension(source: string, enabled: boolean, scope: "user" | "project" | "unknown"): Promise<void> {
	const res = await apiFetch("/api/extensions/toggle", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ source, enabled, scope }),
	});
	if (!res.ok) throw new Error(`extension toggle ${res.status}`);
}
