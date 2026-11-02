export type UiMessageStreamFrame = Record<string, unknown>;

export type AgentToSessionRouter = (agentId: string) => string | undefined;

export type AgentChannelEventSource = (handler: (agentId: string, channel: string, payload: unknown) => void) => () => void;

export type SseWriter = (frame: UiMessageStreamFrame) => boolean;

const CLOSED_RUN_SESSIONS_MAX = 64;

const SESSION_STATES_MAX = 64;

const RUN_REPLAY_MAX_FRAMES = 2000;

export type PiEvent = {
	type?: string;

	message?: Record<string, unknown>;
	assistantMessageEvent?: Record<string, unknown>;

	toolName?: string;
	toolCallId?: string;
	args?: unknown;
	result?: unknown;
	partialResult?: unknown;
	isError?: boolean;

	stopReason?: string;
	error?: unknown;
};

export class PiEventToUiMessageStream {
	private textBlockId: string | null = null;
	private reasoningBlockId: string | null = null;

	private reasoningDeltaSent = false;
	private currentMessageId: string | null = null;
	private finished = false;

	private inputSentToolCallIds = new Set<string>();

	private settledToolCallIds = new Set<string>();

	push(event: PiEvent): UiMessageStreamFrame[] {
		const frames: UiMessageStreamFrame[] = [];
		const type = event.type;

		if (type === "message_start") {
			const role = event.message?.role;
			if (role === "assistant" && !this.finished) {
				if (!this.currentMessageId) {
					this.currentMessageId = String((event.message?.id as string | undefined) ?? `msg_${Date.now()}`);
					frames.push({ type: "start", messageId: this.currentMessageId });
				} else {
					frames.push({ type: "start-step" });
				}
			}
			return frames;
		}

		if (type === "message_update" && event.assistantMessageEvent) {
			return this.handleAssistantMessageEvent(event.assistantMessageEvent);
		}

		if (type === "tool_execution_start") {
			return this.startTool(event);
		}
		if (type === "tool_execution_end") {
			return this.endTool(event);
		}

		if (type === "agent_end") {
			if (event.error !== undefined && event.error !== null) return this.finishMessage(event);
			return frames;
		}

		if (type === "agent_settled") {
			return this.finishMessage(event);
		}

		return frames;
	}

	finish(): UiMessageStreamFrame[] {
		return this.finishMessage({});
	}

	isFinished(): boolean {
		return this.finished;
	}

	private handleAssistantMessageEvent(ev: Record<string, unknown>): UiMessageStreamFrame[] {
		const frames: UiMessageStreamFrame[] = [];
		const eventType = ev.type;

		if (eventType === "text_start" || eventType === "text_delta" || eventType === "text_end") {
			const delta = String(ev.delta ?? ev.text ?? "");
			if (!this.textBlockId) {
				this.textBlockId = `text_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
				frames.push({ type: "text-start", id: this.textBlockId });
			}
			if (eventType === "text_delta" && delta) {
				frames.push({ type: "text-delta", id: this.textBlockId, delta });
			}
			if (eventType === "text_end" && this.textBlockId) {
				frames.push({ type: "text-end", id: this.textBlockId });
				this.textBlockId = null;
			}
			return frames;
		}

		if (eventType === "thinking_delta" || eventType === "thinking_end") {
			const delta = String(ev.delta ?? ev.thinking ?? "");
			const finalContent = eventType === "thinking_end" ? String(ev.content ?? "") : "";
			if (!this.reasoningBlockId) {
				this.reasoningBlockId = `reasoning_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
				this.reasoningDeltaSent = false;
				frames.push({ type: "reasoning-start", id: this.reasoningBlockId });
			}
			if (eventType === "thinking_delta" && delta) {
				this.reasoningDeltaSent = true;
				frames.push({ type: "reasoning-delta", id: this.reasoningBlockId, delta });
			}
			if (eventType === "thinking_end") {
				if (finalContent && !delta && !this.reasoningDeltaSent) {
					this.reasoningDeltaSent = true;
					frames.push({ type: "reasoning-delta", id: this.reasoningBlockId, delta: finalContent });
				}
				frames.push({ type: "reasoning-end", id: this.reasoningBlockId });
				this.reasoningBlockId = null;
			}
			return frames;
		}

		if (eventType === "toolcall_start") {
			const toolCall = ev.toolCall as Record<string, unknown> | undefined;
			if (toolCall && typeof toolCall.id === "string" && typeof toolCall.name === "string") {
				if (this.inputSentToolCallIds.has(toolCall.id) || this.settledToolCallIds.has(toolCall.id)) return frames;
				this.inputSentToolCallIds.add(toolCall.id);
				frames.push({
					type: "tool-input-start",
					toolCallId: toolCall.id,
					toolName: toolCall.name,
				});
				frames.push({
					type: "tool-input-available",
					toolCallId: toolCall.id,
					toolName: toolCall.name,
					input: toolCall.input ?? {},
				});
			}
			return frames;
		}
		if (eventType === "toolcall_end") {
			const toolCall = ev.toolCall as Record<string, unknown> | undefined;
			if (toolCall && typeof toolCall.id === "string") {
				if (!this.inputSentToolCallIds.has(toolCall.id)) {
					return [];
				}

				const output = toolCall.output;
				if (output === null || output === undefined) return frames;
				if (this.settledToolCallIds.has(toolCall.id)) return frames;
				this.settledToolCallIds.add(toolCall.id);
				this.inputSentToolCallIds.delete(toolCall.id);
				frames.push({
					type: "tool-output-available",
					toolCallId: toolCall.id,
					output,
				});
			}
			return frames;
		}

		if (eventType === "done") {
			return this.closeOpenBlocks();
		}

		return frames;
	}

