import type { SessionPromptSnapshot } from "./types/trajectory";

export const MAX_TRAJECTORY_PROMPT_CHARS = 96_000;

export const MAX_TRAJECTORY_PROMPT_BYTES = 262_144;

export function truncatePromptText(text: string): { text: string; truncated: boolean } {
	let units = 0;
	let bytes = 0;
	let index = 0;
	while (index < text.length) {
		const codePoint = text.codePointAt(index) ?? 0;
		const width = codePoint > 0xffff ? 2 : 1;
		const size = codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
		if (units + width > MAX_TRAJECTORY_PROMPT_CHARS || bytes + size > MAX_TRAJECTORY_PROMPT_BYTES) break;
		units += width;
		bytes += size;
		index += width;
	}
	return index >= text.length ? { text, truncated: false } : { text: text.slice(0, index), truncated: true };
}

export const MAX_TRAJECTORY_PROMPT_TOOLS = 200;

export function promptSnapshotSummary(snapshot: SessionPromptSnapshot): string {
	const head = `${snapshot.kind} · ${snapshot.text.length} chars · ${snapshot.tools.length} tools`;
	if (snapshot.kind === "initial") return head;
	const parts: string[] = [];
	if (snapshot.sectionsAdded?.length) parts.push(`sections +${snapshot.sectionsAdded.join(",")}`);
	if (snapshot.sectionsUpdated?.length) parts.push(`sections ~${snapshot.sectionsUpdated.join(",")}`);
	if (snapshot.sectionsRemoved?.length) parts.push(`sections -${snapshot.sectionsRemoved.join(",")}`);
	if (snapshot.toolsAdded?.length) parts.push(`tools +${snapshot.toolsAdded.join(",")}`);
	if (snapshot.toolsRemoved?.length) parts.push(`tools -${snapshot.toolsRemoved.join(",")}`);
	return parts.length === 0 ? head : `${head} · ${parts.join(" · ")}`;
}
