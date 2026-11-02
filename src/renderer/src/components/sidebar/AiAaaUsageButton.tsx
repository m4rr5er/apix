import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ChartColumnBig, RefreshCw } from "lucide-react";
import type { AiAaaUsageResult, AiAaaUsageSnapshot } from "../../../../shared/types/aiAaaUsage";
import type { QoderQuotaBucket, QoderUsageResult, QoderUsageSnapshot } from "../../../../shared/types/qoderUsage";
import { t } from "../../i18n";
import { formatCost, formatTokens } from "../app/usageStats/format";
import { formatBalance } from "../../utils/providerUsageDisplay";
import { Badge } from "../ui-shadcn/badge";
import { Button } from "../ui-shadcn/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui-shadcn/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui-shadcn/tooltip";

function formatTime(ts: number): string {
	try {
		return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(ts));
	} catch {
		return "";
	}
}

function errorCopy(code: Extract<AiAaaUsageResult, { ok: false }>["code"], status?: number): { title: string; hint?: string } {
	switch (code) {
		case "not-configured":
			return { title: t("aiAaaUsage.notConfigured"), hint: t("aiAaaUsage.notConfiguredHint") };
		case "unauthorized":
			return { title: t("aiAaaUsage.unauthorized"), hint: t("aiAaaUsage.unauthorizedHint") };
		case "timeout":
			return { title: t("aiAaaUsage.timeout") };
		case "network":
			return { title: t("aiAaaUsage.network") };
		case "http":
			return { title: t("aiAaaUsage.httpError", { status: String(status ?? "-") }) };
		case "invalid-response":
			return { title: t("aiAaaUsage.invalidResponse") };
	}
}

function UsageBody(props: { snapshot: AiAaaUsageSnapshot }) {
	const { snapshot } = props;
	const today = snapshot.today;
	const week = snapshot.daily.slice(-7);
	const maxCost = Math.max(...week.map((day) => day.actualCost), 0.000001);
	const weekTotal = week.reduce((sum, day) => sum + day.actualCost, 0);
	const previous = snapshot.daily.length >= 2 ? snapshot.daily[snapshot.daily.length - 2] : undefined;
	const deltaPercent = previous && previous.actualCost > 0 ? ((today.actualCost - previous.actualCost) / previous.actualCost) * 100 : null;
	const cacheTokens = today.cacheReadTokens + today.cacheCreationTokens;

	return (
		<>
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<div className="text-caption text-muted-foreground">{t("aiAaaUsage.todayCost")}</div>
					<div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
						<span className="text-2xl font-semibold tabular-nums text-foreground">{formatCost(today.actualCost)}</span>
						{deltaPercent !== null && <span className={["text-caption tabular-nums", deltaPercent > 0 ? "text-danger" : deltaPercent < 0 ? "text-success" : "text-muted-foreground"].join(" ")}>{t("aiAaaUsage.vsYesterday", { value: `${deltaPercent > 0 ? "+" : ""}${deltaPercent.toFixed(1)}%` })}</span>}
					</div>
					<div className="mt-1 text-caption text-muted-foreground">{t("aiAaaUsage.requestsAndTokens", { requests: String(today.requests), tokens: formatTokens(today.totalTokens) })}</div>
				</div>
				{snapshot.planName && (
					<Badge variant="neutral" size="sm" className="mt-0.5 max-w-28 truncate" title={snapshot.planName}>
						{snapshot.planName}
					</Badge>
				)}
			</div>

			<div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-bg-muted/50 p-3 text-caption">
				<div className="flex items-center justify-between gap-2">
					<span className="text-muted-foreground">{t("aiAaaUsage.input")}</span>
					<span className="font-medium tabular-nums">{formatTokens(today.inputTokens)}</span>
				</div>
				<div className="flex items-center justify-between gap-2">
					<span className="text-muted-foreground">{t("aiAaaUsage.output")}</span>
					<span className="font-medium tabular-nums">{formatTokens(today.outputTokens)}</span>
				</div>
				<div className="flex items-center justify-between gap-2">
					<span className="text-muted-foreground">{t("aiAaaUsage.cache")}</span>
					<span className="font-medium tabular-nums">{formatTokens(cacheTokens)}</span>
				</div>
				<div className="flex items-center justify-between gap-2">
					<span className="text-muted-foreground">{t("aiAaaUsage.balance")}</span>
					<span className="font-medium tabular-nums">{snapshot.balance === undefined ? "-" : formatBalance({ value: snapshot.balance, currency: snapshot.currency })}</span>
				</div>
			</div>

			{week.length > 0 && (
				<div className="mt-3">
					<div className="flex items-center justify-between text-caption text-muted-foreground">
						<span>{t("aiAaaUsage.last7Days")}</span>
						<span className="tabular-nums">{formatCost(weekTotal)}</span>
					</div>
					<div className="mt-2 grid h-16 grid-cols-7 items-end gap-1" role="img" aria-label={t("aiAaaUsage.last7Days")}>
						{week.map((day, index) => {
							const isToday = index === week.length - 1;
							return (
								<div key={day.date} className="flex h-full items-end" title={`${day.date} · ${formatCost(day.actualCost)}`}>
									<div className={["w-full rounded-t-[2px]", isToday ? "bg-primary" : "bg-primary/35"].join(" ")} style={{ height: `${Math.max(4, Math.round((day.actualCost / maxCost) * 100))}%` }} />
								</div>
							);
						})}
					</div>
					<div className="mt-1 grid grid-cols-7 gap-1 text-center text-[9px] leading-none text-muted-foreground">
						{week.map((day) => (
							<span key={day.date} className="truncate tabular-nums">
								{day.date.slice(5)}
							</span>
						))}
					</div>
				</div>
			)}

			<div className="mt-3 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
				<span>{t("aiAaaUsage.updatedAt", { time: formatTime(snapshot.fetchedAt) })}</span>
				{today.actualCost !== today.cost && <span>{t("aiAaaUsage.actualCostHint", { cost: formatCost(today.cost) })}</span>}
			</div>
		</>
	);
}

