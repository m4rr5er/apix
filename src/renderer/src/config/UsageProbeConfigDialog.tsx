import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { AlertCircle, Bot, Eye, EyeOff, Loader2 } from "lucide-react";
import { t } from "../i18n";
import type { TranslationKey } from "../i18n";
import type { ProviderUsageResult, UsageProbeProviderConfig, UsageProbeTemplateCategory } from "../../../shared/types/providerUsage";
import { desktopApi } from "../desktopApi";
import { showNotice } from "../utils/notice";
import { invalidateAllProviderUsageAtom, resolveProviderUsageAtom } from "../atoms/provider-usage-atoms";
import { currentSessionIdAtom } from "../atoms/session-atoms";
import { setSessionDraftAtom } from "../atoms/composer-atoms";
import { appendContentToDraft } from "../composerBehavior";
import { usageCacheKey, useRefreshProviderUsageState } from "../hooks/useProviderUsage";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui-shadcn/dialog";
import { Button } from "../components/ui-shadcn/button";
import { Input } from "../components/ui-shadcn/input";
import { Label } from "../components/ui-shadcn/label";
import { Switch } from "../components/ui-shadcn/switch";
import { StatefulButton, type ButtonState } from "../components/motion/button";
import { cn } from "../lib/utils";
import { formatUsageBadgeText } from "../utils/providerUsageDisplay";

const CATEGORY_LABEL_KEY: Record<UsageProbeTemplateCategory, TranslationKey> = {
	balance: "config.usageProbe.category.balance",
	plan: "config.usageProbe.category.plan",
	subscription: "config.usageProbe.category.subscription",
	general: "config.usageProbe.category.general",
	newapi: "config.usageProbe.category.newapi",
	cookie: "config.usageProbe.category.cookie",
	volcengine: "config.usageProbe.category.volcengine",
	sub2api: "config.usageProbe.category.sub2api",
};

const CATEGORY_HINT_KEY: Record<UsageProbeTemplateCategory, TranslationKey> = {
	balance: "config.usageProbe.balanceHint",
	plan: "config.usageProbe.planHint",
	subscription: "config.usageProbe.subscriptionHint",
	general: "config.usageProbe.generalHint",
	newapi: "config.usageProbe.newapiHint",
	cookie: "config.usageProbe.cookieHint",
	volcengine: "config.usageProbe.volcengineHint",
	sub2api: "config.usageProbe.sub2apiHint",
};

const DECLARATIVE_TEMPLATE_CATEGORY: Record<string, UsageProbeTemplateCategory> = {
	general: "general",
	newapi: "newapi",
	cookie: "cookie",

	volcengine: "volcengine",

	sub2api: "sub2api",
};

const NONE_TEMPLATE = "none";

function pillClass(selected: boolean): string {
	return cn("h-7 rounded-lg border px-2.5 text-caption", selected ? "border-transparent bg-[color:var(--color-accent)] font-medium text-[var(--color-text-inverse)] shadow-sm hover:opacity-90" : "border-border bg-transparent text-text-secondary hover:bg-bg-hover hover:text-foreground");
}

function NumberField(props: { label: string; value: number; onChange: (value: number) => void; min: number; max: number }) {
	return (
		<div className="space-y-1.5">
			<Label className="text-xs font-medium text-foreground">{props.label}</Label>
			<Input
				type="number"
				min={props.min}
				max={props.max}
				value={String(props.value)}
				onChange={(event) => {
					const parsed = Number(event.target.value);
					if (Number.isFinite(parsed)) {
						props.onChange(Math.max(props.min, Math.min(props.max, Math.round(parsed))));
					}
				}}
				className="h-9"
			/>
		</div>
	);
}

