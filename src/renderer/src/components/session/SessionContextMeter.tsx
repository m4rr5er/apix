import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FoldVertical } from "lucide-react";
import { useAtomValue, useSetAtom } from "jotai";
import { tpsDisplayModeAtom } from "../../atoms/tps-atoms";
import { t } from "../../i18n";
import type { AgentRuntimeState } from "../../../../shared/types";
import type { UsageProbeBackend } from "../../../../shared/types/providerUsage";
import { compactUiState, resolveCompactUsagePercent } from "../../../../shared/compactFeedback";
import type { SessionRuntimeTarget } from "../../../../shared/types";
import { openSettingsAtom } from "../../atoms/app-ui-atoms";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui-shadcn/tooltip";
import { ProviderUsageDetails } from "../app/ProviderUsageDetails";
import { buildSessionStatusDetail } from "./SurfaceComponents";
import { formatPercent } from "./TimelineFormat";

const RADIUS = 5.5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const COLOR_CONVERSATION = "var(--color-context-conversation, #2563eb)";
const COLOR_SYSTEM_TOOLS = "var(--color-context-system-tools, rgb(167, 139, 250))";
const COLOR_SYSTEM = "var(--color-context-system, #94a3b8)";
const COLOR_TOOLS = "var(--color-context-tools, rgb(167, 139, 250))";

const PANEL_WIDTH = 320;

export function formatTokens(n: number): string {
	const scaled = (v: number): string => (v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10));
	if (n < 1_000) return String(n);
	if (n < 1_000_000) return `${scaled(n / 1_000)}K`;
	return `${scaled(n / 1_000_000)}M`;
}

function currencySymbol(code?: string): string {
	switch ((code ?? "").toUpperCase()) {
		case "CNY":
		case "RMB":
			return "¥";
		case "USD":
			return "$";
		case "EUR":
			return "€";
		case "GBP":
			return "£";
		default:
			return (code ?? "").trim();
	}
}

