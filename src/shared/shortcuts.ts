export type ShortcutId =
	| "openSettings"
	| "toggleDevTools"
	| "openNewSession"
	| "openSearch"
	| "findInSession"
	| "openCommandPalette"
	| "cycleModel"
	| "cycleThinking"
	| "openQuickMessages"
	| "toggleVoiceRecording"
	| "cycleSessionTabs"
	| "cycleSessionTabsReverse"
	| "closeSessionTab"
	| "zoomIn"
	| "zoomOut"
	| "openSelectionTool";

export type ShortcutGroupId = "general" | "dev";

export type ShortcutDef = {
	id: ShortcutId;
	group: ShortcutGroupId;

	labelKey: string;

	descriptionKey: string;

	defaultAccelerator: { darwin: string; other: string };

	hidden?: boolean;
};

export const SHORTCUT_DEFS: readonly ShortcutDef[] = [
	{
		id: "openSettings",
		group: "general",
		labelKey: "settings.shortcuts.openSettingsLabel",
		descriptionKey: "settings.shortcuts.openSettingsDesc",

		defaultAccelerator: { darwin: "Cmd+,", other: "Ctrl+Alt+S" },
	},
	{
		id: "openNewSession",
		group: "general",
		labelKey: "settings.shortcuts.openNewSessionLabel",
		descriptionKey: "settings.shortcuts.openNewSessionDesc",

		defaultAccelerator: { darwin: "Cmd+N", other: "Ctrl+N" },
	},
	{
		id: "openSearch",
		group: "general",
		labelKey: "settings.shortcuts.openSearchLabel",
		descriptionKey: "settings.shortcuts.openSearchDesc",

		defaultAccelerator: { darwin: "Cmd+F", other: "Ctrl+F" },
	},
	{
		id: "findInSession",
		group: "general",
		labelKey: "settings.shortcuts.findInSessionLabel",
		descriptionKey: "settings.shortcuts.findInSessionDesc",

		defaultAccelerator: { darwin: "Cmd+Shift+F", other: "Ctrl+Shift+F" },
	},
	{
		id: "openCommandPalette",
		group: "general",
		labelKey: "settings.shortcuts.openCommandPaletteLabel",
		descriptionKey: "settings.shortcuts.openCommandPaletteDesc",

		defaultAccelerator: { darwin: "Cmd+P", other: "Ctrl+P" },
	},
	{
		id: "cycleModel",
		group: "general",
		labelKey: "settings.shortcuts.cycleModelLabel",
		descriptionKey: "settings.shortcuts.cycleModelDesc",

		defaultAccelerator: { darwin: "Cmd+Alt+M", other: "Ctrl+M" },
	},
	{
		id: "cycleThinking",
		group: "general",
		labelKey: "settings.shortcuts.cycleThinkingLabel",
		descriptionKey: "settings.shortcuts.cycleThinkingDesc",

		defaultAccelerator: { darwin: "Cmd+Alt+T", other: "Ctrl+T" },
	},
	{
		id: "openQuickMessages",
		group: "general",
		labelKey: "settings.shortcuts.openQuickMessagesLabel",
		descriptionKey: "settings.shortcuts.openQuickMessagesDesc",

		defaultAccelerator: { darwin: "Cmd+Shift+M", other: "Ctrl+Shift+M" },
	},
	{
		id: "toggleVoiceRecording",
		group: "general",
		labelKey: "settings.shortcuts.toggleVoiceRecordingLabel",
		descriptionKey: "settings.shortcuts.toggleVoiceRecordingDesc",

		defaultAccelerator: { darwin: "F9", other: "F9" },
	},
	{
		id: "cycleSessionTabs",
		group: "general",
		labelKey: "settings.shortcuts.cycleSessionTabsLabel",
		descriptionKey: "settings.shortcuts.cycleSessionTabsDesc",

		defaultAccelerator: { darwin: "Ctrl+Tab", other: "Ctrl+Tab" },
	},
	{
		id: "cycleSessionTabsReverse",
		group: "general",
		labelKey: "settings.shortcuts.cycleSessionTabsReverseLabel",
		descriptionKey: "settings.shortcuts.cycleSessionTabsReverseDesc",

		defaultAccelerator: { darwin: "Ctrl+Shift+Tab", other: "Ctrl+Shift+Tab" },
	},
	{
		id: "closeSessionTab",
		group: "general",
		labelKey: "settings.shortcuts.closeSessionTabLabel",
		descriptionKey: "settings.shortcuts.closeSessionTabDesc",

		defaultAccelerator: { darwin: "Cmd+W", other: "Ctrl+W" },
	},
	{
		id: "zoomIn",
		group: "general",
		labelKey: "settings.shortcuts.zoomInLabel",
		descriptionKey: "settings.shortcuts.zoomInDesc",

		defaultAccelerator: { darwin: "Cmd+=", other: "Ctrl+=" },
	},
	{
		id: "zoomOut",
		group: "general",
		labelKey: "settings.shortcuts.zoomOutLabel",
		descriptionKey: "settings.shortcuts.zoomOutDesc",

		defaultAccelerator: { darwin: "Cmd+-", other: "Ctrl+-" },
	},
	{
		id: "openSelectionTool",
		group: "general",
		labelKey: "settings.shortcuts.openSelectionToolLabel",
		descriptionKey: "settings.shortcuts.openSelectionToolDesc",

		defaultAccelerator: { darwin: "Cmd+Shift+X", other: "Ctrl+Shift+X" },

		hidden: true,
	},
	{
		id: "toggleDevTools",
		group: "dev",
		labelKey: "settings.shortcuts.toggleDevToolsLabel",
		descriptionKey: "settings.shortcuts.toggleDevToolsDesc",

		defaultAccelerator: { darwin: "F12", other: "F12" },
	},
];

