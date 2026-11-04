import { useEffect, useState } from "react";
import { Check, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import type { QoderProviderModel, QoderProviderRegion, QoderProviderSetupResult, QoderProviderStatus } from "../../../shared/types/qoderProvider";
import { t } from "../i18n";
import { desktopApi } from "../desktopApi";
import { Button } from "../components/ui-shadcn/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui-shadcn/dialog";
import { Input } from "../components/ui-shadcn/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui-shadcn/select";
import { showNotice } from "../utils/notice";

function formatTokens(value: number | undefined): string {
	if (!value) return "—";
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
	if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
	return String(value);
}

function QoderModelTable(props: { models: QoderProviderModel[] }) {
	return (
		<div className="max-h-64 overflow-auto rounded-md border border-border-subtle">
			<table className="w-full table-fixed border-collapse text-left text-xs">
				<thead className="sticky top-0 z-10 bg-bg-muted text-micro text-muted-foreground">
					<tr>
						<th className="w-[46%] whitespace-nowrap px-3 py-2 font-medium">{t("config.qoderProvider.columnModel")}</th>
						<th className="w-[12%] whitespace-nowrap px-2 py-2 text-right font-medium">{t("config.qoderProvider.columnContext")}</th>
						<th className="w-[14%] whitespace-nowrap px-2 py-2 text-right font-medium">{t("config.qoderProvider.columnMaxOut")}</th>
						<th className="w-[14%] whitespace-nowrap px-2 py-2 text-center font-medium">{t("config.qoderProvider.columnThinking")}</th>
						<th className="w-[14%] whitespace-nowrap px-3 py-2 text-center font-medium">{t("config.qoderProvider.columnImages")}</th>
					</tr>
				</thead>
				<tbody>
					{props.models.map((model) => (
						<tr key={`${model.provider}/${model.id}`} className="border-t border-border-subtle/70">
							<td className="min-w-0 px-3 py-2">
								<div className="truncate font-medium text-text-primary" title={model.name ?? model.id}>
									{model.name ?? model.id}
								</div>
								<div className="mt-0.5 truncate font-mono text-micro text-muted-foreground" title={`${model.provider}/${model.id}`}>
									{model.provider}/{model.id}
								</div>
							</td>
							<td className="whitespace-nowrap px-2 py-2 text-right text-text-secondary">{formatTokens(model.contextWindow)}</td>
							<td className="whitespace-nowrap px-2 py-2 text-right text-text-secondary">{formatTokens(model.maxTokens)}</td>
							<td className="px-2 py-2 text-center">{model.reasoning ? <Check className="mx-auto text-success" size={13} aria-hidden="true" /> : <span className="text-muted-foreground">—</span>}</td>
							<td className="px-3 py-2 text-center">{model.images ? <Check className="mx-auto text-success" size={13} aria-hidden="true" /> : <span className="text-muted-foreground">—</span>}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

export function QoderProviderDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
	const [region, setRegion] = useState<QoderProviderRegion>("global");
	const [pat, setPat] = useState("");
	const [busy, setBusy] = useState(false);
	const [status, setStatus] = useState<QoderProviderStatus | null>(null);
	const [result, setResult] = useState<QoderProviderSetupResult | null>(null);
	const [error, setError] = useState<string | undefined>();

	useEffect(() => {
		if (!props.open) return;
		let disposed = false;
		setPat("");
		setResult(null);
		setError(undefined);
		setStatus(null);
		void desktopApi.config
			.qoderProviderStatus()
			.then((next) => {
				if (disposed) return;
				setStatus(next);
				if (next.region) setRegion(next.region);
			})
			.catch(() => undefined);
		return () => {
			disposed = true;
		};
	}, [props.open]);

	const fetchModels = async () => {
		if (!pat.trim()) {
			setError(t("config.qoderProvider.patRequired"));
			return;
		}
		setBusy(true);
		setError(undefined);
		setResult(null);
		try {
			const next = await desktopApi.config.qoderProviderSetup({ region, pat: pat.trim() });
			setResult(next);
			if (!next.ok) setError(next.error ?? t("config.qoderProvider.failed"));
			else {
				setPat("");

				const nextStatus = await desktopApi.config.qoderProviderStatus().catch(() => null);
				// 登录命令本身已经返回模型；状态快照的模型刷新可能晚一拍（或 capability
				// probe 暂时为空），不能把已拿到的模型覆盖成空列表并提示「快照没有模型」。
				setStatus(nextStatus && nextStatus.models.length > 0 ? nextStatus : { configured: true, region, models: next.models });
			}
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setBusy(false);
		}
	};

	const configured = status?.configured === true || result?.ok === true;
	const models = status?.models?.length ? status.models : result?.ok ? result.models : [];
	const regionLabel = (status?.region ?? region) === "cn" ? t("config.qoderProvider.cn") : t("config.qoderProvider.global");

	const save = () => {
		if (!configured) return;
		showNotice(result?.ok ? t("config.qoderProvider.saved") : t("config.qoderProvider.alreadyConfigured"));
		props.onOpenChange(false);
	};

	return (
		<Dialog open={props.open} onOpenChange={props.onOpenChange}>
			<DialogContent className="max-w-[680px]">
				<DialogHeader>
					<DialogTitle>{t("config.qoderProvider.title")}</DialogTitle>
					<DialogDescription>{t("config.qoderProvider.description")}</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-3">
					{configured ? (
						<div className="flex items-start gap-2 rounded-md border border-success/25 bg-success-soft px-3 py-2 text-xs text-text-secondary">
							<ShieldCheck className="mt-0.5 shrink-0 text-success" size={15} aria-hidden="true" />
							<span>{t("config.qoderProvider.configured", { region: regionLabel })}</span>
						</div>
					) : null}
					<div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] gap-3">
						<label className="flex min-w-0 flex-col gap-1.5">
							<span className="text-xs font-medium text-text-secondary">{t("config.qoderProvider.region")}</span>
							<Select value={region} onValueChange={(value) => setRegion(value === "cn" ? "cn" : "global")}>
								<SelectTrigger className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="global">{t("config.qoderProvider.global")}</SelectItem>
									<SelectItem value="cn">{t("config.qoderProvider.cn")}</SelectItem>
								</SelectContent>
							</Select>
						</label>
						<label className="flex min-w-0 flex-col gap-1.5">
							<span className="text-xs font-medium text-text-secondary">{t("config.qoderProvider.pat")}</span>
							<Input type="password" autoComplete="off" value={pat} onChange={(event) => setPat(event.target.value)} placeholder="pt-..." spellCheck={false} />
						</label>
					</div>
					<p className="-mt-1 text-micro leading-relaxed text-muted-foreground">{t("config.qoderProvider.patHint")}</p>
					<div className="flex items-center gap-2">
						<Button variant="outline" size="sm" disabled={busy} onClick={() => void fetchModels()}>
							{busy ? <Loader2 className="animate-pideck-spin" size={14} aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}
							{busy ? t("config.qoderProvider.fetching") : configured ? t("config.qoderProvider.fetchAgain") : t("config.qoderProvider.fetch")}
						</Button>
						{result?.ok ? <span className="text-xs text-success">{t("config.qoderProvider.fetched", { count: result.models.length })}</span> : null}
					</div>
					{error ? <p className="whitespace-pre-wrap break-all rounded-md border border-danger/20 bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p> : null}
					{models.length > 0 ? (
						<div className="flex flex-col gap-1.5">
							<div className="text-micro font-medium text-muted-foreground">{t("config.qoderProvider.models")}</div>
							<QoderModelTable models={models} />
						</div>
					) : configured ? (
						<p className="text-micro text-muted-foreground">{t("config.qoderProvider.configuredNoModels")}</p>
					) : null}
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => props.onOpenChange(false)}>
						{t("common.cancel")}
					</Button>
					<Button disabled={!configured} onClick={save}>
						{t("common.save")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