function formatAmount(n: number): string {
	const rounded = Math.round(n * 100) / 100;
	return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function formatBalance(balance: { value: number; currency?: string }): string {
	const symbol = currencySymbol(balance.currency);
	const amount = formatAmount(balance.value);
	if (symbol) return `${symbol}${amount}`;
	if (balance.currency) return `${amount} ${balance.currency}`;
	return amount;
}

export function contextOccupancy(state: Pick<AgentRuntimeState, "contextPercent" | "contextTokens" | "contextWindow"> | undefined): { percent: number; usedTokens?: number; contextWindow?: number } | null {
	const usedTokens = state?.contextTokens ?? undefined;
	const contextWindow = state?.contextWindow ?? undefined;

	const percent = resolveCompactUsagePercent(state);
	if (percent == null || contextWindow == null) return null;
	return {
		percent,
		usedTokens,
		contextWindow,
	};
}

export type ContextSegments = { kind: "breakdown"; system: number; tools: number; conversation: number } | { kind: "estimate"; conversation: number; systemTools: number };

export function contextSegments(state: Pick<AgentRuntimeState, "contextTokens" | "contextMessageTokens" | "contextSystemTokens" | "contextToolsTokens"> | undefined): ContextSegments | null {
	if (state?.contextSystemTokens != null && state?.contextToolsTokens != null) {
		return {
			kind: "breakdown",
			system: state.contextSystemTokens,
			tools: state.contextToolsTokens,
			conversation: state.contextMessageTokens ?? 0,
		};
	}
	const total = state?.contextTokens;
	const messageTokens = state?.contextMessageTokens;
	if (total == null || total <= 0 || messageTokens == null || messageTokens <= 0) return null;
	const conversation = Math.min(messageTokens, total);
	return { kind: "estimate", conversation, systemTools: Math.max(0, total - conversation) };
}

export function SessionContextMeter(props: {
	state?: Pick<
		AgentRuntimeState,
		| "contextPercent"
		| "contextTokens"
		| "contextWindow"
		| "contextOverflow"
		| "contextMessageTokens"
		| "cacheHitPercent"
		| "cacheHitAveragePercent"
		| "cacheHitSampleCount"
		| "inputTokens"
		| "outputTokens"
		| "isCompacting"
		| "cost"
		| "ttftMs"
		| "totalMs"
		| "tps"
		| "endToEndTps"
		| "cacheRead"
		| "cacheWrite"
		| "cacheTotal"
		| "provider"
	>;

	onCompact?: () => void;

	overflowRecoveryTarget?: SessionRuntimeTarget;
	onOverflowRecovery?: (target: SessionRuntimeTarget) => void;

	fallbackProvider?: string;

	backend?: UsageProbeBackend;
}) {
	const tpsMode = useAtomValue(tpsDisplayModeAtom);
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLSpanElement | null>(null);

	const [placement, setPlacement] = useState<{ left: number; top: number } | null>(null);
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const panelRef = useRef<HTMLDivElement | null>(null);
	const context = contextOccupancy(props.state);
	const available = context !== null;
	const segments = contextSegments(props.state);
	const compacting = props.state?.isCompacting === true;

	const detail = buildSessionStatusDetail(props.state, props.state?.cacheHitAveragePercent ?? undefined, props.state?.cacheHitSampleCount ?? 0, tpsMode);

	const panelDetailRows = detail.detailRows;

	const provider = props.state?.provider?.trim() || props.fallbackProvider?.trim() || undefined;
	const openModelsSettings = useSetAtom(openSettingsAtom);

	const onConfigureUsage = useCallback(() => {
		if (!provider) return;
		openModelsSettings({ tab: "common", pane: "config", configTab: "models", provider });
	}, [provider, openModelsSettings]);

	const showUsage = provider != null;

	const positionPanel = useCallback(() => {
		const trigger = triggerRef.current;
		const panel = panelRef.current;
		if (!trigger || !panel) return;
		const rect = trigger.getBoundingClientRect();
		const panelWidth = panel.offsetWidth || PANEL_WIDTH;
		const panelHeight = panel.offsetHeight;
		const left = Math.max(8, Math.min(rect.right - panelWidth, window.innerWidth - panelWidth - 8));
		let top = rect.top - 8 - panelHeight;
		if (top < 8) top = rect.bottom + 8;

		setPlacement((prev) => (prev !== null && prev.left === left && prev.top === top ? prev : { left, top }));
	}, []);

	useLayoutEffect(() => {
		if (!open) return;
		positionPanel();
	}, [open, context?.percent, context?.usedTokens, context?.contextWindow, props.state?.cost, props.state?.cacheHitPercent, props.state?.cacheHitAveragePercent, props.state?.isCompacting, positionPanel]);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent): void => {
			const inside = e.target instanceof Node && (rootRef.current?.contains(e.target) === true || panelRef.current?.contains(e.target) === true);
			if (inside) return;
			setOpen(false);
		};
		const onKeyDown = (e: KeyboardEvent): void => {
			if (e.key === "Escape") setOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);

	useEffect(() => {
		if (!open) return;
		let raf = 0;
		const reanchor = (): void => {
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(positionPanel);
		};
		window.addEventListener("scroll", reanchor, true);
		window.addEventListener("resize", reanchor);
		return () => {
			cancelAnimationFrame(raf);
			window.removeEventListener("scroll", reanchor, true);
			window.removeEventListener("resize", reanchor);
		};
	}, [open, positionPanel]);

	const percent = context?.percent ?? 0;

	const overflowRecovery = props.state?.contextOverflow === true;

	const reading = context !== null ? t("sessionContext.used", { percent: formatPercent(percent) }) : overflowRecovery ? t("sessionContext.overflow") : t("sessionContext.unavailable");
	const figures = context !== null && [context.usedTokens, context.contextWindow].every((v) => v != null) ? `~${formatTokens(context.usedTokens!)} / ${formatTokens(context.contextWindow!)}` : undefined;
	const breakdownSegments =
		segments?.kind === "breakdown"
			? (() => {
					const breakdownTotal = segments.system + segments.tools + segments.conversation;
					if (breakdownTotal <= 0) return [];
					const parts = [
						{ key: "system", tokens: segments.system, color: COLOR_SYSTEM },
						{ key: "tools", tokens: segments.tools, color: COLOR_TOOLS },
						{ key: "conversation", tokens: segments.conversation, color: COLOR_CONVERSATION },
					];
					return parts.filter((part) => part.tokens > 0).map((part) => ({ key: part.key, color: part.color, width: Math.min(100, (percent * part.tokens) / breakdownTotal) }));
				})()
			: undefined;
	const showCompact = props.onCompact !== undefined || (overflowRecovery && props.overflowRecoveryTarget !== undefined && props.onOverflowRecovery !== undefined);

	const compactUi = compactUiState(context?.percent, compacting);
	const compactDisabled = compactUi.compacting || (!compactUi.ready && !overflowRecovery);
	const compactUrgency = overflowRecovery
		? "text-destructive border-destructive/40 bg-destructive/5 hover:bg-destructive/10"
		: compactUi.urgency === "danger"
			? "text-destructive border-destructive/40 hover:bg-destructive/10"
			: compactUi.urgency === "warn"
				? "text-amber-500 border-amber-500/40 hover:bg-amber-500/10"
				: "border-border hover:bg-muted/60";

	return (
		<span ref={rootRef} className="relative inline-flex" data-testid="session-context-meter">
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						ref={triggerRef}
						type="button"
						className="grid size-7 flex-none place-items-center rounded-full text-text-tertiary transition-colors hover:bg-muted/60"
						aria-label={reading}
						aria-haspopup="dialog"
						aria-expanded={open}
						onClick={() => {
							setOpen((value) => !value);
						}}
					>
						<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
							<circle className="fill-none stroke-[var(--color-border)]" cx="7" cy="7" r={RADIUS} strokeWidth={2} />
							<circle className="fill-none stroke-[var(--color-text-tertiary)] [stroke-linecap:round]" cx="7" cy="7" r={RADIUS} strokeWidth={2} strokeDasharray={`${(CIRCUMFERENCE * percent) / 100} ${CIRCUMFERENCE}`} transform="rotate(-90 7 7)" />
						</svg>
					</button>
				</TooltipTrigger>
				<TooltipContent>{reading}</TooltipContent>
			</Tooltip>
			{open &&
				createPortal(
					<div
						ref={panelRef}
						role="dialog"
						aria-label={reading}
						className="fixed z-[100] cursor-default rounded-xl border border-border bg-popover p-3 text-xs leading-5 text-text-secondary shadow-[var(--shadow-popover)]"
						style={{
							left: placement?.left,
							top: placement?.top,
							width: PANEL_WIDTH,
							visibility: placement === null ? "hidden" : "visible",
						}}
					>
						<div className="flex items-center gap-1.5">
							<span className="text-text-tertiary" title={t("sessionContext.usageHint")}>
								{reading}
							</span>
							{available && figures !== undefined && <span className="ml-auto font-medium tabular-nums text-foreground">{figures}</span>}
						</div>
						<div className="mt-2.5 h-1 overflow-hidden rounded-full bg-muted">
							{segments === null ? (
								<div className="h-full rounded-full bg-text-tertiary" style={{ width: `${percent}%` }} />
							) : segments.kind === "breakdown" ? (
								<div className="flex h-full overflow-hidden rounded-full">
									{breakdownSegments?.map((part) => (
										<div key={part.key} className="h-full" style={{ width: `${part.width}%`, backgroundColor: part.color }} />
									))}
								</div>
							) : (
								<div className="flex h-full overflow-hidden rounded-full">
									<div
										className="h-full"
										style={{
											width: `${Math.min(100, (segments.conversation / (context?.contextWindow ?? 1)) * 100)}%`,
											backgroundColor: COLOR_CONVERSATION,
										}}
									/>
									<div
										className="h-full"
										style={{
											width: `${Math.min(100, (segments.systemTools / (context?.contextWindow ?? 1)) * 100)}%`,
											backgroundColor: COLOR_SYSTEM_TOOLS,
										}}
									/>
								</div>
							)}
						</div>
						{available && segments !== null && (
							<div className="mt-2 space-y-0.5">
								{segments.kind === "breakdown" ? (
									<>
										<div className="flex items-center gap-1.5">
											<span className="size-2 flex-none rounded-[2px]" style={{ backgroundColor: COLOR_SYSTEM }} />
											<span title={t("sessionContext.systemHint")}>{t("sessionContext.system")}</span>
											<span className="ml-auto tabular-nums text-text-tertiary">~{formatTokens(segments.system)}</span>
										</div>
										<div className="flex items-center gap-1.5">
											<span className="size-2 flex-none rounded-[2px]" style={{ backgroundColor: COLOR_TOOLS }} />
											<span title={t("sessionContext.toolsHint")}>{t("sessionContext.tools")}</span>
											<span className="ml-auto tabular-nums text-text-tertiary">~{formatTokens(segments.tools)}</span>
										</div>
										<div className="flex items-center gap-1.5">
											<span className="size-2 flex-none rounded-[2px]" style={{ backgroundColor: COLOR_CONVERSATION }} />
											<span title={t("sessionContext.conversationHint")}>{t("sessionContext.conversation")}</span>
											<span className="ml-auto tabular-nums text-text-tertiary">~{formatTokens(segments.conversation)}</span>
										</div>
									</>
								) : (
									<>
										<div className="flex items-center gap-1.5">
											<span className="size-2 flex-none rounded-[2px]" style={{ backgroundColor: COLOR_CONVERSATION }} />
											<span title={t("sessionContext.conversationEstimateHint")}>{t("sessionContext.conversation")}</span>
											<span className="ml-auto tabular-nums text-text-tertiary">~{formatTokens(segments.conversation)}</span>
										</div>
										<div className="flex items-center gap-1.5">
											<span className="size-2 flex-none rounded-[2px]" style={{ backgroundColor: COLOR_SYSTEM_TOOLS }} />
											<span title={t("sessionContext.systemToolsEstimateHint")}>{t("sessionContext.systemTools")}</span>
											<span className="ml-auto tabular-nums text-text-tertiary">~{formatTokens(segments.systemTools)}</span>
										</div>
									</>
								)}
							</div>
						)}
						{(panelDetailRows.length > 0 || detail.replyPerfRows.length > 0 || detail.sessionStatRows.length > 0) && (
							<div className="mt-2 space-y-0.5 border-t border-border pt-2">
								{panelDetailRows.map((row) => (
									<div key={row.label} title={row.hint} className={`flex items-baseline justify-between gap-4 px-0.5 py-0.5 text-caption leading-5${row.emphasis ? " mt-1 border-t border-border/70 pt-1.5" : ""}`}>
										<span className="shrink-0 text-text-secondary">{row.label}</span>
										<span className="min-w-0 whitespace-nowrap text-right font-mono font-semibold tabular-nums text-foreground">{row.value}</span>
									</div>
								))}
							</div>
						)}
						{detail.replyPerfRows.length > 0 && (
							<div className="mt-2.5 space-y-0.5 border-t border-border pt-2">
								<div className="px-0.5 text-micro font-semibold uppercase tracking-wide text-text-tertiary">{t("ctx.detail.lastReply")}</div>
								{detail.replyPerfRows.map((row) => (
									<div key={row.label} title={row.hint} className="flex items-baseline justify-between gap-4 px-0.5 py-0.5 text-caption leading-5">
										<span className="shrink-0 text-text-secondary">{row.label}</span>
										<span className="min-w-0 whitespace-nowrap text-right font-mono font-semibold tabular-nums text-foreground">{row.value}</span>
									</div>
								))}
							</div>
						)}
						{detail.sessionStatRows.length > 0 && (
							<div className="mt-2.5 space-y-0.5 border-t border-border pt-2">
								<div className="px-0.5 text-micro font-semibold uppercase tracking-wide text-text-tertiary">{t("ctx.detail.sessionStats")}</div>
								{detail.sessionStatRows.map((row) => (
									<div key={row.label} title={row.hint} className="flex items-baseline justify-between gap-4 px-0.5 py-0.5 text-caption leading-5">
										<span className="shrink-0 text-text-secondary">{row.label}</span>
										<span className="min-w-0 whitespace-nowrap text-right font-mono font-semibold tabular-nums text-foreground">{row.value}</span>
									</div>
								))}
							</div>
						)}
						{provider && showUsage && (
							<div className="mt-2.5" data-testid="session-context-usage">
								<ProviderUsageDetails provider={provider} backend={props.backend} onConfigureUsage={onConfigureUsage} />
							</div>
						)}
						{showCompact && (
							<button
								type="button"
								data-testid="session-context-compact"
								disabled={compactDisabled}
								title={compactUi.compacting ? t("sessionContext.compacting") : overflowRecovery ? t("sessionContext.compactOverflowHint") : compactUi.ready ? t("sessionContext.compact") : t("sessionContext.compactNotReadyHint")}
								onClick={() => {
									if (overflowRecovery && props.overflowRecoveryTarget && props.onOverflowRecovery) {
										props.onOverflowRecovery(props.overflowRecoveryTarget);
										return;
									}
									props.onCompact?.();
								}}
								className={`mt-2 flex h-7 w-full items-center justify-center gap-1.5 rounded-md border bg-transparent text-xs font-medium transition-colors disabled:cursor-default disabled:opacity-60 ${compactUrgency}`}
							>
								<FoldVertical size={13} className={compactUi.compacting ? "animate-pideck-spin" : undefined} />
								{compactUi.compacting ? t("sessionContext.compacting") : overflowRecovery ? t("sessionContext.compactOverflow") : compactUi.ready ? t("sessionContext.compact") : t("sessionContext.compactNotReady")}
							</button>
						)}
					</div>,
					document.body,
				)}
		</span>
	);
}