export function getShortcutDef(id: ShortcutId): ShortcutDef | undefined {
	return SHORTCUT_DEFS.find((def) => def.id === id);
}

export function resolveDefaultAccelerator(def: ShortcutDef, platform: string): string {
	return platform === "darwin" ? def.defaultAccelerator.darwin : def.defaultAccelerator.other;
}

export type ParsedAccelerator = {
	ctrl: boolean;
	meta: boolean;
	alt: boolean;
	shift: boolean;

	key: string;
};

const MODIFIER_ALIASES: Record<string, "ctrl" | "meta" | "alt" | "shift" | "cmdorctrl"> = {
	control: "ctrl",
	ctrl: "ctrl",
	option: "alt",
	opt: "alt",
	alt: "alt",
	shift: "shift",
	meta: "meta",
	super: "meta",
	win: "meta",
	cmd: "meta",
	command: "meta",
	cmdorctrl: "cmdorctrl",
	commandorcontrol: "cmdorctrl",
};

const NAMED_KEYS: Record<string, string> = {
	space: "space",
	tab: "tab",
	enter: "enter",
	return: "enter",
	esc: "escape",
	escape: "escape",
	backspace: "backspace",
	delete: "delete",
	del: "delete",
	insert: "insert",
	home: "home",
	end: "end",
	pageup: "pageup",
	pagedown: "pagedown",
	up: "up",
	down: "down",
	left: "left",
	right: "right",
	plus: "plus",
};

const PUNCTUATION_KEYS = new Set([",", ".", ";", "'", "/", "[", "]", "\\", "-", "=", "`"]);

export function normalizeKeyToken(token: string): string | null {
	const lower = token.toLowerCase();
	const named = NAMED_KEYS[lower];
	if (named) return named;
	if (/^[a-z]$/.test(lower)) return lower;
	if (/^[0-9]$/.test(lower)) return lower;
	if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) return lower;
	if (PUNCTUATION_KEYS.has(lower)) return lower;
	return null;
}

