export type ReplyActionTriggerKind = "onFailure" | "onStop" | "always" | "textMatch";

export type ReplyActionTrigger = {
	kind: ReplyActionTriggerKind;

	patterns?: string[];
};

export type ReplyActionRule = {
	text: string;

	triggers: ReplyActionTrigger[];
};

export type ReplyActionsSnapshot = {
	items: ReplyActionRule[];

	defaults: ReplyActionRule[];

	filePath: string;

	seeded: boolean;

	defaultsAvailable: boolean;
};

export type ReplyActionsSaveResult = { ok: true; snapshot: ReplyActionsSnapshot } | { ok: false; error: string };
