export type SendShortcut = "enter-send" | "ctrl-enter-send" | "shift-enter-send";

export type ComposerEnterIntent = "ignore" | "newline" | "send";

import type { AgentBackend, ComposerAgentMode } from "@shared/types";
import { formatPromptTemplateBlock } from "./components/session/composer/referenceBlocks";
import { extractFrontmatter, stripFrontmatter } from "./utils/frontmatter";
import { computeProtectedRanges, overlapsProtected } from "./utils/protectedText";
import { parseCommandArgs, substituteArgs } from "./utils/templateArgs";

export const PI_DECK_PLAN_MODE_MARKER = "__PI_DECK_PLAN_MODE__";
export const PI_DECK_GOAL_MODE_MARKER = "__PI_DECK_GOAL_MODE__";

export type ComposerPromptSubmission = {
	message: string;

	agentMessage?: string;
};

export function appendSlashCommandToDraft(draft: string, command: string): string {
	const token = `/${command} `;
	return draft.trimEnd() ? `${draft.trimEnd()} ${token}` : token;
}

export function toSkillInvocationToken(backend: AgentBackend, name: string): string {
	return `skill:${name}`;
}

export function stripMarkdownFrontmatter(content: string): string {
	const withoutBom = content.replace(/^\uFEFF/, "");
	const match = withoutBom.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/);
	if (!match) return withoutBom;
	return withoutBom.slice(match[0].length).replace(/^(?:\r?\n)+/, "");
}

export function appendContentToDraft(draft: string, content: string): string {
	if (!content) return draft;
	return draft.trimEnd() ? `${draft.trimEnd()}\n${content}` : content;
}

