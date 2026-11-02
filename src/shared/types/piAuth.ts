export type PiAuthMethod = "oauth" | "api_key";

export type PiAuthOAuthOption = {
	label: string;

	isSubscription: boolean;
};

export type PiAuthApiKeyOption = {
	name: string;

	canLogin: boolean;
};

export type PiAuthProviderOption = {
	id: string;
	name: string;
	oauth?: PiAuthOAuthOption;
	apiKey?: PiAuthApiKeyOption;

	ambientOnly: boolean;
	credential?: { type: PiAuthMethod };
};

export type PiAuthProviderList = {
	providers: PiAuthProviderOption[];

	piVersion?: string;
};

export type PiAuthFlowEvent =
	| { type: "info"; message: string; links?: readonly { url: string; label?: string }[] }
	| { type: "auth_url"; url: string; instructions?: string }
	| { type: "device_code"; userCode: string; verificationUri: string; intervalSeconds?: number; expiresInSeconds?: number }
	| { type: "progress"; message: string };

export type PiAuthPrompt = {
	id: string;
	kind: "text" | "secret" | "select" | "manual_code";
	message: string;
	placeholder?: string;

	options?: readonly { id: string; label: string; description?: string }[];
};

export type PiAuthFlowUpdate = { kind: "event"; event: PiAuthFlowEvent } | { kind: "prompt"; prompt: PiAuthPrompt } | { kind: "prompt-cancelled"; promptId: string };

export type PiAuthLoginRequest = {
	providerId: string;
	method: PiAuthMethod;
};

export type PiAuthErrorKind = "unknown-provider" | "unsupported" | "login-failed" | "sdk-unavailable" | "spawn-failed" | "busy" | "timeout" | "protocol";

export type PiAuthLoginResult = {
	ok: boolean;

	cancelled: boolean;
	providerId: string;

	error?: string;
	errorKind?: PiAuthErrorKind;
};

export type PiAuthLogoutResult = {
	ok: boolean;
	providerId: string;
	error?: string;
};
