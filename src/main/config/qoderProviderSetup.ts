import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { AvailableModel } from "../../shared/types";
import type { AppSettings } from "../../shared/types/settings";
import type { QoderProviderModel, QoderProviderRegion, QoderProviderSetupInput, QoderProviderSetupResult, QoderProviderStatus } from "../../shared/types/qoderProvider";
import type { PiLocator } from "../pi/PiLocator";
import { parsePiListModels } from "../pi/modelListCache";

const LIST_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 1_000_000;
const QODER_PROVIDERS = new Set(["qoder", "qoder-cn"]);

export type QoderProviderSetupDeps = {
	piLocator: PiLocator;
	getSettings: () => AppSettings;

	afterLogin?: () => Promise<void> | void;
	logger?: { info(channel: string, message: string, meta?: Record<string, unknown>): void; warn(channel: string, message: string, meta?: Record<string, unknown>): void };
};

function stripAnsi(text: string): string {
	return text.replace(/\u001b\[[0-9;]*m/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseQoderModels(output: string): QoderProviderModel[] {
	return parsePiListModels(stripAnsi(output))
		.filter((model) => QODER_PROVIDERS.has(model.provider))
		.map((model) => ({
			provider: model.provider,
			id: model.id,
			...(model.name && model.name !== model.id ? { name: model.name } : {}),
			...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
			...(model.maxTokens !== undefined ? { maxTokens: model.maxTokens } : {}),
			...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
			...(model.images !== undefined ? { images: model.images } : {}),
		}));
}

export function qoderModelsFromCatalog(models: readonly AvailableModel[] | null | undefined): QoderProviderModel[] {
	return (models ?? [])
		.filter((model) => QODER_PROVIDERS.has(model.provider))
		.map((model) => ({
			provider: model.provider,
			id: model.id,
			...(model.name && model.name !== model.id ? { name: model.name } : {}),
			...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
			...(model.maxTokens !== undefined ? { maxTokens: model.maxTokens } : {}),
			...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
			...(model.images !== undefined ? { images: model.images } : {}),
		}));
}

export function hasQoderProviderAuth(configDir: string): boolean {
	try {
		const parsed: unknown = JSON.parse(readFileSync(join(configDir, "auth.json"), "utf8"));
		return isRecord(parsed) && (Object.hasOwn(parsed, "qoder") || Object.hasOwn(parsed, "qoder-cn"));
	} catch {
		return false;
	}
}

export async function getQoderProviderStatus(deps: { readAuth: () => Promise<{ parsed: unknown }>; models: () => QoderProviderModel[] }): Promise<QoderProviderStatus> {
	let region: QoderProviderRegion | null = null;
	try {
		const auth = await deps.readAuth();
		if (isRecord(auth.parsed)) {
			if (Object.hasOwn(auth.parsed, "qoder-cn")) region = "cn";
			else if (Object.hasOwn(auth.parsed, "qoder")) region = "global";
		}
	} catch {}
	return { configured: region !== null, region, models: region ? deps.models() : [] };
}

export async function setupQoderProvider(deps: QoderProviderSetupDeps, input: QoderProviderSetupInput): Promise<QoderProviderSetupResult> {
	const settings = deps.getSettings();
	if (settings.wslEnabled) return { ok: false, models: [], error: "Qoder provider PAT setup is not supported for WSL pi; run `pi` inside WSL and use `/login qoder`." };
	const region = input.region === "cn" ? "cn" : "global";
	const pat = input.pat.trim();
	if (!pat || pat.length > 4096) return { ok: false, models: [], error: "Invalid Qoder PAT." };
	const command = deps.piLocator.resolveCommand(settings.customPiPath, false, settings.wslDistro, settings.wslUser);
	const invocation = deps.piLocator.createInvocation(command, ["--list-models"]);
	const envName = region === "cn" ? "QODERCN_PERSONAL_ACCESS_TOKEN" : "QODER_PERSONAL_ACCESS_TOKEN";
	const env = { ...deps.piLocator.createProcessEnv(undefined, invocation.pathPrefix, invocation.wsl), [envName]: pat };
	return await new Promise<QoderProviderSetupResult>((resolve) => {
		let stdout = "";
		let stderr = "";
		let settled = false;
		const finish = (result: QoderProviderSetupResult) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(result);
		};
		const succeed = async (models: QoderProviderModel[]) => {
			try {
				await deps.afterLogin?.();
			} catch (error) {
				deps.logger?.warn("qoder-provider", "Qoder provider model refresh after login failed", { region, error: error instanceof Error ? error.message : String(error) });
			}
			deps.logger?.info("qoder-provider", "Qoder PAT login and model discovery completed", { region, modelCount: models.length });
			finish({ ok: true, models });
		};
		const proc = spawn(invocation.command, invocation.args, { env, cwd: process.cwd(), shell: invocation.shell, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
		const timer = setTimeout(() => {
			try {
				proc.kill();
			} catch {}
			finish({ ok: false, models: [], error: "Qoder model list timed out." });
		}, LIST_TIMEOUT_MS);
		proc.stdout?.on("data", (chunk: Buffer) => {
			if (stdout.length < MAX_OUTPUT_CHARS) stdout += chunk.toString("utf8");
		});
		proc.stderr?.on("data", (chunk: Buffer) => {
			if (stderr.length < MAX_OUTPUT_CHARS) stderr += chunk.toString("utf8");
		});
		proc.once("error", (error) => finish({ ok: false, models: [], error: error.message }));
		proc.once("exit", (code) => {
			const models = parseQoderModels(stdout);
			if (code === 0 && models.length > 0) {
				void succeed(models);
				return;
			}
			const detail = stripAnsi(`${stderr}\n${stdout}`).trim().slice(-2000).split(pat).join("***");
			deps.logger?.warn("qoder-provider", "Qoder PAT setup failed", { region, exitCode: code, output: detail });
			finish({ ok: false, models, error: detail || `pi exited with code ${code ?? "null"} and returned no Qoder models.` });
		});
	});
}
