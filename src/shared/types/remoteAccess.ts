export type RemoteAccessChannelId = "cloudflare" | "tailscale";

export function isRemoteAccessChannelId(value: unknown): value is RemoteAccessChannelId {
	return value === "cloudflare" || value === "tailscale";
}

export type CloudflareTunnelState = {
	binaryAvailable: boolean;

	binaryPath: string;

	running: boolean;

	starting: boolean;

	publicUrl: string;

	error: string;
};

export type TailscaleAccessState = {
	installed: boolean;

	binaryPath: string;

	loggedIn: boolean;

	backendState: string;

	ip: string;

	dnsName: string;

	serveActive: boolean;

	serveUrl: string;

	error: string;
};

export type RemoteAccessState = {
	webRunning: boolean;

	webPort: number;

	webToken: string;

	webRequiresAuth: boolean;
	cloudflare: CloudflareTunnelState;
	tailscale: TailscaleAccessState;
};

export function emptyRemoteAccessState(): RemoteAccessState {
	return {
		webRunning: false,
		webPort: 0,
		webToken: "",
		webRequiresAuth: false,
		cloudflare: { binaryAvailable: false, binaryPath: "", running: false, starting: false, publicUrl: "", error: "" },
		tailscale: { installed: false, binaryPath: "", loggedIn: false, backendState: "", ip: "", dnsName: "", serveActive: false, serveUrl: "", error: "" },
	};
}