	private startTool(event: PiEvent): UiMessageStreamFrame[] {
		const toolName = typeof event.toolName === "string" ? event.toolName : "tool";
		const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : `tool_${toolName}_${Date.now()}`;

		if (this.inputSentToolCallIds.has(toolCallId) || this.settledToolCallIds.has(toolCallId)) return [];
		this.inputSentToolCallIds.add(toolCallId);
		return [
			{ type: "tool-input-start", toolCallId, toolName },
			{ type: "tool-input-available", toolCallId, toolName, input: event.args ?? {} },
		];
	}

	private endTool(event: PiEvent): UiMessageStreamFrame[] {
		const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : undefined;
		if (!toolCallId) return [];

		if (this.settledToolCallIds.has(toolCallId) || !this.inputSentToolCallIds.has(toolCallId)) {
			return [];
		}
		this.settledToolCallIds.add(toolCallId);
		this.inputSentToolCallIds.delete(toolCallId);
		if (event.isError) {
			return [
				{
					type: "tool-output-error",
					toolCallId,
					errorText: typeof event.error === "string" ? event.error : "Tool failed",
				},
			];
		}

		const rawOutput = event.result ?? event.partialResult ?? {};
		let output: unknown = {};
		try {
			const serialized = JSON.stringify(rawOutput) ?? "{}";
			output = serialized.length > 64 * 1024 ? { truncated: true, preview: `${serialized.slice(0, 32 * 1024)}…` } : rawOutput;
		} catch {
			output = {};
		}
		return [{ type: "tool-output-available", toolCallId, output }];
	}

	private closeOpenBlocks(): UiMessageStreamFrame[] {
		const frames: UiMessageStreamFrame[] = [];
		if (this.textBlockId) {
			frames.push({ type: "text-end", id: this.textBlockId });
			this.textBlockId = null;
		}
		if (this.reasoningBlockId) {
			frames.push({ type: "reasoning-end", id: this.reasoningBlockId });
			this.reasoningBlockId = null;
		}
		return frames;
	}

	private finishMessage(event: PiEvent): UiMessageStreamFrame[] {
		if (this.finished) return [];
		this.finished = true;
		const frames = this.closeOpenBlocks();
		if (event.error !== undefined) {
			const errorText = typeof event.error === "string" ? event.error : "Agent 运行失败";
			frames.push({ type: "error", errorText });
		}
		frames.push({ type: "finish" });
		return frames;
	}
}

export const UI_MESSAGE_STREAM_HEADER = "x-vercel-ai-ui-message-stream";

export function serializeSseFrame(frame: UiMessageStreamFrame): string {
	return `data: ${JSON.stringify(frame)}\n\n`;
}

export const SSE_DONE = "data: [DONE]\n\n";

export type SessionStreamEntry = {
	sessionId: string;

	writeRaw: (wire: string) => boolean;
	closed: boolean;

	keepAlive?: boolean;
	onFinish?: () => void;
};

type SessionRunState = {
	adapter: PiEventToUiMessageStream;

	runFrames: UiMessageStreamFrame[];

	runClosed: boolean;

	runOverflow: boolean;
};

export class WebEventStreamRouter {
	private readonly sessionStreams = new Map<string, Set<SessionStreamEntry>>();
	private unsubscribePi: (() => void) | null = null;
	private unsubscribeChannels: (() => void) | null = null;

	private readonly closedRunTextBySession = new Map<string, string>();

	private readonly sessionStates = new Map<string, SessionRunState>();

	constructor(private readonly resolveSession: AgentToSessionRouter) {}

	add(sessionId: string, writeRaw: (wire: string) => boolean, onClose: () => void, onFinish?: () => void, options?: { keepAlive?: boolean }): () => void {
		const entry: SessionStreamEntry = {
			sessionId,
			writeRaw,
			closed: false,
			keepAlive: options?.keepAlive === true,
			onFinish,
		};
		let set = this.sessionStreams.get(sessionId);
		if (!set) {
			set = new Set();
			this.sessionStreams.set(sessionId, set);
		}
		set.add(entry);

		const close = () => {
			if (entry.closed) return;
			entry.closed = true;
			set?.delete(entry);
			if (set && set.size === 0) this.sessionStreams.delete(sessionId);
			onClose();
		};

		if (entry.keepAlive) this.replayRun(sessionId, entry, set);
		return close;
	}

