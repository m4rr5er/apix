import type { MainProcessTranslationKey } from "./i18n/mainProcessCopy";
import { mainProcessT } from "./i18n/mainProcessCopy";
import { isFileChangeToolName } from "./fileChanges.ts";

export const TOOL_DETAIL_MAX_CHARS = 8000;

export const TOOL_ARGS_FILE_CHANGE_MAX_CHARS = 1_000_000;

export function serializeToolArgsForDelivery(toolName: string, args: unknown, translate: ToolDetailTranslate): string {
	const maxChars = isFileChangeToolName(toolName) ? TOOL_ARGS_FILE_CHANGE_MAX_CHARS : TOOL_DETAIL_MAX_CHARS;
	return truncateForDetail(safeJson(args), translate, maxChars);
}

export type ToolDetailTranslate = (key: MainProcessTranslationKey, params?: Record<string, string | number>) => string;

export type ToolDetailStatus = "running" | "done" | "error";

export function defaultToolDetailTranslate(key: MainProcessTranslationKey, params?: Record<string, string | number>): string {
	return mainProcessT("zh-CN", key, params);
}

export function safeJson(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

export function extractToolResultText(result: unknown): string {
	if (typeof result === "string") return result;
	if (!result || typeof result !== "object") return "";
	const content = (result as { content?: unknown }).content;
	if (!Array.isArray(content)) return "";
	return content
		.map((item) => {
			if (!item || typeof item !== "object") return "";
			const text = (item as { text?: unknown }).text;
			return typeof text === "string" ? text : "";
		})
		.filter(Boolean)
		.join("\n");
}

function extractToolDetails(result: unknown): unknown {
	if (!result || typeof result !== "object") return undefined;
	return (result as { details?: unknown }).details;
}

function extractRawCommand(args: unknown): string | undefined {
	if (!args || typeof args !== "object" || !("command" in args)) return undefined;
	const command = args.command;
	return typeof command === "string" ? command : undefined;
}

export type PiToolTruncation = {
	truncatedBy?: string;
	totalLines?: number;
	totalBytes?: number;
	fullOutputPath?: string;
};

export function extractPiToolTruncation(result: unknown): PiToolTruncation | undefined {
	if (!result || typeof result !== "object") return undefined;

	const details = (result as { details?: unknown }).details;
	const source: Record<string, unknown> = details && typeof details === "object" ? (details as Record<string, unknown>) : (result as Record<string, unknown>);
	const truncation = source.truncation;
	if (!truncation || typeof truncation !== "object") return undefined;
	const t = truncation as Record<string, unknown>;
	const fullOutputPath = typeof source.fullOutputPath === "string" && source.fullOutputPath ? source.fullOutputPath : typeof t.fullOutputPath === "string" && t.fullOutputPath ? t.fullOutputPath : undefined;
	return {
		truncatedBy: typeof t.truncatedBy === "string" ? t.truncatedBy : undefined,
		totalLines: typeof t.totalLines === "number" ? t.totalLines : undefined,
		totalBytes: typeof t.totalBytes === "number" ? t.totalBytes : undefined,
		...(fullOutputPath ? { fullOutputPath } : {}),
	};
}

export function truncateForDetail(text: unknown, translate: ToolDetailTranslate, maxChars = TOOL_DETAIL_MAX_CHARS): string {
	const str = typeof text === "string" ? text : text == null ? "" : String(text);
	if (str.length <= maxChars) return str;
	const keep = Math.floor(maxChars / 2);
	const omitted = str.length - keep * 2;
	return `${str.slice(0, keep)}\n` + `${translate("mainTool.truncated", { omitted, total: str.length })}\n` + str.slice(-keep);
}

export function truncateDetailWithMeta(text: string, translate: ToolDetailTranslate, maxChars = TOOL_DETAIL_MAX_CHARS): { text: string; truncated: boolean; fullLength: number } {
	if (text.length <= maxChars) {
		return { text, truncated: false, fullLength: text.length };
	}
	const keep = Math.floor(maxChars / 2);
	const omitted = text.length - keep * 2;
	return {
		text: `${text.slice(0, keep)}\n` + `${translate("mainTool.truncated", { omitted, total: text.length })}\n` + text.slice(-keep),
		truncated: true,
		fullLength: text.length,
	};
}

export function formatToolDetail(toolName: string, args: unknown, result: unknown, status: ToolDetailStatus, translate: ToolDetailTranslate): string {
	const details = extractToolDetails(result);
	let argsObj = args;
	if (typeof args === "string" && args.trim()) {
		try {
			argsObj = JSON.parse(args) as unknown;
		} catch {}
	}
	const argsText = argsObj ? truncateForDetail(safeJson(argsObj), translate) : "";
	const rawCommand = toolName.trim().toLowerCase() === "bash" ? extractRawCommand(argsObj) : undefined;
	const commandText = rawCommand === undefined ? "" : truncateForDetail(rawCommand, translate);
	const resultText = result ? truncateForDetail(extractToolResultText(result) || safeJson(result), translate) : "";
	const detailsText = details ? truncateForDetail(safeJson(details), translate) : "";
	const statusText = translate(status === "error" ? "mainTool.failed" : status === "running" ? "mainTool.running" : "mainTool.done");
	const argsSection = args ? (rawCommand !== undefined ? translate("mainTool.command", { command: commandText }) : translate("mainTool.arguments", { value: argsText })) : "";
	const sections = [translate("mainTool.name", { name: toolName || "tool" }), translate("mainTool.status", { status: statusText }), argsSection, result ? translate("mainTool.result", { value: resultText }) : "", details ? translate("mainTool.details", { value: detailsText }) : ""].filter(Boolean);
	return sections.join("\n\n");
}
