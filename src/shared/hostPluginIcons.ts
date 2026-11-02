export const HOST_PLUGIN_PANEL_ICON_NAMES = ["bar-chart", "activity", "database", "table", "calendar", "file-text", "terminal", "globe", "git-branch", "message", "clock", "layers"] as const;

export type HostPluginPanelIconName = (typeof HOST_PLUGIN_PANEL_ICON_NAMES)[number];

export const isHostPluginPanelIconName = (value: unknown): value is HostPluginPanelIconName => typeof value === "string" && (HOST_PLUGIN_PANEL_ICON_NAMES as readonly string[]).includes(value);