	bindPiSource(subscribe: ((handler: (agentId: string, event: PiEvent) => void) => () => void) | undefined): void {
		this.unsubscribePi?.();
		if (!subscribe) {
			this.unsubscribePi = null;
			return;
		}
		this.unsubscribePi = subscribe((agentId, event) => this.onPiEvent(agentId, event));
	}

	unbindPiSource(): void {
		this.unsubscribePi?.();
		this.unsubscribePi = null;
		this.sessionStates.clear();
	}

	private onPiEvent(agentId: string, event: PiEvent): void {
		const sessionId = this.resolveSession(agentId);
		if (!sessionId) return;

		const state = this.sessionStateFor(sessionId);
		const frames = state.adapter.push(event);
		this.recordRunFrames(state, frames);
		this.emitToSession(sessionId, frames);

		if (frames.some((frame) => frame.type === "finish")) this.endRun(state);
	}

	private sessionStateFor(sessionId: string): SessionRunState {
		const existing = this.sessionStates.get(sessionId);
		if (existing) {
			this.sessionStates.delete(sessionId);
			this.sessionStates.set(sessionId, existing);
			return existing;
		}
		if (this.sessionStates.size >= SESSION_STATES_MAX) this.evictIdleSessionState();
		const state: SessionRunState = {
			adapter: new PiEventToUiMessageStream(),
			runFrames: [],
			runClosed: true,
			runOverflow: false,
		};
		this.sessionStates.set(sessionId, state);
		return state;
	}

	private evictIdleSessionState(): void {
		let oldest: string | undefined;
		for (const key of this.sessionStates.keys()) {
			if (oldest === undefined) oldest = key;
			const streams = this.sessionStreams.get(key);
			if (!streams || streams.size === 0) {
				this.sessionStates.delete(key);
				return;
			}
		}
		if (oldest !== undefined) this.sessionStates.delete(oldest);
	}

	private recordRunFrames(state: SessionRunState, frames: UiMessageStreamFrame[]): void {
		if (frames.length === 0) return;
		if (state.runClosed) {
			state.runFrames = [];
			state.runOverflow = false;
			state.runClosed = false;
		}
		if (state.runOverflow) return;
		for (const frame of frames) {
			const type = frame.type;
			if (type === "text-delta" || type === "reasoning-delta") {
				const last = state.runFrames.at(-1);
				if (last && last.type === type && last.id === frame.id) {
					last.delta = `${String(last.delta ?? "")}${String(frame.delta ?? "")}`;
					continue;
				}
			}
			state.runFrames.push(frame);
			if (state.runFrames.length > RUN_REPLAY_MAX_FRAMES) {
				state.runOverflow = true;
				state.runFrames = [];
				return;
			}
		}
	}

	private endRun(state: SessionRunState): void {
		state.runFrames = [];
		state.runOverflow = false;
		state.runClosed = true;
		state.adapter = new PiEventToUiMessageStream();
	}

	private replayRun(sessionId: string, entry: SessionStreamEntry, set: Set<SessionStreamEntry>): void {
		const state = this.sessionStates.get(sessionId);
		if (!state || state.runClosed || state.runOverflow || state.runFrames.length === 0) return;
		for (const frame of state.runFrames) {
			if (entry.writeRaw(serializeSseFrame(frame))) continue;

			entry.closed = true;
			set.delete(entry);
			if (set.size === 0) this.sessionStreams.delete(sessionId);
			return;
		}
	}

	private emitToSession(sessionId: string, frames: UiMessageStreamFrame[]): void {
		if (frames.length === 0) return;
		const set = this.sessionStreams.get(sessionId);
		if (!set || set.size === 0) return;

		for (const entry of [...set]) {
			if (entry.closed) continue;
			this.emitFrames(entry, set, frames);
		}
		if (set.size === 0) this.sessionStreams.delete(sessionId);
	}

	private rememberClosedRun(sessionId: string, text: string): void {
		if (!this.closedRunTextBySession.has(sessionId) && this.closedRunTextBySession.size >= CLOSED_RUN_SESSIONS_MAX) {
			const oldest = this.closedRunTextBySession.keys().next().value;
			if (oldest !== undefined) this.closedRunTextBySession.delete(oldest);
		}
		this.closedRunTextBySession.set(sessionId, text);
	}

	private emitFrames(entry: SessionStreamEntry, set: Set<SessionStreamEntry>, frames: UiMessageStreamFrame[]): void {
		for (const frame of frames) {
			if (!entry.writeRaw(serializeSseFrame(frame))) {
				entry.closed = true;
				set.delete(entry);
				return;
			}

			if (frame.type !== "finish") continue;
			if (!entry.writeRaw(SSE_DONE)) {
				entry.closed = true;
				set.delete(entry);
				return;
			}

			if (entry.keepAlive) return;
			entry.closed = true;
			set.delete(entry);
			entry.onFinish?.();
			return;
		}
	}
}

export function writeSseHeaders(setHeader: (name: string, value: string) => void, writeHead: (status: number, headers: Record<string, string>) => void): void {
	writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache, no-transform",
		Connection: "keep-alive",
		"X-Accel-Buffering": "no",
		[UI_MESSAGE_STREAM_HEADER]: "v1",
	});

	void setHeader;
}
