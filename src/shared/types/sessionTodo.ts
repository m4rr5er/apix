export type SessionTodoItem = {
	id: number;
	text: string;
	status: "pending" | "in_progress" | "completed";
};

export type SessionTodoSnapshot = {
	planId: number;
	todos: SessionTodoItem[];
};