export function parseAccelerator(acc: string, platform: string): ParsedAccelerator | null {
	const tokens = acc
		.split("+")
		.map((token) => token.trim())
		.filter(Boolean);
	if (tokens.length === 0) return null;
	const parsed: ParsedAccelerator = { ctrl: false, meta: false, alt: false, shift: false, key: "" };
	let keyToken: string | null = null;
	for (const token of tokens) {
		const lower = token.toLowerCase();
		const modifier = MODIFIER_ALIASES[lower];
		if (modifier) {
			if (modifier === "cmdorctrl") {
				if (platform === "darwin") parsed.meta = true;
				else parsed.ctrl = true;
			} else if (modifier === "ctrl") parsed.ctrl = true;
			else if (modifier === "meta") parsed.meta = true;
			else if (modifier === "alt") parsed.alt = true;
			else if (modifier === "shift") parsed.shift = true;
			continue;
		}
		if (keyToken !== null) return null;
		keyToken = normalizeKeyToken(token);
		if (!keyToken) return null;
	}
	if (keyToken === null) return null;
	parsed.key = keyToken;
	return parsed;
}

export function isValidAccelerator(acc: string, platform: string): boolean {
	const parsed = parseAccelerator(acc, platform);
	if (!parsed) return false;
	const isFunctionKey = /^f([1-9]|1[0-9]|2[0-4])$/.test(parsed.key);
	if (isFunctionKey) return true;
	if (!parsed.ctrl && !parsed.meta && !parsed.alt && !parsed.shift) return false;
	return parsed.key !== "escape";
}

export type ShortcutInput = {
	key: string;
	type: string;
	control?: boolean;
	meta?: boolean;
	shift?: boolean;
	alt?: boolean;

	isComposing?: boolean;

	isAutoRepeat?: boolean;
};

export function normalizeInputKey(key: string): string {
	if (key === " ") return "space";
	const named: Record<string, string> = {
		ArrowUp: "up",
		ArrowDown: "down",
		ArrowLeft: "left",
		ArrowRight: "right",
		Esc: "escape",
		Plus: "plus",
	};
	const hit = named[key];
	if (hit) return hit;
	const lower = key.toLowerCase();
	const normalized = normalizeKeyToken(lower);
	return normalized ?? lower;
}

export function matchesAccelerator(acc: string, input: ShortcutInput, platform: string): boolean {
	if (input.type !== "keyDown") return false;
	if (input.isComposing) return false;
	const parsed = parseAccelerator(acc, platform);
	if (!parsed) return false;
	if (Boolean(input.control) !== parsed.ctrl) return false;
	if (Boolean(input.meta) !== parsed.meta) return false;
	if (Boolean(input.alt) !== parsed.alt) return false;
	if (Boolean(input.shift) !== parsed.shift) return false;
	return normalizeInputKey(input.key) === parsed.key;
}

export type KeyEventLike = {
	key: string;
	ctrlKey: boolean;
	metaKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
};

export function acceleratorKeyName(key: string): string | null {
	if (key === " ") return "Space";
	const named: Record<string, string> = {
		ArrowUp: "Up",
		ArrowDown: "Down",
		ArrowLeft: "Left",
		ArrowRight: "Right",
		Escape: "Escape",
		Backspace: "Backspace",
		Delete: "Delete",
		Insert: "Insert",
		Tab: "Tab",
		Home: "Home",
		End: "End",
		PageUp: "PageUp",
		PageDown: "PageDown",
		Enter: "Enter",
		"+": "Plus",
	};
	if (named[key]) return named[key];
	if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase();
	if (PUNCTUATION_KEYS.has(key)) return key;
	if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(key)) return key.toUpperCase();
	return null;
}

