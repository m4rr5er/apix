export const FAVORITE_TEXT_MAX_CHARS = 60_000;

export const FAVORITE_TEXT_INPUT_MAX_CHARS = 400_000;

export const FAVORITE_ENTRY_LIMIT = 2_000;

export const FAVORITE_META_MAX_CHARS = 200;

export const FAVORITE_SESSION_TITLE_MAX_CHARS = 200;

export type FavoriteKind = "message" | "selection";

export type FavoriteRole = "user" | "assistant" | "system";

export type FavoriteEntry = {
	id: string;

	createdAt: number;
	kind: FavoriteKind;

	text: string;
	role: FavoriteRole | null;
	sessionId: string | null;
	sessionTitle: string | null;
	projectId: string | null;

	messageId: string | null;

	model: string | null;

	partial: boolean;

	truncated: boolean;
};

export type AddFavoriteInput = {
	kind: FavoriteKind;
	text: string;
	role?: FavoriteRole | null;
	sessionId?: string | null;
	sessionTitle?: string | null;
	projectId?: string | null;
	messageId?: string | null;
	model?: string | null;
	partial?: boolean;
};
