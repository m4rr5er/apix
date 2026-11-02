export function escapeXmlAttribute(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// 视觉桥块解析在独立模块（块结构与本模块的四类 XML 块无关，避免正则/类型交叉）。
// 视觉桥块的内联解析（原先独立在 shared/visionBridgeText，但本模块必须零 import：
// tests/sessionScannerTitleBackfill 的手写加载器把相对 import 按 tests/ 目录解析，新增依赖会整片 MODULE_NOT_FOUND）。
export type VisionBridgeBlock = { kind: "success"; index: number; description: string } | { kind: "failed"; index: number; reason: string } | { kind: "skipped"; index: number; reason: string };

const VISION_SUCCESS_MARK_RE = /\[图片 #(\d+)（视觉桥已查看[^）]*）\]/g;
const VISION_FAILED_MARK_RE = /\[图片 #(\d+)\s+视觉桥转换失败：([\s\S]*?)。请检查视觉桥设置[\s\S]*?此图片内容不可见\]/g;
const VISION_SKIPPED_MARK_RE = /\[图片 #(\d+)\s+未发送给模型：([\s\S]*?)\]/g;
const VISION_LEGACY_NOT_CONFIGURED_RE = /^视觉桥未配置/;

export function extractVisionBridgeBlocks(text: string): {
	blocks: VisionBridgeBlock[];
	text: string;
} {
	type Mark = { start: number; end: number; block: VisionBridgeBlock };
	const marks: Mark[] = [];
	for (const m of text.matchAll(VISION_FAILED_MARK_RE)) {
		const reason = m[2].trim();
		marks.push({ start: m.index, end: m.index + m[0].length, block: VISION_LEGACY_NOT_CONFIGURED_RE.test(reason) ? { kind: "skipped", index: Number(m[1]), reason } : { kind: "failed", index: Number(m[1]), reason } });
	}
	for (const m of text.matchAll(VISION_SKIPPED_MARK_RE)) {
		marks.push({ start: m.index, end: m.index + m[0].length, block: { kind: "skipped", index: Number(m[1]), reason: m[2].trim() } });
	}
	for (const m of text.matchAll(VISION_SUCCESS_MARK_RE)) {
		// 描述文本在第二轮按「下一个标记」边界补齐
		marks.push({ start: m.index, end: m.index + m[0].length, block: { kind: "success", index: Number(m[1]), description: "" } });
	}
	marks.sort((a, b) => a.start - b.start);
	if (marks.length === 0) return { blocks: [], text };
	// 成功块的完整区间延伸到下一个标记（或文本末尾），中间即描述。真实链路里描述总被追加在正文后，
	// 该边界对标题剥离安全；描述里出现「[图片 #N」字样会被误当新块，展示层容错，可接受。
	for (let i = 0; i < marks.length; i++) {
		if (marks[i].block.kind !== "success") continue;
		const nextStart = i + 1 < marks.length ? marks[i + 1].start : text.length;
		const block = marks[i].block as Extract<VisionBridgeBlock, { kind: "success" }>;
		block.description = text.slice(marks[i].end, nextStart).replace(/^\n+/, "").trim();
		marks[i].end = nextStart;
	}
	let cleaned = text;
	for (let i = marks.length - 1; i >= 0; i--) {
		cleaned = cleaned.slice(0, marks[i].start) + cleaned.slice(marks[i].end);
	}
	return { blocks: marks.map((m) => m.block), text: cleaned.replace(/\n{3,}/g, "\n\n").trim() };
}

export function decodeXmlAttribute(value: string): string {
	return value
		.replace(/&quot;/g, '"')
		.replace(/&gt;/g, ">")
		.replace(/&lt;/g, "<")
		.replace(/&amp;/g, "&");
}

export function sanitizeBlockClosingTag(value: string, tagName: string): string {
	return value.replace(new RegExp(`</${tagName}>`, "gi"), `</${tagName}_>`);
}

export function formatPromptTemplateBlock(name: string, content: string): string {
	const safeName = escapeXmlAttribute(name);
	const safeContent = sanitizeBlockClosingTag(content, "prompt_template");
	// 不 trim 模板正文：空行也可能是提示词的刻意结构；仅在 tag 边界补必要换行。
	const openingBreak = /^\r?\n/.test(safeContent) ? "" : "\n";
	const closingBreak = /\r?\n$/.test(safeContent) ? "" : "\n";
	return `<prompt_template name="${safeName}">${openingBreak}${safeContent}${closingBreak}</prompt_template>`;
}

export type ExpandedNamedReferenceBlock = {
	name: string;
	text: string;
	start: number;
	end: number;
};

function parseNamedReferenceBlocks(text: string, tagName: "skill" | "prompt_template"): ExpandedNamedReferenceBlock[] {
	if (!text.includes(`<${tagName}`)) return [];
	const re = new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)<\\/${tagName}>`, "gi");
	const blocks: ExpandedNamedReferenceBlock[] = [];
	let match: RegExpExecArray | null;
	while ((match = re.exec(text)) !== null) {
		const attrs = match[1] ?? "";
		const name = /\bname="([^"]*)"/i.exec(attrs)?.[1];
		if (!name) continue;
		blocks.push({
			name: decodeXmlAttribute(name),
			text: (match[2] ?? "").replace(/^\r?\n|\r?\n$/g, ""),
			start: match.index,
			end: match.index + match[0].length,
		});
	}
	return blocks;
}

export function parseExpandedSkillBlocks(text: string): ExpandedNamedReferenceBlock[] {
	return parseNamedReferenceBlocks(text, "skill");
}

export function parseExpandedPromptTemplateBlocks(text: string): ExpandedNamedReferenceBlock[] {
	return parseNamedReferenceBlocks(text, "prompt_template");
}

export type ExpandedQuoteBlock = {
	label: string;
	messageId: string;
	text: string;
	start: number;
	end: number;
};

const QUOTED_CONTEXT_RE = /<quoted_context\s+label="([^"]*)"\s+message_id="([^"]*)">\r?\n([\s\S]*?)\r?\n<\/quoted_context>/g;

export function parseExpandedQuoteBlocks(text: string): ExpandedQuoteBlock[] {
	const blocks: ExpandedQuoteBlock[] = [];
	const re = new RegExp(QUOTED_CONTEXT_RE.source, "g");
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		blocks.push({
			label: decodeXmlAttribute(m[1] ?? ""),
			messageId: decodeXmlAttribute(m[2] ?? ""),
			text: m[3] ?? "",
			start: m.index,
			end: m.index + m[0].length,
		});
	}
	return blocks;
}

export type ExpandedSessionBlock = {
	name: string;
	text: string;
	start: number;
	end: number;
};

const REFERENCED_SESSION_RE = /<referenced_session\s+name="([^"]*)">\r?\n([\s\S]*?)\r?\n<\/referenced_session>/g;

export function parseExpandedSessionBlocks(text: string): ExpandedSessionBlock[] {
	if (!text.includes("<referenced_session")) return [];
	const blocks: ExpandedSessionBlock[] = [];
	const re = new RegExp(REFERENCED_SESSION_RE.source, "g");
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		blocks.push({
			name: decodeXmlAttribute(m[1] ?? ""),
			text: m[2] ?? "",
			start: m.index,
			end: m.index + m[0].length,
		});
	}
	return blocks;
}

export type ExpandedRefBlock =
	| { kind: "quote"; label: string; messageId: string; text: string; start: number; end: number }
	| { kind: "session"; name: string; text: string; start: number; end: number }
	| { kind: "skill"; label: string; text: string; start: number; end: number }
	| { kind: "template"; label: string; text: string; start: number; end: number };

export function parseExpandedRefBlocks(text: string): ExpandedRefBlock[] {
	const blocks: ExpandedRefBlock[] = [
		...parseExpandedQuoteBlocks(text).map((b) => ({
			kind: "quote" as const,
			label: b.label,
			messageId: b.messageId,
			text: b.text,
			start: b.start,
			end: b.end,
		})),
		...parseExpandedSessionBlocks(text).map((b) => ({
			kind: "session" as const,
			name: b.name,
			text: b.text,
			start: b.start,
			end: b.end,
		})),
		...parseExpandedSkillBlocks(text).map((b) => ({
			kind: "skill" as const,
			// pi 的 XML 只保存 skill 名；还原为输入框一致的 /skill:name 形态。
			label: `skill:${b.name}`,
			text: b.text,
			start: b.start,
			end: b.end,
		})),
		...parseExpandedPromptTemplateBlocks(text).map((b) => ({
			// 独立 kind：与 pi 的资源类型对齐（skill / prompt 两种），展示层再决定复用哪套视觉。
			kind: "template" as const,
			label: b.name,
			text: b.text,
			start: b.start,
			end: b.end,
		})),
	];
	blocks.sort((a, b) => a.start - b.start || b.end - a.end);

	const topLevel: ExpandedRefBlock[] = [];
	let coveredEnd = -1;
	for (const block of blocks) {
		if (block.start < coveredEnd) continue;
		topLevel.push(block);
		coveredEnd = block.end;
	}
	return topLevel;
}

function expandedRefBlockLabel(block: ExpandedRefBlock): string {
	return block.kind === "quote" ? `❝${block.label}` : block.kind === "session" ? `&${block.name}` : `/${block.label}`;
}

export function replaceExpandedRefBlocksWithLabels(text: string): string {
	if (!text.includes("<quoted_context") && !text.includes("<referenced_session") && !text.includes("<skill") && !text.includes("<prompt_template")) {
		return text;
	}
	const blocks = parseExpandedRefBlocks(text);
	if (blocks.length === 0) return text;
	const parts: string[] = [];
	let cursor = 0;
	for (const block of blocks) {
		if (block.start > cursor) parts.push(text.slice(cursor, block.start));
		parts.push(expandedRefBlockLabel(block));
		cursor = block.end;
	}
	if (cursor < text.length) parts.push(text.slice(cursor));
	return parts.join("");
}

export function textForSessionTitle(text: string): string {
	// 视觉桥块先剥：图片在 input 阶段被转成「[图片 #N…]＋视觉模型描述」追加在正文后，
	// 标记行与描述都不是用户手写的话；只发图不写字时剥完为空，调用方回退到 assistant 首条文本
	//（2026-10 现场：只发图的消息把会话自动命名为「[图片 #1（视觉桥已查看…）]」）。
	const stripped = extractVisionBridgeBlocks(text).text;
	if (!stripped.includes("<")) return stripped;
	const blocks = parseExpandedRefBlocks(stripped);
	if (blocks.length === 0) return stripped;
	const outside: string[] = [];
	const labels: string[] = [];
	let cursor = 0;
	for (const block of blocks) {
		if (block.start > cursor) outside.push(stripped.slice(cursor, block.start));
		labels.push(expandedRefBlockLabel(block));
		cursor = block.end;
	}
	if (cursor < stripped.length) outside.push(stripped.slice(cursor));
	// 块之间的分隔换行只用于排版，标题里合并成一个空格（存储层仍不截断）。
	const outsideText = outside.join(" ").replace(/\s+/g, " ").trim();
	return outsideText || labels.join(" ");
}

export function looksLikeExpandedRefBlockTitle(title: string | undefined): boolean {
	// 视觉桥标记开头的存量脏标题按用户决定不自动重命名（旧会话名保持稳定），
	// 不在此判定；新会话的正确命名由 textForSessionTitle 剥块保证。
	if (!title?.includes("<")) return false;
	// 完整块（带闭合标签）一定能解析出来，块不在开头（`帮我看看 <quoted_context …>`）也命中。
	if (parseExpandedRefBlocks(title).length > 0) return true;
	// 写入方截断/只落了半个块时没有闭合标签，按「带 name/label 属性的块开标签」判定。
	// 不用裸 `<skill>` 之类无属性形态，避免把用户手写的「<skill> 是什么意思」误判成脏标题。
	return /<(?:quoted_context|referenced_session|skill|prompt_template)\b[^>]*\b(?:name|label)="/i.test(title);
}