function OptionalField(props: { label: string; placeholder: string; value: string; onChange: (value: string) => void; type?: "text" | "password" }) {
	return (
		<div className="space-y-1.5">
			<Label className="text-xs font-medium text-foreground">{props.label}</Label>
			<Input type={props.type ?? "text"} value={props.value} onChange={(event) => props.onChange(event.target.value)} placeholder={props.placeholder} className="h-9" />
		</div>
	);
}

export function UsageProbeConfigDialog(props: {
	open: boolean;
	onClose: () => void;

	provider: string;

	backend?: "pi";

	onCloseHost?: () => void;
}) {
	const invalidateAll = useSetAtom(invalidateAllProviderUsageAtom);

	const refreshProviderState = useRefreshProviderUsageState();
	const resolveUsage = useSetAtom(resolveProviderUsageAtom);

	const currentSessionId = useAtomValue(currentSessionIdAtom);
	const setDraft = useSetAtom(setSessionDraftAtom);

	const cacheKey = usageCacheKey(props.provider, props.backend ?? "pi");

	const [loaded, setLoaded] = useState(false);
	const [loadErrors, setLoadErrors] = useState<string[]>([]);
	const [recognized, setRecognized] = useState<{ templateId: string; category: UsageProbeTemplateCategory } | null>(null);

	const [template, setTemplate] = useState<string>(NONE_TEMPLATE);
	const [enabled, setEnabled] = useState(false);
	const [apiKey, setApiKey] = useState("");
	const [baseUrl, setBaseUrl] = useState("");
	const [accessToken, setAccessToken] = useState("");
	const [userId, setUserId] = useState("");
	const [cookie, setCookie] = useState("");
	const [cookiePath, setCookiePath] = useState("");
	const [valuePath, setValuePath] = useState("");
	const [currencyPath, setCurrencyPath] = useState("");

	const [accessKeyId, setAccessKeyId] = useState("");
	const [secretAccessKey, setSecretAccessKey] = useState("");

	const [panelJwt, setPanelJwt] = useState("");

	const [panelRefreshToken, setPanelRefreshToken] = useState("");
	const [showToken, setShowToken] = useState(false);
	const [timeoutSecs, setTimeoutSecs] = useState(10);
	const [intervalMinutes, setIntervalMinutes] = useState(5);
	const [testState, setTestState] = useState<ButtonState>("idle");
	const [testError, setTestError] = useState("");
	const [testDetail, setTestDetail] = useState("");
	const [testResult, setTestResult] = useState<ProviderUsageResult | null>(null);
	const [saveState, setSaveState] = useState<ButtonState>("idle");
	const [saveError, setSaveError] = useState("");

	const [legacyNotice, setLegacyNotice] = useState("");

	useEffect(() => {
		if (!props.open || !props.provider) return;
		let cancelled = false;
		setLoaded(false);
		setLoadErrors([]);
		setLegacyNotice("");

		desktopApi.config
			.getUsageProbes(props.provider, props.backend)
			.then((result) => {
				if (cancelled) return;
				const config = result.config;
				setRecognized(result.recognized);
				setEnabled(config?.enabled ?? false);
				setTemplate(config?.template ?? result.recognized?.templateId ?? NONE_TEMPLATE);
				setApiKey(config?.apiKey ?? "");
				setBaseUrl(config?.baseUrl ?? "");
				setAccessToken(config?.accessToken ?? "");
				setUserId(config?.userId ?? "");
				setCookie(config?.cookie ?? "");
				setCookiePath(config?.cookiePath ?? "");
				setValuePath(config?.valuePath ?? "");
				setCurrencyPath(config?.currencyPath ?? "");
				setAccessKeyId(config?.accessKeyId ?? "");
				setSecretAccessKey(config?.secretAccessKey ?? "");
				setPanelJwt(config?.panelJwt ?? "");
				setPanelRefreshToken(config?.panelRefreshToken ?? "");
				setTimeoutSecs(config?.timeoutSecs ?? 10);
				setIntervalMinutes(config?.intervalMinutes ?? 5);
				setLoadErrors(result.errors);

				const legacy = result.legacyProbes ?? [];
				if (legacy.length > 0 && !config?.template) {
					const first = legacy[0];
					const cookieHeader = first.request?.headers?.["Cookie"] ?? first.request?.headers?.cookie ?? "";
					if (cookieHeader) setCookie(cookieHeader);
					if (first.request?.path) setCookiePath(first.request.path);

					const parse = first.parse;
					if (parse?.kind === "balance") {
						if (parse.valuePath) setValuePath(parse.valuePath);
						if (parse.currencyPath) setCurrencyPath(parse.currencyPath);
					}
					const firstNamed = legacy.find((item) => item.name)?.name;
					setLegacyNotice(
						t("config.usageProbe.legacyDetected", {
							count: String(legacy.length),
							name: firstNamed ?? t("config.usageProbe.legacyUnnamed"),
						}),
					);
					setTemplate("cookie");
				}
				setLoaded(true);
			})
			.catch((error) => {
				if (cancelled) return;
				setLoadErrors([t("config.usageProbe.loadFailed", { error: String(error) })]);
				setLoaded(true);
			});
		return () => {
			cancelled = true;
		};
	}, [props.open, props.provider, props.backend]);

	const closeTimerRef = useRef<number | null>(null);
	useEffect(
		() => () => {
			if (closeTimerRef.current !== null) {
				window.clearTimeout(closeTimerRef.current);
				closeTimerRef.current = null;
			}
		},
		[],
	);

	const resetInstant = useCallback(() => {
		setTestState("idle");
		setTestError("");
		setTestDetail("");
		setTestResult(null);
		setSaveState("idle");
		setSaveError("");
		setShowToken(false);
	}, []);
	const handleClose = useCallback(() => {
		if (closeTimerRef.current !== null) {
			window.clearTimeout(closeTimerRef.current);
			closeTimerRef.current = null;
		}
		resetInstant();
		props.onClose();
	}, [props.onClose, resetInstant]);

	const currentTemplate = useMemo((): { id: string; category: UsageProbeTemplateCategory } | null => {
		if (template === NONE_TEMPLATE) return null;

		if (Object.prototype.hasOwnProperty.call(DECLARATIVE_TEMPLATE_CATEGORY, template)) {
			return { id: template, category: DECLARATIVE_TEMPLATE_CATEGORY[template] };
		}
		if (recognized && recognized.templateId === template) {
			return { id: template, category: recognized.category };
		}
		return null;
	}, [template, recognized]);

	const runTest = async () => {
		setTestError("");
		setTestDetail("");
		setTestResult(null);
		const current = currentTemplate;
		if (!current) {
			setTestState("error");
			setTestError(t("config.usageProbe.noneNoTest"));
			return;
		}
		setTestState("loading");
		try {
			const result = await desktopApi.config.testUsageProbe({
				provider: props.provider,
				backend: props.backend,
				template: current.id,
				...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
				...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
				...(accessToken.trim() ? { accessToken: accessToken.trim() } : {}),
				...(userId.trim() ? { userId: userId.trim() } : {}),
				...(cookie.trim() ? { cookie: cookie.trim() } : {}),
				...(cookiePath.trim() ? { cookiePath: cookiePath.trim() } : {}),
				...(valuePath.trim() ? { valuePath: valuePath.trim() } : {}),
				...(currencyPath.trim() ? { currencyPath: currencyPath.trim() } : {}),
				...(accessKeyId.trim() ? { accessKeyId: accessKeyId.trim() } : {}),
				...(secretAccessKey.trim() ? { secretAccessKey: secretAccessKey.trim() } : {}),
				...(panelJwt.trim() ? { panelJwt: panelJwt.trim() } : {}),
				...(panelRefreshToken.trim() ? { panelRefreshToken: panelRefreshToken.trim() } : {}),
				...(timeoutSecs !== 10 ? { timeoutSecs } : {}),
			});
			setTestResult(result);
			setTestState(result.success ? "success" : "error");
			if (result.success) {
				resolveUsage(cacheKey, result);
				const summary = formatUsageBadgeText(result);
				showNotice(summary ? t("config.usageProbe.testSuccessWith", { value: summary }) : t("config.usageProbe.testSuccess"), 3000, "info");
			} else {
				setTestError(result.error ?? t("config.usageProbe.testFailed"));

				setTestDetail(result.detail ?? "");
			}
		} catch (error) {
			setTestState("error");
			setTestError(error instanceof Error ? error.message : String(error));
		}
	};

	const runSave = async () => {
		setSaveError("");
		const isNone = template === NONE_TEMPLATE;
		const current = currentTemplate;
		if (!isNone && !current) {
			setSaveState("error");
			setSaveError(t("config.usageProbe.saveFailed"));
			return;
		}
		const config: UsageProbeProviderConfig = {
			enabled,
			timeoutSecs,
			intervalMinutes,
		};

		if (!isNone && current && Object.prototype.hasOwnProperty.call(DECLARATIVE_TEMPLATE_CATEGORY, current.id)) {
			config.template = current.id;

			if (current.id === "general" || current.id === "sub2api") {
				if (current.id === "general" && apiKey.trim()) config.apiKey = apiKey.trim();
				if (baseUrl.trim()) config.baseUrl = baseUrl.trim();

				if (current.id === "sub2api" && panelJwt.trim()) config.panelJwt = panelJwt.trim();

				if (current.id === "sub2api" && panelRefreshToken.trim()) config.panelRefreshToken = panelRefreshToken.trim();
			} else if (current.id === "newapi") {
				if (baseUrl.trim()) config.baseUrl = baseUrl.trim();
				if (!accessToken.trim() || !userId.trim()) {
					setSaveState("error");
					setSaveError(accessToken.trim() ? t("config.usageProbe.newApiUserIdRequired") : t("config.usageProbe.newApiTokenRequired"));
					return;
				}
				config.accessToken = accessToken.trim();
				config.userId = userId.trim();
			} else if (current.id === "cookie") {
				if (baseUrl.trim()) config.baseUrl = baseUrl.trim();
				if (!cookie.trim() || !cookiePath.trim() || !valuePath.trim()) {
					setSaveState("error");
					setSaveError(!cookie.trim() ? t("config.usageProbe.cookieRequired") : !cookiePath.trim() ? t("config.usageProbe.cookiePathRequired") : t("config.usageProbe.cookieValuePathRequired"));
					return;
				}
				config.cookie = cookie.trim();
				config.cookiePath = cookiePath.trim();
				config.valuePath = valuePath.trim();
				if (currencyPath.trim()) config.currencyPath = currencyPath.trim();
			} else if (current.id === "volcengine") {
				if (baseUrl.trim()) config.baseUrl = baseUrl.trim();
				if (!accessKeyId.trim() || !secretAccessKey.trim()) {
					setSaveState("error");
					setSaveError(!accessKeyId.trim() ? t("config.usageProbe.volcengineAccessKeyIdRequired") : t("config.usageProbe.volcengineSecretKeyRequired"));
					return;
				}
				config.accessKeyId = accessKeyId.trim();
				config.secretAccessKey = secretAccessKey.trim();
			}
		}
		setSaveState("loading");
		try {
			const result = await desktopApi.config.saveUsageProbes({
				provider: props.provider,
				backend: props.backend,
				config,
			});
			if (result.ok) {
				setSaveState("success");

				invalidateAll();
				void refreshProviderState(props.provider, props.backend);

				if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
				closeTimerRef.current = window.setTimeout(() => {
					closeTimerRef.current = null;
					handleClose();
				}, 600);
			} else {
				setSaveState("error");
				setSaveError(result.error ?? t("config.usageProbe.saveFailed"));
			}
		} catch (error) {
			setSaveState("error");
			setSaveError(error instanceof Error ? error.message : String(error));
		}
	};

	const aiAssist = async () => {
		const prompt = t("config.usageProbe.aiPrompt", {
			provider: props.provider,
			configPath: "~/.pi/agent/usage-probes.json",
		});
		try {
			await desktopApi.config.installUsageSkill();
			const sessionId = currentSessionId;
			if (!sessionId) {
				await navigator.clipboard.writeText(prompt);
				showNotice(t("config.usageProbe.aiAssistCopiedOnly"), 6000, "info");
				return;
			}
			setDraft({ sessionId, value: (current) => appendContentToDraft(current, prompt) });
			props.onClose();
			props.onCloseHost?.();
			showNotice(t("config.usageProbe.aiAssistInserted"), 5000, "info");
		} catch {
			showNotice(t("config.usageProbe.saveFailed"), 4000, "error");
		}
	};

	const testSummary = useMemo(() => {
		if (!testResult) return "";
		if (!testResult.success) return testResult.error ?? t("config.usageProbe.testFailed");
		return formatUsageBadgeText(testResult) ?? t("config.usageProbe.testSuccess");
	}, [testResult]);

	const hintKey = currentTemplate ? CATEGORY_HINT_KEY[currentTemplate.category] : null;

	if (!props.open) return null;

	return (
		<Dialog open onOpenChange={(next) => !next && handleClose()}>
			<DialogContent className="max-h-[85vh] flex flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
				<DialogHeader className="px-5 pt-4 pb-2">
					<DialogTitle>{t("config.usageProbe.titleWithProvider", { provider: props.provider })}</DialogTitle>
				</DialogHeader>
				<div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-3">
					{!loaded ? (
						<div className="flex items-center justify-center gap-2 py-4 text-caption text-text-tertiary">
							<Loader2 size={14} className="animate-pideck-spin" aria-hidden="true" />
							{t("common.loading")}
						</div>
					) : (
						<>
							{loadErrors.length > 0 && <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-caption leading-relaxed text-amber-600 dark:text-amber-400">{loadErrors.join("\n")}</div>}
							{legacyNotice && (
								<div className="rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-caption leading-relaxed text-sky-600 dark:text-sky-400" data-testid="usage-probe-legacy-notice">
									{legacyNotice}
								</div>
							)}

							<div className="flex items-center justify-between rounded-lg border border-border px-3.5 py-2.5">
								<span className="text-sm font-medium text-foreground">{t("config.usageProbe.enable")}</span>
								<Switch checked={enabled} onCheckedChange={setEnabled} data-testid="usage-probe-enable" />
							</div>

							<section className="space-y-1.5">
								<p className="text-sm font-medium text-foreground">{t("config.usageProbe.templatesTitle")}</p>
								<div className="flex flex-wrap gap-1.5">
									<button type="button" className={pillClass(template === NONE_TEMPLATE)} onClick={() => setTemplate(NONE_TEMPLATE)} data-testid="usage-probe-template-none">
										{t("config.usageProbe.category.none")}
									</button>
									{recognized && (
										<button type="button" className={pillClass(template === recognized.templateId)} onClick={() => setTemplate(recognized.templateId)} data-testid="usage-probe-template-builtin">
											{t("config.usageProbe.builtin", { label: t(CATEGORY_LABEL_KEY[recognized.category]) })}
										</button>
									)}
									<button type="button" className={pillClass(template === "general")} onClick={() => setTemplate("general")} data-testid="usage-probe-template-general">
										{t("config.usageProbe.category.general")}
									</button>
									<button type="button" className={pillClass(template === "newapi")} onClick={() => setTemplate("newapi")} data-testid="usage-probe-template-newapi">
										{t("config.usageProbe.category.newapi")}
									</button>
									<button type="button" className={pillClass(template === "cookie")} onClick={() => setTemplate("cookie")} data-testid="usage-probe-template-cookie">
										{t("config.usageProbe.category.cookie")}
									</button>
									<button type="button" className={pillClass(template === "volcengine")} onClick={() => setTemplate("volcengine")} data-testid="usage-probe-template-volcengine">
										{t("config.usageProbe.category.volcengine")}
									</button>
									<button type="button" className={pillClass(template === "sub2api")} onClick={() => setTemplate("sub2api")} data-testid="usage-probe-template-sub2api">
										{t("config.usageProbe.category.sub2api")}
									</button>
								</div>
								{template === NONE_TEMPLATE && (
									<p className="px-0.5 text-caption text-text-tertiary" data-testid="usage-probe-none-hint">
										{t("config.usageProbe.noneHint")}
									</p>
								)}
								{hintKey && (
									<div className="flex items-center gap-2 px-0.5">
										{recognized && template === recognized.templateId && (
											<span className="inline-flex shrink-0 items-center rounded border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-1.5 py-0.5 font-mono text-micro leading-none tracking-wide text-[var(--color-accent)]" data-testid="usage-probe-recognized-badge">
												{props.provider}
											</span>
										)}
										<p className="min-w-0 flex-1 text-caption text-text-tertiary">{recognized && template === recognized.templateId ? t("config.usageProbe.builtinHint") : t(hintKey)}</p>
									</div>
								)}
							</section>

							{currentTemplate?.id === "general" && (
								<section className="space-y-3">
									<div className="grid grid-cols-2 gap-3">
										<OptionalField label={t("config.usageProbe.credentialApiKey")} placeholder={t("config.usageProbe.credentialApiKeyPlaceholder")} value={apiKey} onChange={setApiKey} />
										<OptionalField label={t("config.usageProbe.credentialBaseUrl")} placeholder={t("config.usageProbe.credentialBaseUrlPlaceholder")} value={baseUrl} onChange={setBaseUrl} />
									</div>
								</section>
							)}

							{currentTemplate?.id === "sub2api" && (
								<section className="space-y-3">
									<OptionalField label={t("config.usageProbe.credentialBaseUrl")} placeholder={t("config.usageProbe.credentialBaseUrlPlaceholder")} value={baseUrl} onChange={setBaseUrl} />
									<div className="space-y-1.5">
										<div className="flex items-center justify-between">
											<Label className="text-xs font-medium text-foreground">{t("config.usageProbe.sub2apiPanelJwt")}</Label>
											<button type="button" className="inline-flex items-center gap-1 text-micro text-text-tertiary transition-colors hover:text-foreground" onClick={() => setShowToken((value) => !value)}>
												{showToken ? <EyeOff size={12} /> : <Eye size={12} />}
												{showToken ? t("config.usageProbe.hideKey") : t("config.usageProbe.showKey")}
											</button>
										</div>

										<Input type={showToken ? "text" : "password"} value={panelJwt} onChange={(event) => setPanelJwt(event.target.value)} placeholder={t("config.usageProbe.sub2apiPanelJwtPlaceholder")} className="h-9" data-testid="usage-probe-sub2api-jwt" />
										<p className="text-caption leading-relaxed text-text-tertiary">{t("config.usageProbe.sub2apiPanelJwtHint")}</p>
									</div>
									<div className="space-y-1.5">
										<Label className="text-xs font-medium text-foreground">{t("config.usageProbe.sub2apiPanelRefreshToken")}</Label>

										<Input type={showToken ? "text" : "password"} value={panelRefreshToken} onChange={(event) => setPanelRefreshToken(event.target.value)} placeholder={t("config.usageProbe.sub2apiPanelRefreshTokenPlaceholder")} className="h-9" data-testid="usage-probe-sub2api-refresh-token" />
										<p className="text-caption leading-relaxed text-text-tertiary">{t("config.usageProbe.sub2apiPanelRefreshTokenHint")}</p>
									</div>
								</section>
							)}
							{currentTemplate?.id === "newapi" && (
								<section className="space-y-3">
									<div className="grid grid-cols-2 gap-3">
										<OptionalField label={t("config.usageProbe.credentialBaseUrl")} placeholder={t("config.usageProbe.credentialBaseUrlPlaceholder")} value={baseUrl} onChange={setBaseUrl} />
										<div className="space-y-1.5">
											<div className="flex items-center justify-between">
												<Label className="text-xs font-medium text-foreground">{t("config.usageProbe.newApiToken")}</Label>
												<button type="button" className="inline-flex items-center gap-1 text-micro text-text-tertiary transition-colors hover:text-foreground" onClick={() => setShowToken((value) => !value)}>
													{showToken ? <EyeOff size={12} /> : <Eye size={12} />}
													{showToken ? t("config.usageProbe.hideKey") : t("config.usageProbe.showKey")}
												</button>
											</div>
											<Input type={showToken ? "text" : "password"} value={accessToken} onChange={(event) => setAccessToken(event.target.value)} placeholder={t("config.usageProbe.newApiTokenPlaceholder")} className="h-9" />
										</div>
									</div>
									<OptionalField label={t("config.usageProbe.newApiUserId")} placeholder={t("config.usageProbe.newApiUserIdPlaceholder")} value={userId} onChange={setUserId} />
								</section>
							)}

							{currentTemplate?.id === "cookie" && (
								<section className="space-y-3">
									<div className="grid grid-cols-2 gap-3">
										<div className="space-y-1.5">
											<div className="flex items-center justify-between">
												<Label className="text-xs font-medium text-foreground">{t("config.usageProbe.cookieLabel")}</Label>
												<button type="button" className="inline-flex items-center gap-1 text-micro text-text-tertiary transition-colors hover:text-foreground" onClick={() => setShowToken((value) => !value)}>
													{showToken ? <EyeOff size={12} /> : <Eye size={12} />}
													{showToken ? t("config.usageProbe.hideKey") : t("config.usageProbe.showKey")}
												</button>
											</div>
											<Input type={showToken ? "text" : "password"} value={cookie} onChange={(event) => setCookie(event.target.value)} placeholder={t("config.usageProbe.cookiePlaceholder")} className="h-9" />
										</div>
										<OptionalField label={t("config.usageProbe.credentialBaseUrl")} placeholder={t("config.usageProbe.credentialBaseUrlPlaceholder")} value={baseUrl} onChange={setBaseUrl} />
									</div>
									<OptionalField label={t("config.usageProbe.cookiePathLabel")} placeholder={t("config.usageProbe.cookiePathPlaceholder")} value={cookiePath} onChange={setCookiePath} />
									<div className="grid grid-cols-2 gap-3">
										<OptionalField label={t("config.usageProbe.cookieValuePathLabel")} placeholder={t("config.usageProbe.cookieValuePathPlaceholder")} value={valuePath} onChange={setValuePath} />
										<OptionalField label={t("config.usageProbe.cookieCurrencyPathLabel")} placeholder={t("config.usageProbe.cookieCurrencyPathPlaceholder")} value={currencyPath} onChange={setCurrencyPath} />
									</div>
								</section>
							)}
							{currentTemplate?.id === "volcengine" && (
								<section className="space-y-3">
									<div className="grid grid-cols-2 gap-3">
										<div className="space-y-1.5">
											<Label className="text-xs font-medium text-foreground">{t("config.usageProbe.volcengineAccessKeyId")}</Label>
											<Input value={accessKeyId} onChange={(event) => setAccessKeyId(event.target.value)} placeholder={t("config.usageProbe.volcengineAccessKeyIdPlaceholder")} className="h-9" />
										</div>
										<div className="space-y-1.5">
											<div className="flex items-center justify-between">
												<Label className="text-xs font-medium text-foreground">{t("config.usageProbe.volcengineSecretKey")}</Label>
												<button type="button" className="inline-flex items-center gap-1 text-micro text-text-tertiary transition-colors hover:text-foreground" onClick={() => setShowToken((value) => !value)}>
													{showToken ? <EyeOff size={12} /> : <Eye size={12} />}
													{showToken ? t("config.usageProbe.hideKey") : t("config.usageProbe.showKey")}
												</button>
											</div>

											<Input type={showToken ? "text" : "password"} value={secretAccessKey} onChange={(event) => setSecretAccessKey(event.target.value)} placeholder={t("config.usageProbe.volcengineSecretKeyPlaceholder")} className="h-9" />
										</div>
									</div>

									<OptionalField label={t("config.usageProbe.credentialBaseUrl")} placeholder={t("config.usageProbe.credentialBaseUrlPlaceholder")} value={baseUrl} onChange={setBaseUrl} />
								</section>
							)}

							<div className="grid grid-cols-2 gap-3">
								<NumberField label={t("config.usageProbe.timeout")} value={timeoutSecs} onChange={setTimeoutSecs} min={1} max={300} />
								<NumberField label={t("config.usageProbe.interval")} value={intervalMinutes} onChange={setIntervalMinutes} min={0} max={1440} />
							</div>

							<section className="space-y-2 border-t border-border pt-3">
								<div className="flex items-center gap-2.5">
									<StatefulButton variant="outline" state={testState} onClick={() => void runTest()} loadingText={t("config.usageProbe.testing")} successText={t("config.usageProbe.testSuccess")} errorText={t("config.usageProbe.testFailed")} className="h-8 rounded-md px-3 text-xs">
										{t("config.usageProbe.test")}
									</StatefulButton>
									{testState === "error" && testError && (
										<span className="min-w-0 flex-1 truncate text-caption text-destructive" title={testError}>
											{testError}
										</span>
									)}
									{testSummary && testState !== "error" && (
										<span className="min-w-0 flex-1 truncate text-caption text-foreground" title={testSummary}>
											{testSummary}
										</span>
									)}
								</div>
								{testState === "error" && testDetail && (
									<div className="w-full overflow-hidden rounded-md border border-border/60 bg-background/60 px-2 py-1.5" data-testid="usage-probe-test-detail">
										<pre className="max-h-44 overflow-auto whitespace-pre-wrap break-all font-mono text-micro leading-relaxed text-text-secondary">{testDetail}</pre>
									</div>
								)}
								{testState === "success" && testResult?.panelBalanceError ? (
									<div className="flex items-center gap-1.5 text-caption leading-5 text-amber-600 dark:text-amber-400" data-testid="usage-probe-panel-jwt-warning">
										<AlertCircle size={12} aria-hidden="true" />
										<span>{testResult.panelBalanceError === "unauthorized" ? t("config.usageProbe.sub2apiPanelJwtExpired") : t("config.usageProbe.sub2apiPanelJwtFailed")}</span>
									</div>
								) : null}
							</section>
						</>
					)}
				</div>

				<div className="flex items-center gap-2 border-t border-border px-5 py-3">
					<Button variant="ghost" size="sm" onClick={() => void aiAssist()} title={t("config.usageProbe.aiAssistTitle")}>
						<Bot size={14} />
						{t("config.usageProbe.aiAssist")}
					</Button>
					<div className="ml-auto flex items-center gap-2">
						<Button variant="ghost" size="sm" onClick={handleClose}>
							{t("common.cancel")}
						</Button>
						{loaded && (
							<StatefulButton state={saveState} onClick={() => void runSave()} loadingText={t("config.usageProbe.saving")} successText={t("config.usageProbe.savedDone")} errorText={saveError || t("config.usageProbe.saveFailed")} className="h-8 rounded-md px-3 text-xs">
								{t("config.usageProbe.save")}
							</StatefulButton>
						)}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
