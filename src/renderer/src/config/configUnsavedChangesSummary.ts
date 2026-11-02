import { t, type TranslationKey } from "../i18n";

export type ConfigUnsavedItem = {
	tabKey: TranslationKey;
	itemKey: TranslationKey;
};

export type ConfigUnsavedSummary = {
	items: ConfigUnsavedItem[];

	totalCount: number;
};

type CatalogEntry = {
	match: (key: string) => boolean;
	tabKey: TranslationKey;
	itemKeyFor: (key: string) => TranslationKey;
};

const CATALOG: readonly CatalogEntry[] = [
	{ match: (key) => key === "config:models", tabKey: "config.backend.pi", itemKeyFor: () => "config.nav.models" },
	{ match: (key) => key === "config:auth", tabKey: "config.backend.pi", itemKeyFor: () => "config.nav.auth" },
	{ match: (key) => key === "config:settings", tabKey: "config.backend.pi", itemKeyFor: () => "config.nav.settings" },
	{ match: (key) => key === "config:trust", tabKey: "config.backend.pi", itemKeyFor: () => "config.nav.trust" },
	{ match: (key) => key === "config:mcp", tabKey: "config.backend.pi", itemKeyFor: () => "config.nav.mcp" },
	{ match: (key) => key === "config:raw", tabKey: "config.backend.pi", itemKeyFor: () => "config.nav.raw" },
	{ match: (key) => key === "security", tabKey: "config.backend.pi", itemKeyFor: () => "config.nav.security" },
	{ match: (key) => key === "extensions", tabKey: "config.backend.pi", itemKeyFor: () => "config.nav.extensions" },
	{ match: (key) => key === "skills", tabKey: "config.backend.pi", itemKeyFor: () => "config.nav.skills" },
	{ match: (key) => key === "prompts", tabKey: "config.backend.pi", itemKeyFor: () => "config.nav.prompts" },
];

function itemIdentity(tabKey: TranslationKey, itemKey: TranslationKey): string {
	return `${tabKey}\0${itemKey}`;
}

export function summarizeConfigUnsavedChanges(dirtyTabs: Iterable<string>): ConfigUnsavedSummary | null {
	const dirty = [...dirtyTabs];
	const seen = new Set<string>();
	const items: Array<{ tabKey: TranslationKey; itemKey: TranslationKey }> = [];

	for (const entry of CATALOG) {
		for (const key of dirty) {
			if (!entry.match(key)) continue;
			const tabKey = entry.tabKey;
			const itemKey = entry.itemKeyFor(key);
			const id = itemIdentity(tabKey, itemKey);
			if (seen.has(id)) continue;
			seen.add(id);
			items.push({ tabKey, itemKey });
		}
	}

	if (items.length === 0) return null;
	return {
		items,
		totalCount: items.length,
	};
}

export function formatConfigUnsavedMessage(summary: ConfigUnsavedSummary | null, translate: typeof t = t): string {
	if (!summary || summary.items.length === 0) return translate("config.unsavedMessage");
	const first = summary.items[0];
	const tab = translate(first.tabKey);
	const item = translate(first.itemKey);
	if (summary.totalCount <= 1) {
		return translate("settings.unsavedMessageDetail", { tab, item });
	}
	return translate("settings.unsavedMessageMore", {
		tab,
		item,
		count: summary.totalCount,
	});
}
