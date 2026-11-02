export interface ActiveToolCallState {
	calls: Map<string, string>;
	isExecutingTool: boolean;
	executingToolName?: string;
	completedBatch: boolean;
}

function resolveEndToolCallKey(calls: ReadonlyMap<string, string>, toolCallId: string, toolName: string | undefined): string | undefined {
	if (toolCallId && calls.has(toolCallId)) return toolCallId;

	if (toolCallId) return undefined;
	if (toolName) {
		const matched = Array.from(calls.entries())
			.filter(([, name]) => name === toolName)
			.at(-1);
		if (matched) return matched[0];
	}

	if (calls.size === 1) return Array.from(calls.keys())[0];
	return undefined;
}

export function updateActiveToolCalls(current: ReadonlyMap<string, string>, event: { type: "start"; toolCallId: string; toolName: string } | { type: "end"; toolCallId: string; toolName?: string }): ActiveToolCallState {
	const calls = new Map(current);
	if (event.type === "start") {
		calls.set(event.toolCallId, event.toolName);
	} else {
		const key = resolveEndToolCallKey(calls, event.toolCallId, event.toolName);
		if (key !== undefined) calls.delete(key);
	}
	const executingToolName = Array.from(calls.values()).at(-1);
	return {
		calls,
		isExecutingTool: calls.size > 0,
		executingToolName,
		completedBatch: event.type === "end" && current.size > 0 && calls.size === 0,
	};
}
