import type { LocalServiceStatus } from "../localServices";

export type HostPluginPermission = "sessions.read" | "workbench.navigate" | "workbench.openExternal" | "network.https" | "network.local" | "service.local";

export type HostPluginNetworkPolicy = { httpsOrigins?: string[]; localPorts?: number[] };

export type HostPluginServicePolicy = { ids: string[] };

export type HostPluginNetworkRequest = { url: string; method?: "GET" | "POST"; headers?: Record<string, string>; body?: string; timeoutMs?: number };
export type HostPluginNetworkResponse = { url: string; status: number; ok: boolean; headers: Record<string, string>; body: string };

export type HostPluginPanelPresentation = "modal" | "page" | "popover";
export type HostPluginManifest = {
	schemaVersion: 1;
	apiVersion: 1;
	id: string;
	name: string;
	version: string;
	description?: string;
	permissions: HostPluginPermission[];
	network?: HostPluginNetworkPolicy;

	services?: string[];
	contributes: {
		panels: Array<{ id: string; title: string; entry: string; icon?: string; presentation?: HostPluginPanelPresentation }>;
		commands: Array<{ id: string; title: string; panelId: string }>;
	};
};

export type HostPluginInfo = {
	manifest: HostPluginManifest;
	fingerprint: string;
	enabled: boolean;

	requiresConsent: boolean;
};
export type HostPluginCatalog = { directory: string; plugins: HostPluginInfo[]; issues: Array<{ directory: string; code: string }> };
export type HostPluginResult<T> = { ok: true; value: T } | { ok: false; code: string };

export type HostPluginContext = {
	projectId?: string;

	projectName?: string;
	sessionId?: string;

	sessionTitle?: string;
	locale: "zh-CN" | "en-US";
	theme: "light" | "dark";

	tokens?: Record<string, string>;
};
export type HostPluginSession = {
	id: string;
	projectId: string;
	title: string;
	updatedAt: number;
	createdAt: number;
	model?: string;
	readable: boolean;
};
export type HostPluginSessionPage = { sessions: HostPluginSession[]; nextOffset: number | null };
export type HostPluginEntryCursor = { before: number; version: string };
export type HostPluginEntriesPage = {
	entries: Record<string, unknown>[];
	nextCursor: HostPluginEntryCursor | null;
	version: string;

	truncated: boolean;
};

export type HostPluginSessionsChangedDetail = { catalogChanged: boolean; sessionId?: string };
export type HostPluginEvent = { type: "context.changed"; context: HostPluginContext } | { type: "sessions.changed"; detail?: HostPluginSessionsChangedDetail };
export type HostPluginRequest =
	| { method: "context.get" }
	| { method: "sessions.list"; offset?: number }
	| { method: "sessions.get"; sessionId: string }
	| { method: "sessions.search"; query: string; limit?: number }
	| { method: "sessions.entries"; sessionId: string; cursor?: HostPluginEntryCursor }
	| { method: "storage.get"; key: string }
	| { method: "storage.set"; key: string; value: unknown }
	| { method: "storage.keys" }
	| { method: "storage.delete"; key: string }
	| { method: "workbench.navigate"; sessionId: string; entryId?: string }
	| { method: "workbench.openExternal"; url: string }
	| { method: "service.status"; id: string }
	| { method: "service.start"; id: string }
	| { method: "service.stop"; id: string }
	| { method: "service.openUi"; id: string }
	| { method: "network.request"; request: HostPluginNetworkRequest };
export type HostPluginResponse = HostPluginResult<unknown>;
export type HostPluginMountInput = { pluginId: string; panelId: string; context: HostPluginContext };
export type HostPluginMount = { instanceId: string; entryUrl: string };
export type HostPluginNavigateInput = { projectId: string; sessionId: string; entryId?: string };

export type HostPluginScaffoldInput = {
	id: string;
	name: string;
	permissions: HostPluginPermission[];
	network?: HostPluginNetworkPolicy;

	services?: string[];
	presentation: HostPluginPanelPresentation;
};

export type HostPluginDesktopApi = {
	list: () => Promise<HostPluginResult<HostPluginCatalog>>;
	rescan: () => Promise<HostPluginResult<HostPluginCatalog>>;

	scaffold: (input: HostPluginScaffoldInput) => Promise<HostPluginResult<HostPluginCatalog>>;
	setEnabled: (id: string, enabled: boolean, fingerprint: string) => Promise<HostPluginResult<HostPluginCatalog>>;
	openDirectory: () => Promise<HostPluginResult<void>>;

	install: () => Promise<HostPluginResult<HostPluginCatalog>>;

	installDirectory: () => Promise<HostPluginResult<HostPluginCatalog>>;

	installGitHub: (url: string) => Promise<HostPluginResult<HostPluginCatalog>>;

	remove: (id: string) => Promise<HostPluginResult<HostPluginCatalog>>;
	mount: (input: HostPluginMountInput) => Promise<HostPluginResult<HostPluginMount>>;
	update: (instanceId: string, context: HostPluginContext) => Promise<HostPluginResult<void>>;
	unmount: (instanceId: string) => Promise<HostPluginResult<void>>;
	onChanged: (listener: () => void) => () => void;

	onNavigate: (listener: (input: HostPluginNavigateInput) => void) => () => void;

	onOpenBrowser: (listener: (url: string) => void) => () => void;
};

export type HostPluginApi = {
	apiVersion: 1;

	context: { get: () => Promise<HostPluginContext> };
	sessions: {
		list: (offset?: number) => Promise<HostPluginSessionPage>;

		get: (sessionId: string) => Promise<HostPluginSession>;

		search: (query: string, limit?: number) => Promise<HostPluginSession[]>;
		entries: (sessionId: string, cursor?: HostPluginEntryCursor) => Promise<HostPluginEntriesPage>;
	};
	storage: {
		get: (key: string) => Promise<unknown>;
		set: (key: string, value: unknown) => Promise<void>;

		keys: () => Promise<string[]>;
		remove: (key: string) => Promise<void>;
	};
	workbench: {
		navigate: (sessionId: string, entryId?: string) => Promise<void>;

		openExternal: (url: string) => Promise<void>;
	};

	network: { request: (input: HostPluginNetworkRequest) => Promise<HostPluginNetworkResponse> };

	services: {
		status: (id: string) => Promise<LocalServiceStatus>;
		start: (id: string) => Promise<LocalServiceStatus>;
		stop: (id: string) => Promise<LocalServiceStatus>;
		openUi: (id: string) => Promise<void>;
	};
	onEvent: (listener: (event: HostPluginEvent) => void) => () => void;
};

export type HostPluginSessionsRevision = { catalog: string; active?: { sessionId: string; file: string } };