function formatCredits(value: number | undefined): string {
	return value === undefined ? "—" : value.toFixed(2);
}

function QoderBucketRow(props: { label: string; bucket: QoderQuotaBucket }) {
	const { bucket } = props;
	const unit = bucket.unit ? ` ${bucket.unit}` : " Credits";
	const remaining = bucket.remaining ?? (bucket.total !== undefined && bucket.used !== undefined ? Math.max(0, bucket.total - bucket.used) : undefined);
	return (
		<div className="flex items-center justify-between gap-2">
			<span className="text-muted-foreground">{props.label}</span>
			<span className="text-right font-medium tabular-nums">
				{formatCredits(bucket.used)}
				<span className="text-muted-foreground"> / </span>
				{formatCredits(bucket.total)}
				{unit}
				{remaining !== undefined ? <span className="ml-1 text-caption text-muted-foreground">（剩余 {formatCredits(remaining)}）</span> : null}
			</span>
		</div>
	);
}

function QoderUsageBody(props: { snapshot: QoderUsageSnapshot }) {
	const { snapshot } = props;
	const buckets = [
		{ key: "user", label: t("qoderUsage.personal"), bucket: snapshot.userQuota },
		{ key: "addon", label: t("qoderUsage.addOn"), bucket: snapshot.addOnQuota },
		{ key: "org", label: t("qoderUsage.org"), bucket: snapshot.orgResourcePackage },
	].filter((item): item is { key: string; label: string; bucket: QoderQuotaBucket } => Boolean(item.bucket));
	return (
		<div className="border-t border-border/60 pt-3">
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<div className="font-medium text-foreground">{t("qoderUsage.title")}</div>
					<div className="mt-0.5 text-caption text-muted-foreground">{t("qoderUsage.subtitle")}</div>
				</div>
				<Badge variant="neutral" size="sm" className="mt-0.5 max-w-28 truncate" title={snapshot.title}>
					{snapshot.title}
				</Badge>
			</div>
			<div className="mt-2 grid gap-2 rounded-lg bg-bg-muted/50 p-3 text-caption">{buckets.length > 0 ? buckets.map((item) => <QoderBucketRow key={item.key} label={item.label} bucket={item.bucket} />) : <span className="text-muted-foreground">{t("qoderUsage.noQuota")}</span>}</div>
			<div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
				<span>{t("qoderUsage.updatedAt", { time: formatTime(snapshot.fetchedAt) })}</span>
				{snapshot.expiresAt ? <span>{t("qoderUsage.expiresAt", { date: new Date(snapshot.expiresAt).toLocaleDateString() })}</span> : null}
			</div>
		</div>
	);
}

