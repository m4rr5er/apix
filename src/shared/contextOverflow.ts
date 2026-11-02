export function isContextOverflowError(value: unknown): boolean {
	const raw = typeof value === "string" ? value : value instanceof Error ? value.message : String(value ?? "");
	const text = raw.trim().toLowerCase();
	if (!text) return false;
	return ["context_length_exceeded", "context length exceeded", "context window exceeded", "maximum context length", "prompt is too long", "prompt too long", "too many tokens", "token limit exceeded"].some((marker) => text.includes(marker));
}
