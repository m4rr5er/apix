export function countUserTurns(messages: ReadonlyArray<{ role?: string }>): number {
	let count = 0;
	let previous: "user" | "assistant" | undefined;
	for (const message of messages) {
		if (message.role === "user") {
			if (previous !== "user") count += 1;
			previous = "user";
		} else if (message.role === "assistant") {
			previous = "assistant";
		}
	}
	return count;
}