function QoderUsageSection(props: { result: QoderUsageResult | null; loading: boolean; onRetry: () => void }) {
	if (props.result && !props.result.ok && props.result.code === "not-configured") return null;
	if (!props.result && !props.loading) return null;
	return (
		<div className="mt-3">
			{props.loading && !props.result ? <div className="py-2 text-center text-caption text-muted-foreground">{t("qoderUsage.loading")}</div> : null}
			{props.result?.ok ? <QoderUsageBody snapshot={props.result.snapshot} /> : null}
			{props.result && !props.result.ok ? (
				<div className="flex items-center justify-between gap-2 rounded-md border border-warning/20 bg-warning-soft px-2.5 py-2 text-caption">
					<span className="min-w-0 text-muted-foreground">{props.result.code === "unauthorized" ? t("qoderUsage.unauthorized") : t("qoderUsage.queryFailed")}</span>
					<Button type="button" size="sm" variant="secondary" onClick={props.onRetry} disabled={props.loading}>
						{t("aiAaaUsage.retry")}
					</Button>
				</div>
			) : null}
		</div>
	);
}

export function AiAaaUsageButton() {
	const [open, setOpen] = useState(false);
	const [result, setResult] = useState<AiAaaUsageResult | null>(null);
	const [qoderResult, setQoderResult] = useState<QoderUsageResult | null>(null);
	const [loading, setLoading] = useState(false);
	const requestId = useRef(0);

	const load = useCallback(async (force: boolean) => {
		const id = ++requestId.current;
		setLoading(true);
		try {
			const [next, qoderNext] = await Promise.all([window.piDesktop.aiAaaUsage.get(force).catch((): AiAaaUsageResult => ({ ok: false, code: "network" })), window.piDesktop.qoderUsage.get(force).catch((): QoderUsageResult => ({ ok: false, code: "network" }))]);
			if (id === requestId.current) {
				setResult(next);
				setQoderResult(qoderNext);
			}
		} finally {
			if (id === requestId.current) setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (open) void load(false);
	}, [open, load]);

	const retry = () => void load(true);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<Tooltip delayDuration={300}>
				<TooltipTrigger asChild>
					<PopoverTrigger asChild>
						<Button type="button" variant="ghost" className="size-full rounded-full text-muted-foreground hover:bg-bg-hover hover:text-foreground" aria-label={t("aiAaaUsage.tooltip")}>
							<ChartColumnBig className="size-4" />
						</Button>
					</PopoverTrigger>
				</TooltipTrigger>
				<TooltipContent side="right" sideOffset={6}>
					{t("aiAaaUsage.tooltip")}
				</TooltipContent>
			</Tooltip>
			<PopoverContent side="right" align="end" sideOffset={10} className="w-[350px] overflow-hidden p-0">
				<div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
					<div className="min-w-0">
						<div className="font-medium text-foreground">{t("aiAaaUsage.title")}</div>
						<div className="mt-0.5 text-caption text-muted-foreground">{t("aiAaaUsage.subtitle")}</div>
					</div>
					<Button type="button" size="icon-xs" variant="ghost" aria-label={t("aiAaaUsage.refresh")} title={t("aiAaaUsage.refresh")} disabled={loading} onClick={retry}>
						<RefreshCw className={loading ? "animate-pideck-spin" : undefined} />
					</Button>
				</div>
				<div className="p-4">
					{loading && !result && <div className="py-6 text-center text-caption text-muted-foreground">{t("aiAaaUsage.loading")}</div>}
					{result?.ok && <UsageBody snapshot={result.snapshot} />}
					{result && !result.ok && (
						<div className="flex flex-col items-center gap-2 py-4 text-center">
							<AlertCircle className="size-5 text-warning" aria-hidden="true" />
							<div className="text-control font-medium">{errorCopy(result.code, result.status).title}</div>
							{errorCopy(result.code, result.status).hint && <div className="text-caption text-muted-foreground">{errorCopy(result.code, result.status).hint}</div>}
							<Button type="button" size="sm" variant="secondary" className="mt-1" onClick={retry} disabled={loading}>
								{t("aiAaaUsage.retry")}
							</Button>
						</div>
					)}
					<QoderUsageSection result={qoderResult} loading={loading} onRetry={retry} />
				</div>
			</PopoverContent>
		</Popover>
	);
}