export function parseArgumentHint(content: string): string | undefined {
	const yaml = extractFrontmatter(content).yaml;
	if (yaml === null) return undefined;
	for (const line of yaml.split("\n")) {
		const idx = line.indexOf(":");
		if (idx === -1) continue;
		const key = line.slice(0, idx).trim();
		if (key === "argument-hint") {
			return line
				.slice(idx + 1)
				.trim()
				.replace(/^['"]|['"]$/g, "");
		}
	}
	// 兜底：从内容正文中扫描 ${name} / ${name:default} 模式，按首次出现顺序推断提示
	return scanArgumentHintFromBody(content);
}

function scanArgumentHintFromBody(content: string): string | undefined {
	// 去掉 frontmatter 部分
	const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
	const seen = new Map<string, { hasDefault: boolean; defaultVal?: string }>();
	const regex = /\$\{([a-zA-Z_]\w*)(?::(.*?))?\}/g;
	let m: RegExpExecArray | null;
	while ((m = regex.exec(body)) !== null) {
		const name = m[1];
		if (!seen.has(name)) {
			seen.set(name, {
				hasDefault: m[2] !== undefined,
				defaultVal: m[2],
			});
		}
	}
	if (seen.size === 0) return undefined;
	const hints: string[] = [];
	// 按首次出现顺序输出
	for (const [name, info] of seen) {
		if (info.hasDefault) {
			hints.push(`[${name}:${info.defaultVal}]`);
		} else {
			hints.push(`<${name}>`);
		}
	}
	return hints.join(" ");
}

const BUILTIN_PROMPT_DESC_CN: Record<string, string> = {
	review: "审查暂存的 Git 更改，检查 bug、安全问题和逻辑错误",
	test: "为函数或组件编写全面的测试用例",
	fix: "调试并修复问题，包含根因分析",
	refactor: "重构代码以提升可读性和可维护性",
	doc: "添加或改进文档和注释",
	explain: "用简洁的语言解释代码或架构",
	commit: "根据暂存更改生成约定式提交信息",
	"commit-own": "只提交自己修改的文件和代码（跳过无关改动）",
	"commit-split": "提交所有改动，按功能拆分为多个 commit",
	"pi-system": "查看 pi 的默认系统提示词（身份、工具、行为准则）",
	"skill-discipline": "技能执行纪律：何时及如何触发 agent 技能的规则",
};

const BUILTIN_PROMPT_DESC_EN: Record<string, string> = {
	review: "Review staged git changes for bugs, security issues, and logic errors",
	test: "Write tests for a function or component covering edge cases",
	fix: "Debug and fix issues with root cause analysis",
	refactor: "Refactor code for better readability and maintainability",
	doc: "Add or improve documentation and comments",
	explain: "Explain code or architecture in simple terms",
	commit: "Generate a conventional commit message from staged changes",
	"commit-own": "Commit only the files you modified yourself (skip unrelated changes)",
	"commit-split": "Commit all changes split into multiple commits grouped by feature",
	"pi-system": "View pi's default system prompt (identity, tools, guidelines)",
	"skill-discipline": "Skills execution discipline: rules for when and how to trigger agent skills",
};

export type PromptTemplateInfo = {
	name: string;
	path: string;
	description: string;
	content: string;
	argumentHint?: string;
	scope?: "global" | "project";
	enabled?: boolean;
};

export function translateBuiltinPromptDescription(template: PromptTemplateInfo): string {
	if (!template.path.startsWith("builtin://")) return template.description;
	// 根据 html[data-theme] 判断语言环境——中文用 CN 映射，其余用 EN
	const isChinese = typeof document !== "undefined" && document.documentElement.lang?.startsWith("zh");
	const map = isChinese ? BUILTIN_PROMPT_DESC_CN : BUILTIN_PROMPT_DESC_EN;
	return map[template.name] ?? template.description;
}

export function expandPromptTemplates(message: string, templates: PromptTemplateInfo[], options?: { reservedNames?: ReadonlySet<string> }): { message: string; description?: string; emptyTemplateName?: string } {
	if (!templates.length || !message.includes("/")) return { message };
	// 后台已经拥有这个名字（pi 扩展命令 / 技能）：不能由本地展开抢走。
	// slash 桥只认「消息以 / 开头」才会执行，一旦我们把它换成
	// `<prompt_template>` 块，host 命令就永远不会执行；pi 侧同理（扩展命令在 prompt 前处理）。
	const reserved = options?.reservedNames;

	// 按 name 长度降序排序，确保正则交替时最长匹配优先
	const sorted = [...templates].sort((a, b) => b.name.length - a.name.length);
	const nameToContent = new Map(sorted.map((t) => [t.name, t.content]));
	const nameToDescription = new Map(sorted.map((t) => [t.name, t.description]));

	// 记录最后匹配到的模板名，用于提取 description 作为元数据发送给 pi agent
	let matchedName: string | undefined;
	// 记录展开时发现正文为空的模板名（可能多个，取最后一个即可用于提示）
	let emptyTemplateName: string | undefined;

	// 命令前边界用**后顾**（`(?<=^|\s)`）、后边界用**前瞻**（`(?=(\s|$))`）：
	// 两边都不吃掉分隔符，相邻命令 `/a /b` 才能在同一遍扫描里各自被看到（2026-10 复核发现）。
	const escapedNames = sorted.map((t) => t.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
	const regex = new RegExp(`(?<=^|\\s)/(${escapedNames.join("|")})(?=(\\s|$))`, "g");

	// 已展开的自包含块（引用 / 会话引用 / 技能 / 模板）是只读区：块内的 `/模板名`
	// 属于被引用或被引述的原文，替换它会篡改引用内容（2026-10 实测：引用里提到
	// /commit，落盘后引用正文变成了整份提交模板）。
	const ranges = computeProtectedRanges(message);

	// 第一遍只收集边界：可展开的命令、要原样保留的命令（后端接管）、保护区起点。
	// 边界决定「这条命令的参数到哪里结束」——参数不能跨过下一个命令、也不能跨进引用块。
	const boundaries: number[] = ranges.map((range) => range.start);
	const expandable: Array<{ start: number; end: number; name: string }> = [];
	for (let match = regex.exec(message); match !== null; match = regex.exec(message)) {
		const start = match.index;
		const end = start + match[0].length;
		boundaries.push(start);
		const name = match[1] ?? "";
		if (!name || reserved?.has(name)) continue;
		if (overlapsProtected(start, end, ranges)) continue;
		expandable.push({ start, end, name });
	}
	if (expandable.length === 0) return { message };
	boundaries.sort((left, right) => left - right);
	const nextBoundary = (from: number) => boundaries.find((position) => position >= from) ?? message.length;

	// 单次遍历（不做级联展开）：模板正文里若恰好出现 `/另一个模板名`，不应被二次展开。
	let expanded = "";
	let cursor = 0;
	for (const command of expandable) {
		const segmentEnd = nextBoundary(command.end);
		expanded += message.slice(cursor, command.start);
		cursor = segmentEnd;
		const rawContent = nameToContent.get(command.name) ?? "/" + command.name;
		// 剥离 content 中的 frontmatter 元数据，只保留正文，
		// 避免 `---\ndescription: xxx\n---` 泄漏到 pi agent 的对话消息中。
		const content = stripFrontmatter(rawContent);
		// 正文为空时（如 UI 新建模板只有 frontmatter）不展开，保留 /name 原文：
		// 直接展开会产出空白/仅分隔符消息，被主进程拒为“消息不能为空”。
		if (!content.trim()) {
			emptyTemplateName = command.name;
			expanded += message.slice(command.start, segmentEnd);
			continue;
		}
		matchedName = command.name;
		// 参数 = 命令之后、下一个边界之前的文本（与 pi 一致地按 bash 规则切词）
		const rest = message.slice(command.end, segmentEnd).trim();
		const args = parseCommandArgs(rest);
		const substituted = substituteArgs(content, args);
		// 参数替换照 pi：占位符位置填进参数（模型看到原位插入）。
		// 但**块外仍留一份可见副本**：气泡会把整段模板正文折成 chip，只放在正文里的话，
		// 用户自己写的话会跟着一起消失（2026-10-22 用户实测：发完看不到自己的指令）。
		// 代价是模型侧多一次重复（用户参数通常很短），换来“我发的话一直看得见”。
		expanded += formatPromptTemplateBlock(command.name, substituted);
		if (rest) expanded += "\n\n" + rest;
	}
	expanded += message.slice(cursor);
	return {
		message: expanded,
		description: matchedName ? nameToDescription.get(matchedName) : undefined,
		emptyTemplateName,
	};
}

export function deriveComposerAgentMode(input: { backend?: AgentBackend; localMode?: ComposerAgentMode }): ComposerAgentMode {
	const localMode = input.localMode;
	// imagegen 是独立后端：会话为生图后端时恒为生图模式（无 LLM mode 概念）
	if (input.backend === "imagegen") return "imagegen";
	// videogen 同理：生视频后端恒为生视频模式（异步任务协议，无 LLM mode 概念）。
	if (input.backend === "videogen") return "videogen";
	// 遗留兼容：legacy 生图消息在 pi 会话上，localMode 仍可能是 imagegen，保留
	if (localMode === "imagegen") return "imagegen";
	// ACP 无隐藏 agentMessage 通道（plan/goal 的实现载体），恒普通模式；
	// 不回退 localMode 是防止残留的 pi 会话模式选择误带入发送。
	if (input.backend === "acp" || input.backend === "qoder") return "normal";
	return localMode ?? "normal";
}

export function parsePiGoalWidget(lines: readonly string[] | undefined):
	| {
			phase: "active" | "paused" | "blocked" | "complete";
			objective: string;
			roundsStarted: number;
			maxGoalRounds: number;
			blockReason?: string;
	  }
	| undefined {
	if (!lines || lines.length < 2) return undefined;
	const header = lines[0]?.trim() ?? "";
	const match = header.match(/^(active|paused|blocked|complete)\s*·\s*(\d+)\s*\/\s*(\d+)\s*$/);
	if (!match) return undefined;
	const objective = lines[1]?.trim() ?? "";
	if (!objective) return undefined;
	const phaseToken = match[1];
	if (phaseToken !== "active" && phaseToken !== "paused" && phaseToken !== "blocked" && phaseToken !== "complete") {
		return undefined;
	}
	return {
		phase: phaseToken,
		objective,
		roundsStarted: Number(match[2]),
		maxGoalRounds: Number(match[3]),
		...(phaseToken === "blocked" && lines[2]?.trim() ? { blockReason: lines[2].trim() } : {}),
	};
}

export function buildComposerPromptSubmission(message: string, mode: ComposerAgentMode): ComposerPromptSubmission {
	const trimmed = message.trim();
	// 斜线命令原样发送，让 pi 解析执行——plan/goal 模式下也能用 /plan off、/goal pause。
	// 否则隐藏标记前缀会把命令变成普通消息发给 LLM。
	if (trimmed.startsWith("/")) return { message };

	if (mode === "plan") {
		const visibleInstruction = trimmed || "请根据已附加的图片或上下文先制定实施计划。";
		return {
			message,
			agentMessage: [PI_DECK_PLAN_MODE_MARKER, visibleInstruction, "", "请先只做只读分析，不要修改文件。最后必须输出以 `Plan:` 开头的编号计划，格式如下：", "Plan:", "1. 第一步", "2. 第二步"].join("\n"),
		};
	}

	if (mode === "goal") {
		const visibleInstruction = trimmed || "请继续当前目标。";
		return {
			message,
			agentMessage: [PI_DECK_GOAL_MODE_MARKER, visibleInstruction].join("\n"),
		};
	}

	return { message };
}

type ComposerKeyboardState = {
	key: string;
	ctrlKey: boolean;
	metaKey: boolean;
	shiftKey: boolean;
	isComposing?: boolean;
	keyCode?: number;
	which?: number;
	nativeEvent?: {
		isComposing?: boolean;
		keyCode?: number;
		which?: number;
	};
};

export function getComposerEnterIntent(event: ComposerKeyboardState, sendShortcut: SendShortcut): ComposerEnterIntent {
	if (event.key !== "Enter") return "ignore";
	if (isComposingKeyboardEvent(event)) return "ignore";

	const shouldSend = sendShortcut === "enter-send" ? !event.ctrlKey && !event.metaKey && !event.shiftKey : sendShortcut === "ctrl-enter-send" ? event.ctrlKey || event.metaKey : event.shiftKey;

	if (shouldSend) return "send";
	return "newline";
}

export function isPlanModeSendKey(event: ComposerKeyboardState): boolean {
	if (event.key !== "Enter") return false;
	if (isComposingKeyboardEvent(event)) return false;
	if (event.ctrlKey || event.metaKey || event.shiftKey) return false;
	return true;
}

export function isComposingKeyboardEvent(event: ComposerKeyboardState) {
	// Shift+Enter 不可能是 IME 合成，直接跳过检测
	if (event.shiftKey) return false;
	// keyCode/which=229 是部分 Chromium/macOS 输入法在 composition 期间的兼容信号。
	return Boolean(event.isComposing || event.nativeEvent?.isComposing || event.key === "Process" || event.keyCode === 229 || event.which === 229 || event.nativeEvent?.keyCode === 229 || event.nativeEvent?.which === 229);
}

export function resolveComposerHistoryDraft(params: { activeAgentId: string | null | undefined; livePromptByAgent: Record<string, string>; renderedPrompt: string }): string {
	const { activeAgentId, livePromptByAgent, renderedPrompt } = params;
	if (!activeAgentId) return renderedPrompt;
	return livePromptByAgent[activeAgentId] ?? renderedPrompt;
}

export type ComposerHistoryNavIntent = "recall-older" | "recall-newer" | "restore-draft" | "release";

export type ComposerHistoryKeyState = {
	key: string;
	atFirstBlock: boolean;
	atLastBlock: boolean;
	atVisualTop: boolean;
	atVisualBottom: boolean;
	historyIndex: number;
	historyLength: number;
	modifier: boolean;
	hasSelection: boolean;
};

export function resolveComposerHistoryIntent(state: ComposerHistoryKeyState): ComposerHistoryNavIntent {
	if (state.key === "Escape") return state.historyIndex >= 0 ? "restore-draft" : "release";

	if (state.modifier || state.hasSelection) return "release";

	if (state.key === "ArrowUp") {
		if (!state.atFirstBlock || !state.atVisualTop) return "release";
		return state.historyLength > 0 ? "recall-older" : "release";
	}

	if (state.key === "ArrowDown") {
		// 未在浏览时 ↓ 永远只是光标下移，不回填。
		if (state.historyIndex < 0) return "release";
		if (!state.atLastBlock || !state.atVisualBottom) return "release";
		return "recall-newer";
	}

	return "release";
}

export function isYesNoConfirmOptions(options: Array<string | { label?: string; value?: string }> | undefined | null): boolean {
	if (!Array.isArray(options) || options.length !== 2) return false;
	const labels = options.map((opt) => {
		const raw = typeof opt === "string" ? opt : String(opt?.label ?? opt?.value ?? "");
		return raw.trim().toLowerCase();
	});
	// 过滤自定义入口标记，防止异常数据混入后仍被当 confirm
	if (labels.some((l) => l.startsWith("✎") || l === "__other__")) return false;
	const yesSet = new Set(["是", "yes", "y", "true", "确认", "ok", "okay"]);
	const noSet = new Set(["否", "no", "n", "false", "取消"]);
	const kinds = labels.map((l) => (yesSet.has(l) ? "yes" : noSet.has(l) ? "no" : "other"));
	return kinds.includes("yes") && kinds.includes("no") && !kinds.includes("other");
}

export function extractUserPrompts(messages: ReadonlyArray<{ role: string; text: string }>, limit = 50): string[] {
	const prompts: string[] = [];
	// 消息按时间正序，从后往前取保证最新在前
	for (let i = messages.length - 1; i >= 0 && prompts.length < limit; i--) {
		const text = messages[i].text.trim();
		if (messages[i].role !== "user" || !text || text.startsWith("!")) continue;
		prompts.push(text);
	}
	return prompts;
}

export function mergePromptHistory(runtimePrompts: readonly string[], sessionPrompts: readonly string[], limit = 50): string[] {
	const seen = new Set<string>();
	const merged: string[] = [];
	for (const prompt of [...runtimePrompts, ...sessionPrompts]) {
		if (seen.has(prompt)) continue;
		seen.add(prompt);
		merged.push(prompt);
		if (merged.length >= limit) break;
	}
	return merged;
}
