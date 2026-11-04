import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { AvailableModel } from "../../shared/types";
import type { AppSettings } from "../../shared/types/settings";
import type { QoderProviderModel, QoderProviderRegion, QoderProviderSetupInput, QoderProviderSetupResult, QoderProviderStatus } from "../../shared/types/qoderProvider";
import type { PiLocator } from "../pi/PiLocator";
import { parsePiListModels } from "../pi/modelListCache";

const LIST_TIMEOUT_MS = 120_000;
const INSTALL_TIMEOUT_MS = 180_000;
const MAX_OUTPUT_CHARS = 1_000_000;
const QODER_PROVIDERS = new Set(["qoder", "qoder-cn"]);
const QODER_PROVIDER_PACKAGE = "npm:@jischeng/pi-provider-qoder";

export type QoderProviderSetupDeps = {
	piLocator: PiLocator;
	getSettings: () => AppSettings;

	afterLogin?: (models: QoderProviderModel[]) => Promise<void> | void;
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
	const hasProviderKey = (parsed: unknown, provider: string): boolean => isRecord(parsed) && Object.hasOwn(parsed, provider);
	try {
		const parsed: unknown = JSON.parse(readFileSync(join(configDir, "auth.json"), "utf8"));
		if (hasProviderKey(parsed, "qoder") || hasProviderKey(parsed, "qoder-cn")) return true;
	} catch {}
	// Qoder 扩展也支持 multiprovider-auth.json 多账号池；只查 auth.json 会让已登录用户
	// 在重启后被判定为「无 Qoder」，模型选择器于是走 --no-extensions 快速档。
	try {
		const parsed: unknown = JSON.parse(readFileSync(join(configDir, "multiprovider-auth.json"), "utf8"));
		const providers = isRecord(parsed) && isRecord(parsed.providers) ? parsed.providers : null;
		if (!providers) return false;
		return ["qoder", "qoder-cn"].some((provider) => {
			const entry = providers[provider];
			return isRecord(entry) && Array.isArray(entry.accounts) && entry.accounts.length > 0;
		});
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

function qoderProviderInstalled(): boolean {
	const agentDir = join(homedir(), ".pi", "agent");
	// 只认 pi settings 的 packages 登记：包目录存在但未登记时 pi 不会加载扩展，
	// 此时仍应执行 install 把它重新登记进去。
	try {
		const settings: unknown = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"));
		const packages = isRecord(settings) && Array.isArray(settings.packages) ? settings.packages : [];
		return packages.some((item) => typeof item === "string" && item.includes("@jischeng/pi-provider-qoder"));
	} catch {
		return false;
	}
}

type PiCommandResult = { code: number | null; stdout: string; stderr: string; error?: string };

type PiInvocation = { command: string; args: string[]; shell: boolean };

function runPiCommand(invocation: PiInvocation, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<PiCommandResult> {
	return new Promise((resolve) => {
		let stdout = "";
		let stderr = "";
		let settled = false;
		const finish = (result: PiCommandResult) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(result);
		};
		const proc = spawn(invocation.command, invocation.args, { env, cwd: process.cwd(), shell: invocation.shell, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
		const timer = setTimeout(() => {
			try {
				proc.kill();
			} catch {}
			finish({ code: null, stdout, stderr, error: "timeout" });
		}, timeoutMs);
		proc.stdout?.on("data", (chunk: Buffer) => {
			if (stdout.length < MAX_OUTPUT_CHARS) stdout += chunk.toString("utf8");
		});
		proc.stderr?.on("data", (chunk: Buffer) => {
			if (stderr.length < MAX_OUTPUT_CHARS) stderr += chunk.toString("utf8");
		});
		proc.once("error", (error) => finish({ code: null, stdout, stderr, error: error.message }));
		proc.once("exit", (code) => finish({ code, stdout, stderr }));
	});
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
	const baseEnv = deps.piLocator.createProcessEnv(undefined, invocation.pathPrefix, invocation.wsl);
	const env = { ...baseEnv, [envName]: pat };

	const completeLogin = async (models: QoderProviderModel[]): Promise<void> => {
		try {
			await deps.afterLogin?.(models);
		} catch (error) {
			deps.logger?.warn("qoder-provider", "Qoder provider model refresh after login failed", { region, error: error instanceof Error ? error.message : String(error) });
		}
		deps.logger?.info("qoder-provider", "Qoder PAT login and model discovery completed", { region, modelCount: models.length });
	};

	const listModels = async (): Promise<{ result: PiCommandResult; models: QoderProviderModel[] }> => {
		const result = await runPiCommand(invocation, env, LIST_TIMEOUT_MS);
		return { result, models: parseQoderModels(result.stdout) };
	};

	let listed = await listModels();
	let installDetail = "";
	// 新机器上通常只有 pi 本体：没装 Qoder provider 包时 `--list-models` 只会列出其它供应商。
	// 先补装扩展再重试，避免用户看到一串 AI-AAA 模型却完全不知道该装什么。
	if (listed.models.length === 0 && !qoderProviderInstalled()) {
		const installInvocation = deps.piLocator.createInvocation(command, ["install", QODER_PROVIDER_PACKAGE]);
		const installed = await runPiCommand(installInvocation, baseEnv, INSTALL_TIMEOUT_MS);
		const installOutput = stripAnsi(`${installed.stderr}\n${installed.stdout}`).trim().slice(-2000).split(pat).join("***");
		if (installed.error || installed.code !== 0) {
			deps.logger?.warn("qoder-provider", "Qoder provider package install failed", { region, exitCode: installed.code, output: installOutput });
			return { ok: false, models: [], error: installOutput || `Could not install ${QODER_PROVIDER_PACKAGE} (pi exited with code ${installed.code ?? "null"}).` };
		}
		installDetail = installOutput;
		listed = await listModels();
	}

	const models = listed.models;
	if (listed.result.code === 0 && models.length > 0) {
		await completeLogin(models);
		return { ok: true, models };
	}
	const detail = stripAnsi(`${listed.result.stderr}\n${listed.result.stdout}`).trim().slice(-2000).split(pat).join("***");
	deps.logger?.warn("qoder-provider", "Qoder PAT setup failed", { region, exitCode: listed.result.code, output: detail });
	return {
		ok: false,
		models,
		error: [detail, installDetail ? `Provider install output:\n${installDetail}` : ""].filter(Boolean).join("\n\n") || `pi exited with code ${listed.result.code ?? "null"} and returned no Qoder models.`,
	};
}
