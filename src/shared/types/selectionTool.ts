export const SELECTION_TOOL_WINDOW_WIDTH = 440;

export const SELECTION_TOOL_WINDOW_COLLAPSED_WIDTH = 360;

export const SELECTION_TOOL_WINDOW_COLLAPSED_HEIGHT = 46;

export const SELECTION_TOOL_WINDOW_EXPANDED_HEIGHT = 280;

export const SYSTEM_SELECTION_TOOL_ENABLED = false;

export type SelectionToolResizeInput = { width: number; height: number };

export type SelectionToolWindowState = {
	visible: boolean;

	shortcutRegistered?: boolean;

	shortcut?: string | null;
};

export type SelectionToolShowPayload = {
	text: string;

	reason?: "capture-failed" | "unsupported";
};

export type SelectionToolInsertInput = { text: string };

export const SELECTION_TOOL_TEXT_MAX_CHARS = 16_000;
