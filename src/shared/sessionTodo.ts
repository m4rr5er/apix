import type { SessionTodoSnapshot } from "./types/sessionTodo.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseTodoSnapshotData(data: unknown): SessionTodoSnapshot | undefined {
	if (!isRecord(data)) return undefined;
	if (data.version !== 3) return undefined;
	const plan = isRecord(data.activePlan) ? data.activePlan : undefined;
	if (!plan) return undefined;
	const planId = typeof plan.id === "number" && Number.isSafeInteger(plan.id) && plan.id > 0 ? plan.id : 0;
	if (!Array.isArray(plan.todos)) return { planId, todos: [] };
	const todos: SessionTodoSnapshot["todos"] = [];
	for (const raw of plan.todos) {
		if (!isRecord(raw)) continue;
		const id = raw.id;
		if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) continue;
		const text = raw.text;
		if (typeof text !== "string" || !text.trim()) continue;
		const status = raw.status;
		if (status !== "pending" && status !== "in_progress" && status !== "completed") continue;
		todos.push({ id, text, status });
	}
	return { planId, todos };
}
