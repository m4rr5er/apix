import type { ReplyActionRule, ReplyActionTrigger, ReplyActionTriggerKind } from "./types/replyActions";

export const REPLY_ACTIONS_FILE_VERSION = 1;

export const MAX_REPLY_ACTION_RULES = 64;

const TRIGGER_KINDS: readonly ReplyActionTriggerKind[] = ["onFailure", "onStop", "always", "textMatch"];

const LEGACY_COMPLETION_PATTERN = "(?:完成|搞定|已?实现|已?修复|已?支持|改完|写完|测试通过|全部通过|验证通过)";
const LEGACY_COMPLETION_PATTERNS = ["完成", "搞定", "实现", "已实现", "修复", "已修复", "支持", "已支持", "改完", "写完", "测试通过", "全部通过", "验证通过"];

function isReplyActionTriggerKind(value: unknown): value is ReplyActionTriggerKind {
	return typeof value === "string" && (TRIGGER_KINDS as readonly string[]).includes(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sanitizeReplyActionTrigger(value: unknown): ReplyActionTrigger | null {
	if (!isPlainObject(value)) return null;
	const kind = value.kind;
	if (!isReplyActionTriggerKind(kind)) return null;
	if (kind === "textMatch") {
		const rawPatterns = value.patterns;
		if (!Array.isArray(rawPatterns)) return null;
		const patterns = rawPatterns
			.filter((pattern): pattern is string => typeof pattern === "string")
			.flatMap((pattern) => (pattern.trim() === LEGACY_COMPLETION_PATTERN ? LEGACY_COMPLETION_PATTERNS : pattern.split(/[,，]/)))
			.map((pattern) => pattern.trim())
			.filter((pattern) => pattern.length > 0);
		if (patterns.length === 0) return null;
		return { kind, patterns };
	}
	return { kind };
}

export function sanitizeReplyActionRule(value: unknown): ReplyActionRule | null {
	if (!isPlainObject(value)) return null;
	const text = value.text;
	if (typeof text !== "string") return null;
	const trimmed = text.trim();
	if (trimmed.length === 0) return null;
	const rawTriggers = value.triggers;
	if (!Array.isArray(rawTriggers)) return null;
	const triggers: ReplyActionTrigger[] = [];
	for (const rawTrigger of rawTriggers) {
		const trigger = sanitizeReplyActionTrigger(rawTrigger);

		if (!trigger) continue;
		const existing = triggers.find((candidate) => candidate.kind === trigger.kind);
		if (existing && trigger.patterns) {
			existing.patterns = [...(existing.patterns ?? []), ...trigger.patterns];
			continue;
		}
		if (existing) continue;
		triggers.push(trigger);
	}
	if (triggers.length === 0) return null;
	return { text: trimmed, triggers };
}

export function sanitizeReplyActionRuleList(value: unknown): ReplyActionRule[] {
	if (!Array.isArray(value)) return [];
	const rules: ReplyActionRule[] = [];
	const seenText = new Set<string>();
	for (const rawRule of value) {
		const rule = sanitizeReplyActionRule(rawRule);
		if (!rule) continue;
		if (seenText.has(rule.text)) continue;
		seenText.add(rule.text);
		rules.push(rule);
		if (rules.length >= MAX_REPLY_ACTION_RULES) break;
	}
	return rules;
}

export type ReplyActionsFilePayload = { version: number; items: ReplyActionRule[] };

export function sanitizeReplyActionsFile(raw: unknown): ReplyActionsFilePayload | null {
	if (Array.isArray(raw)) return { version: REPLY_ACTIONS_FILE_VERSION, items: sanitizeReplyActionRuleList(raw) };
	if (!isPlainObject(raw)) return null;
	if (!("items" in raw)) return null;
	if (!Array.isArray(raw.items)) return null;
	const version = typeof raw.version === "number" && Number.isFinite(raw.version) ? raw.version : REPLY_ACTIONS_FILE_VERSION;
	return { version, items: sanitizeReplyActionRuleList(raw.items) };
}
