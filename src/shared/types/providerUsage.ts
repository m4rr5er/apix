export type ProviderUsagePeriod = {
	percent?: number;

	resetsAt?: string;

	status?: string;
};

export type ProviderUsageKind = "periods" | "balance" | "credits";

export type ProviderUsageCredits = {
	total?: number;
	used?: number;
	remaining?: number;

	windows?: { key: string; total?: number; used?: number; remaining?: number }[];
};

export type ProviderUsageBooster = {
	balance: number;

	total?: number;

	currency?: string;

	monthlyUsed?: number;

	monthlyChargeLimit?: number;

	unlimitedMonthly?: boolean;
};

export type UsageProbeTemplateCategory = "balance" | "plan" | "subscription" | "general" | "newapi" | "cookie" | "volcengine" | "sub2api";

export type UsageProbeTemplateMeta = {
	id: string;
	category: UsageProbeTemplateCategory;
};

export type UsageProbeRecognition = {
	templateId: string;

	category: UsageProbeTemplateCategory;
};

export type UsageProbeBackend = "pi";

export type UsageProbeProviderConfig = {
	enabled?: boolean;

	template?: string;

	apiKey?: string;

	baseUrl?: string;

	accessToken?: string;

	userId?: string;

	cookie?: string;

	cookiePath?: string;

	valuePath?: string;

	currencyPath?: string;

	accessKeyId?: string;

	secretAccessKey?: string;

	panelJwt?: string;

	panelRefreshToken?: string;

	timeoutSecs?: number;

	intervalMinutes?: number;
};

export type UsageProbeProviderState = {
	enabled: boolean;

	configured: boolean;

	recognized: boolean;

	template?: string;

	intervalMinutes: number;
};

export type UsageProbeStatesResult = {
	providers: Record<string, UsageProbeProviderState>;
	errors: string[];
};

export type UsageProbeSettingsResult = {
	config?: UsageProbeProviderConfig;

	recognized: UsageProbeRecognition | null;

	templates: UsageProbeTemplateMeta[];

	errors: string[];

	legacyProbes?: UsageProbeConfig[];
};

export type UsageProbeSaveInput = {
	provider: string;

	backend?: UsageProbeBackend;
	config: UsageProbeProviderConfig;
};

export type UsageProbeSaveResult = {
	ok: boolean;

	error?: string;
};

export type UsageProbeTestInput = {
	provider: string;

	backend?: UsageProbeBackend;

	template?: string;
	apiKey?: string;
	baseUrl?: string;
	accessToken?: string;
	userId?: string;
	cookie?: string;
	cookiePath?: string;
	valuePath?: string;
	currencyPath?: string;

	accessKeyId?: string;
	secretAccessKey?: string;

	panelJwt?: string;

	panelRefreshToken?: string;

	timeoutSecs?: number;
};

export type UsageProbeWindowConfig =
	| {
			key: string;
			totalPath: string;
			usedPath: string;
			remainingPath?: string;
	  }
	| {
			key: string;

			listPath: string;

			where: { path: string; eq: unknown }[];
			totalPath: string;
			usedPath: string;
			remainingPath?: string;
	  };

export type UsageProbeBoosterConfig = {
	balancePath: string;
	totalPath?: string;
	currencyPath?: string;
	monthlyUsedCentsPath?: string;
	monthlyChargeLimitCentsPath?: string;
	monthlyChargeLimitEnabledPath?: string;
	fixedPointPerCent?: number;
};

export type UsageProbeParseConfig =
	| { kind: "periods" }
	| { kind: "balance"; valuePath: string; currencyPath?: string }
	| {
			kind: "credits";
			totalPath?: string;
			usedPath?: string;
			remainingPath?: string;

			scale?: number;
			windows?: UsageProbeWindowConfig[];
			booster?: UsageProbeBoosterConfig;
	  };

export type UsageProbeConfig = {
	name?: string;
	match?: {
		baseUrlContains?: string[];

		apiTypes?: string[];
	};
	request?: {
		path?: string;

		method?: "GET" | "POST";

		body?: unknown;

		headers?: Record<string, string>;

		rootPath?: boolean;
	};
	parse?: UsageProbeParseConfig;
};

export type ProviderUsageResult = {
	success: boolean;

	provider?: string;

	kind?: ProviderUsageKind;

	periods?: Partial<Record<"rolling" | "weekly" | "monthly", ProviderUsagePeriod>>;

	balance?: { value: number; currency?: string };

	credits?: ProviderUsageCredits;

	booster?: ProviderUsageBooster;

	panelBalanceError?: "unauthorized" | "failed";

	raw?: string;

	disabled?: boolean;

	intervalMinutes?: number;

	error?: string;

	detail?: string;

	at?: number;
};
