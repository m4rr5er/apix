import { stripAnsi } from "./fileChanges.ts";

const EXTRA_ESCAPE_RE = /\u001b(?:\[[0-9;?<=>!]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[()*+][0-9A-Za-z]|[P^_X][^\u001b]*(?:\u001b\\)?|[@-Z\\-_])/g;

export function stripAnsiText(text: string): string {
	return stripAnsi(text)
		.replace(EXTRA_ESCAPE_RE, "")
		.replace(/\u001b/g, "");
}