export function buildAcceleratorFromKeyEvent(event: KeyEventLike, platform: string): string | null {
	if (event.key === "Control" || event.key === "Alt" || event.key === "Shift" || event.key === "Meta") {
		return null;
	}
	const keyName = acceleratorKeyName(event.key);
	if (!keyName) return null;
	const parts: string[] = [];
	if (event.ctrlKey) parts.push("Ctrl");
	if (event.altKey) parts.push("Alt");
	if (event.shiftKey) parts.push("Shift");
	if (event.metaKey) parts.push(platform === "darwin" ? "Cmd" : "Super");
	parts.push(keyName);
	return parts.join("+");
}

export function formatKeyName(canonical: string): string {
	const named: Record<string, string> = {
		space: "Space",
		tab: "Tab",
		enter: "Enter",
		escape: "Esc",
		backspace: "Backspace",
		delete: "Del",
		insert: "Ins",
		home: "Home",
		end: "End",
		pageup: "PgUp",
		pagedown: "PgDn",
		up: "↑",
		down: "↓",
		left: "←",
		right: "→",
		plus: "+",
	};
	if (named[canonical]) return named[canonical];
	if (/^[a-z]$/.test(canonical)) return canonical.toUpperCase();
	if (/^f([1-9]|1[0-9]|2[0-4])$/.test(canonical)) return canonical.toUpperCase();
	return canonical;
}

export function formatAccelerator(acc: string, platform: string): string {
	const parsed = parseAccelerator(acc, platform);
	if (!parsed) return acc;
	const key = formatKeyName(parsed.key);
	if (platform === "darwin") {
		return `${parsed.ctrl ? "⌃" : ""}${parsed.alt ? "⌥" : ""}${parsed.shift ? "⇧" : ""}${parsed.meta ? "⌘" : ""}${key}`;
	}
	const mods: string[] = [];
	if (parsed.ctrl) mods.push("Ctrl");
	if (parsed.alt) mods.push("Alt");
	if (parsed.shift) mods.push("Shift");
	if (parsed.meta) mods.push("Win");
	return [...mods, key].join("+");
}

const ARIA_KEY_NAMES: Record<string, string> = {
	space: " ",
	tab: "Tab",
	enter: "Enter",
	escape: "Escape",
	backspace: "Backspace",
	delete: "Delete",
	insert: "Insert",
	home: "Home",
	end: "End",
	pageup: "PageUp",
	pagedown: "PageDown",
	up: "ArrowUp",
	down: "ArrowDown",
	left: "ArrowLeft",
	right: "ArrowRight",
	plus: "+",
};

export function toAriaKeyShortcuts(acc: string, platform: string): string | undefined {
	const parsed = parseAccelerator(acc, platform);
	if (!parsed) return undefined;
	const parts: string[] = [];

	if (parsed.alt) parts.push("Alt");
	if (parsed.ctrl) parts.push("Control");
	if (parsed.meta) parts.push("Meta");
	if (parsed.shift) parts.push("Shift");
	parts.push(ARIA_KEY_NAMES[parsed.key] ?? formatKeyName(parsed.key));
	return parts.join("+");
}

export function resolveShortcutBindings(overrides: Record<string, unknown> | undefined, platform: string): Record<ShortcutId, string> {
	const result = {} as Record<ShortcutId, string>;
	for (const def of SHORTCUT_DEFS) {
		const candidate = overrides?.[def.id];
		const acc = typeof candidate === "string" ? candidate.trim() : "";
		result[def.id] = acc && isValidAccelerator(acc, platform) ? acc : resolveDefaultAccelerator(def, platform);
	}
	return result;
}

export function sanitizeShortcutOverrides(raw: unknown, platform: string): Record<string, string> {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
	const out: Record<string, string> = {};
	for (const def of SHORTCUT_DEFS) {
		const value = (raw as Record<string, unknown>)[def.id];
		const acc = typeof value === "string" ? value.trim() : "";
		if (acc && isValidAccelerator(acc, platform)) out[def.id] = acc;
	}
	return out;
}
