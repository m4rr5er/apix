import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useAtomValue } from "jotai";
import { Loader2, Activity, ArrowLeft, Check, Clock, Copy, CornerUpLeft, FileJson, Hash, Wrench } from "lucide-react";
import type { AgentRuntimeState, ChatMessage } from "../../../../../shared/types";
import type { SessionProcessEvent, SessionPromptSnapshot } from "../../../../../shared/types/trajectory";
import type { ModelTraceLogData } from "../../../../../shared/types/rpcLog";
import { sessionRuntimeBySessionIdAtomFamily } from "../../../atoms";
import { tpsDisplayModeAtom } from "../../../atoms/tps-atoms";
import { buildTpsDisplay } from "../../../utils/tpsDisplay";
import { desktopApi } from "../../../desktopApi";
import { t } from "../../../i18n";
import { writeClipboard } from "../../../utils/clipboard";
import { formatDuration, formatTime } from "../TimelineFormat";
import { buildTrajectory, filterRecordsByRange, traceSizeLabel, type TrajectoryLane, type TrajectoryModelTraceSummary, type TrajectoryRecord, type TrajectoryTimeRange, type TrajectoryTurn } from "./buildTrajectory";
import type { SessionFactsCoverage } from "../../../../../shared/types/trajectory";
import { bucketOverviewTicks, buildTrajectoryWindow } from "./trajectoryWindow";
import { defaultFoldedTurns, foldedTurnPeek, foldTurnRecords, summarizeTurn } from "./trajectoryFold";
import { ModelTraceDetail } from "../../workspace/ModelTraceDetail";
import { countUserTurns } from "../timeline/turnRenderWindow";

const LANE_ORDER: TrajectoryLane[] = ["input", "model", "tools", "process"];
const MIN_DRAG_PX = 4;
const MIN_ZOOM_SPAN_MS = 40;

const trajectoryLedgerScrollStore = new Map<string, number>();

function laneLabel(lane: TrajectoryLane): string {
	if (lane === "input") return t("session.trajectory.lane.input");
	if (lane === "tools") return t("session.trajectory.lane.tools");
	if (lane === "process") return t("session.trajectory.lane.process");
	return t("session.trajectory.lane.model");
}

function kindLabel(record: TrajectoryRecord): string {
	if (record.kind === "user") {
		return record.isInitialPrompt ? t("session.trajectory.kind.initialPrompt") : t("session.trajectory.kind.user");
	}
	if (record.kind === "assistant") return t("session.trajectory.kind.assistant");
	if (record.kind === "thinking") return t("session.trajectory.kind.thinking");
	if (record.kind === "tool") return t("session.trajectory.kind.tool");
	if (record.kind === "modelRequest") return t("session.trajectory.kind.modelRequest");
	if (record.kind === "error") return t("session.trajectory.kind.error");
	if (record.kind === "systemPrompt") {
		if (record.promptKind === "initial") return t("session.trajectory.kind.systemPromptInitial");
		if (record.promptKind === "update") return t("session.trajectory.kind.systemPromptUpdate");
		if (record.promptKind === "snapshot") return t("session.trajectory.kind.systemPromptSnapshot");
		return t("session.trajectory.kind.systemPrompt");
	}
	if (record.kind === "process") {
		if (record.processKind === "session") return t("session.trajectory.kind.sessionHeader");
		if (record.processKind === "sessionInfo") return t("session.trajectory.kind.sessionInfo");
		if (record.processKind === "modelChange") return t("session.trajectory.kind.modelChange");
		if (record.processKind === "thinkingChange") return t("session.trajectory.kind.thinkingChange");
		if (record.processKind === "compaction") return t("session.trajectory.kind.compaction");
		if (record.processKind === "custom") return t("session.trajectory.kind.custom");
		if (record.processKind === "import") return t("session.trajectory.kind.import");
		if (record.processKind === "retry") return t("session.trajectory.kind.retry");
		if (record.processKind === "usage") return t("session.trajectory.kind.usage");
		return t("session.trajectory.kind.process");
	}
	return t("session.trajectory.kind.system");
}

function laneTone(lane: TrajectoryLane): string {
	if (lane === "input") return "bg-primary/70";
	if (lane === "tools") return "bg-amber-500/75 dark:bg-amber-400/70";
	if (lane === "process") return "bg-violet-500/70 dark:bg-violet-400/65";
	return "bg-sky-500/70 dark:bg-sky-400/65";
}

function projectLeft(start: number, domainStart: number, span: number): number {
	if (span <= 0) return 0;
	return ((start - domainStart) / span) * 100;
}

function projectWidth(start: number, end: number, domainStart: number, span: number): number {
	if (span <= 0) return 100;
	return Math.max(((end - start) / span) * 100, 0.35);
}

function formatClock(ts: number): string {
	return new Date(ts).toLocaleTimeString(undefined, {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

function durationLabel(record: TrajectoryRecord): string {
	if (record.kind === "modelRequest") return traceSizeLabel(record.modelTrace?.payloadBytes) || "—";
	if (record.endedAt === undefined) return t("session.trajectory.inFlight");
	if (record.durationMs === undefined) return t("session.trajectory.durationUnknown");
	return formatDuration(record.durationMs);
}

function rowTimeLabel(record: TrajectoryRecord): string {
	if (record.kind === "modelRequest") return traceSizeLabel(record.modelTrace?.payloadBytes) || "—";
	if (record.endedAt === undefined) return t("session.trajectory.inFlight");
	if (record.durationMs === undefined) return record.startedAt > 0 ? formatClock(record.startedAt) : "—";
	return formatDuration(record.durationMs);
}

function compactTokens(value: number): string {
	if (value >= 10_000) return `${Math.round(value / 1000)}k`;
	if (value >= 1_000) return `${(value / 1000).toFixed(1)}k`;
	return String(value);
}

function usageSummary(record: TrajectoryRecord): string | undefined {
	if (!record.usage) return undefined;
	return `${compactTokens(record.usage.inputTokens)}→${compactTokens(record.usage.outputTokens)}`;
}

function usageTitle(record: TrajectoryRecord): string | undefined {
	const usage = record.usage;
	if (!usage) return undefined;
	return [
		`${t("session.trajectory.field.inputTokens")} ${usage.inputTokens}`,
		`${t("session.trajectory.field.outputTokens")} ${usage.outputTokens}`,
		usage.reasoningTokens !== undefined ? `${t("session.trajectory.field.reasoningTokens")} ${usage.reasoningTokens}` : undefined,
		usage.cacheReadTokens !== undefined ? `${t("session.trajectory.field.cacheRead")} ${usage.cacheReadTokens}` : undefined,
		usage.cacheWriteTokens !== undefined ? `${t("session.trajectory.field.cacheWrite")} ${usage.cacheWriteTokens}` : undefined,
	]
		.filter(Boolean)
		.join(" · ");
}

export function SessionTrajectoryView(props: {
	sessionId: string;
	messages: ChatMessage[];
	processEvents?: SessionProcessEvent[];

	modelTraces?: TrajectoryModelTraceSummary[];

	coverage?: SessionFactsCoverage;

	sourceSession?: { sessionId: string; title: string };

	onOpenSourceSession?: () => void;
	hasMoreMessages?: boolean;
	isLoadingMoreMessages?: boolean;
	onLoadMore?: () => void;
	variant?: "page" | "drawer";
}) {
	const runtime = useAtomValue(sessionRuntimeBySessionIdAtomFamily(props.sessionId));

	const dialogueTurns = countUserTurns(props.messages);
	const [now, setNow] = useState(() => Date.now());
	const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
	const [range, setRange] = useState<TrajectoryTimeRange | undefined>(undefined);

	const ledgerScrollRef = useRef<HTMLDivElement | null>(null);
	const scrollRestoredForRef = useRef<string | undefined>(undefined);
	const model = useMemo(() => {
		const started = performance.now();
		const built = buildTrajectory(props.messages, now, {
			processEvents: props.processEvents,
			modelTraces: props.modelTraces,
		});
		if (import.meta.env.DEV) {
			DEV_METRICS.buildCalls = Number(DEV_METRICS.buildCalls ?? 0) + 1;
			DEV_METRICS.lastBuildMs = Math.round((performance.now() - started) * 10) / 10;
			DEV_METRICS.records = built.records.length;
		}
		return built;
	}, [props.messages, props.processEvents, props.modelTraces, now]);
	const visible = useMemo(() => filterRecordsByRange(model.records, range), [model.records, range]);

	const [turnCount, setTurnCount] = useState(3);

	const [foldedTurns, setFoldedTurns] = useState<Set<number>>(() => new Set(defaultFoldedTurns(model.turns)));
	const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
	useEffect(() => {
		setFoldedTurns(new Set(defaultFoldedTurns(model.turns)));
		setExpandedGroups(new Set());
	}, [props.sessionId]);
	const toggleTurn = useCallback((turn: number) => {
		setFoldedTurns((current) => {
			const next = new Set(current);
			if (next.has(turn)) next.delete(turn);
			else next.add(turn);
			return next;
		});
	}, []);
	const toggleGroup = useCallback((key: string) => {
		setExpandedGroups((current) => {
			const next = new Set(current);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	}, []);
	const allFolded = model.turns.length > 0 && model.turns.every((turn) => foldedTurns.has(turn.index));
	const toggleAllTurns = useCallback(() => {
		setFoldedTurns(allFolded ? new Set() : new Set(model.turns.map((turn) => turn.index)));
	}, [allFolded, model.turns]);
	useEffect(() => {
		setTurnCount(3);
	}, [props.sessionId]);
	const windowTurnCount = useMemo(() => {
		const selectedTurn = visible.find((record) => record.id === selectedId)?.turnIndex;
		const lastTurn = visible[visible.length - 1]?.turnIndex ?? 0;
		const needed = selectedTurn === undefined ? 0 : lastTurn - selectedTurn + 1;
		return Math.max(turnCount, needed);
	}, [turnCount, selectedId, visible]);
	const windowed = useMemo(() => buildTrajectoryWindow(visible, { turnCount: windowTurnCount }), [visible, windowTurnCount]);

	const lastExpandRef = useRef(0);
	useEffect(() => {
		if (!import.meta.env.DEV) return;
		DEV_METRICS.sessionId = props.sessionId;
		DEV_METRICS.mountedRecords = windowed.records.length;
		DEV_METRICS.totalRecords = model.records.length;
		DEV_METRICS.mountedTurns = model.turns.length;
		DEV_METRICS.processEvents = props.processEvents?.length ?? 0;
		DEV_METRICS.processEventsType = Array.isArray(props.processEvents) ? "array" : typeof props.processEvents;
		DEV_METRICS.coverage = props.coverage ?? null;
		DEV_METRICS.processRecords = model.records.filter((record) => record.lane === "process").length;
		(globalThis as { __pideckTrajectoryMetrics?: Record<string, unknown> }).__pideckTrajectoryMetrics = DEV_METRICS;
	});
	const requestEarlier = useCallback(() => {
		const now = Date.now();
		if (now - lastExpandRef.current < 200) return;
		lastExpandRef.current = now;
		setTurnCount((current) => current + 3);
	}, []);
	const selected = visible.find((record) => record.id === selectedId) ?? model.records.find((record) => record.id === selectedId);

	const hasInFlight = model.turns.some((turn) => turn.inFlight);
	useEffect(() => {
		if (!hasInFlight) return;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [hasInFlight]);

	useEffect(() => {
		return () => {
			const el = ledgerScrollRef.current;
			if (el) trajectoryLedgerScrollStore.set(props.sessionId, el.scrollTop);
		};
	}, [props.sessionId]);

	useLayoutEffect(() => {
		const el = ledgerScrollRef.current;
		if (!el) return;
		if (scrollRestoredForRef.current === props.sessionId) return;
		if (visible.length === 0) return;
		const saved = trajectoryLedgerScrollStore.get(props.sessionId);
		if (saved !== undefined && saved > 0) {
			el.scrollTop = Math.min(saved, el.scrollHeight);
		}
		scrollRestoredForRef.current = props.sessionId;
	}, [props.sessionId, visible]);

	const drawer = props.variant === "drawer";

	return (
		<div className="flex h-full min-h-0 flex-col bg-background" data-session-view="trajectory">
			<div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3 py-1.5">
				<div className="flex min-w-0 items-center gap-2 text-caption text-muted-foreground">
					<Activity size={14} aria-hidden="true" />
					<span>{t("session.trajectory.turns", { count: dialogueTurns })}</span>
					<span aria-hidden="true">·</span>
					<span>{t("session.trajectory.records", { count: visible.length })}</span>
					<button type="button" className="rounded-sm px-1.5 text-caption text-primary hover:underline" onClick={toggleAllTurns}>
						{allFolded ? t("session.trajectory.unfoldAll") : t("session.trajectory.foldAll")}
					</button>
					{range ? (
						<button type="button" className="rounded-sm px-1.5 text-caption text-primary hover:underline" onClick={() => setRange(undefined)}>
							{t("session.trajectory.clearRange")}
						</button>
					) : null}
				</div>
				{props.hasMoreMessages ? (
					<button type="button" className="inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 text-caption text-muted-foreground hover:text-foreground" disabled={props.isLoadingMoreMessages} onClick={props.onLoadMore}>
						{props.isLoadingMoreMessages ? <Loader2 size={11} className="animate-pideck-spin" aria-hidden="true" /> : null}
						{props.isLoadingMoreMessages ? t("session.trajectory.loadingOlder") : t("session.trajectory.loadOlder")}
					</button>
				) : null}
			</div>
			<TrajectoryOverview records={model.records} domainStart={model.domainStart} domainEnd={model.domainEnd} range={range} selectedId={selected?.id} onSelect={setSelectedId} onRangeChange={setRange} />
			{props.sourceSession ? (
				<div className="flex shrink-0 items-center gap-1.5 border-b border-border/60 px-3 py-1 text-caption text-muted-foreground">
					<CornerUpLeft size={12} className="shrink-0" aria-hidden="true" />
					<span className="shrink-0">{t("session.trajectory.sourceSession")}</span>
					<button type="button" disabled={!props.onOpenSourceSession} className={`min-w-0 truncate font-medium ${props.onOpenSourceSession ? "text-primary hover:underline" : "cursor-default"}`} onClick={props.onOpenSourceSession} title={props.sourceSession.title}>
						{props.sourceSession.title}
					</button>
				</div>
			) : null}
			<div className={drawer ? "grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(140px,38%)]" : "grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(220px,32%)]"}>
				<TrajectoryLedger
					records={windowed.records}
					turns={model.turns}
					now={now}
					selectedId={selected?.id}
					onSelect={setSelectedId}
					borderBottom={drawer}
					scrollRef={ledgerScrollRef}
					onRequestEarlier={windowed.hasEarlier ? requestEarlier : undefined}
					foldedTurns={foldedTurns}
					expandedGroups={expandedGroups}
					onToggleTurn={toggleTurn}
					onToggleGroup={toggleGroup}
				/>
				<TrajectoryInspector record={selected} runtimeState={runtime?.state} />
			</div>
		</div>
	);
}

function TrajectoryOverview(props: { records: TrajectoryRecord[]; domainStart: number; domainEnd: number; range?: TrajectoryTimeRange; selectedId?: string; onSelect: (id: string) => void; onRangeChange: (range: TrajectoryTimeRange | undefined) => void }) {
	const trackRef = useRef<HTMLDivElement | null>(null);
	const dragRef = useRef<{ x: number; start: number } | undefined>(undefined);
	const [draft, setDraft] = useState<TrajectoryTimeRange | undefined>(undefined);
	const span = Math.max(props.domainEnd - props.domainStart, 1);

	const [trackWidth, setTrackWidth] = useState(600);

	const trackRectRef = useRef<{ left: number; width: number } | null>(null);
	const refreshTrackRect = useCallback(() => {
		const el = trackRef.current;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		trackRectRef.current = { left: rect.left, width: rect.width };
	}, []);
	useLayoutEffect(() => {
		const el = trackRef.current;
		if (!el) return;
		setTrackWidth(el.clientWidth);
		refreshTrackRect();

		const observer = new ResizeObserver(() => {
			setTrackWidth(el.clientWidth);
			refreshTrackRect();
		});
		observer.observe(el);
		return () => observer.disconnect();
	}, [refreshTrackRect]);
	const ticks = useMemo(() => bucketOverviewTicks(props.records, { lanes: LANE_ORDER, width: trackWidth, selectedId: props.selectedId }), [props.records, props.selectedId, trackWidth]);
	useEffect(() => {
		if (import.meta.env.DEV) DEV_METRICS.overviewTicks = ticks.length;
	}, [ticks.length]);

	const timeAt = useCallback(
		(clientX: number): number => {
			const el = trackRef.current;
			if (!el) return props.domainStart;
			const cached = trackRectRef.current ?? el.getBoundingClientRect();
			const ratio = cached.width <= 0 ? 0 : Math.min(1, Math.max(0, (clientX - cached.left) / cached.width));
			return props.domainStart + ratio * span;
		},
		[props.domainStart, span],
	);

	const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) return;
		refreshTrackRect();
		event.currentTarget.setPointerCapture(event.pointerId);
		dragRef.current = { x: event.clientX, start: timeAt(event.clientX) };
		setDraft(undefined);
	};

	const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
		const drag = dragRef.current;
		if (!drag) return;
		if (Math.abs(event.clientX - drag.x) < MIN_DRAG_PX && !draft) return;
		const end = timeAt(event.clientX);
		setDraft({ start: Math.min(drag.start, end), end: Math.max(drag.start, end) });
	};

	const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
		const drag = dragRef.current;
		dragRef.current = undefined;
		if (!drag) return;
		if (Math.abs(event.clientX - drag.x) < MIN_DRAG_PX) {
			setDraft(undefined);
			return;
		}
		const end = timeAt(event.clientX);
		props.onRangeChange({ start: Math.min(drag.start, end), end: Math.max(drag.start, end) });
		setDraft(undefined);
	};

	const onWheel = useCallback(
		(event: WheelEvent) => {
			if (props.records.length === 0) return;
			event.preventDefault();
			const current = props.range ?? { start: props.domainStart, end: props.domainEnd };
			const width = Math.max(current.end - current.start, MIN_ZOOM_SPAN_MS);
			const factor = event.deltaY > 0 ? 1.2 : 0.8;
			const nextWidth = Math.min(span, Math.max(MIN_ZOOM_SPAN_MS, width * factor));
			const anchor = timeAt(event.clientX);
			const leftRatio = (anchor - current.start) / width;
			let start = anchor - nextWidth * leftRatio;
			let end = start + nextWidth;
			if (start < props.domainStart) {
				start = props.domainStart;
				end = start + nextWidth;
			}
			if (end > props.domainEnd) {
				end = props.domainEnd;
				start = end - nextWidth;
			}
			props.onRangeChange({ start, end });
		},
		[props.domainStart, props.domainEnd, props.range, props.records.length, props.onRangeChange, span, timeAt],
	);

	const wheelRef = useRef(onWheel);
	wheelRef.current = onWheel;
	useLayoutEffect(() => {
		const el = trackRef.current;
		if (!el) return;
		const handler = (event: WheelEvent) => wheelRef.current(event);
		el.addEventListener("wheel", handler, { passive: false });
		return () => el.removeEventListener("wheel", handler);
	}, []);

	const highlight = draft ?? props.range;

	const recordsById = useMemo(() => new Map(props.records.map((record) => [record.id, record])), [props.records]);

	return (
		<div className="shrink-0 border-b border-border/60 px-3 py-2">
			<div className="grid grid-cols-[44px_minmax(0,1fr)] gap-x-2">
				<div className="flex h-16 flex-col justify-between py-0.5 text-micro leading-none text-muted-foreground">
					{LANE_ORDER.map((lane) => (
						<span key={lane}>{laneLabel(lane)}</span>
					))}
				</div>
				<div
					ref={trackRef}
					className="relative h-16 cursor-crosshair touch-none rounded-sm bg-muted/40"
					onPointerDown={onPointerDown}
					onPointerMove={onPointerMove}
					onPointerUp={onPointerUp}
					onPointerCancel={() => {
						dragRef.current = undefined;
						setDraft(undefined);
					}}
					onDoubleClick={() => props.onRangeChange(undefined)}
				>
					{highlight ? (
						<div
							className="pointer-events-none absolute inset-y-0 bg-primary/10"
							style={{
								left: `${projectLeft(highlight.start, props.domainStart, span)}%`,
								width: `${projectWidth(highlight.start, highlight.end, props.domainStart, span)}%`,
							}}
						/>
					) : null}
					{LANE_ORDER.map((lane, laneIndex) => (
						<div key={lane} className="pointer-events-none absolute right-0 left-0" style={{ top: `${(laneIndex / LANE_ORDER.length) * 100}%`, height: `${100 / LANE_ORDER.length}%` }}>
							{ticks
								.filter((tick) => tick.lane === lane)
								.map((tick) => {
									const record = recordsById.get(tick.recordId);
									return (
										<button
											key={`${tick.lane}:${tick.recordId}:${tick.startedAt}`}
											type="button"
											title={record ? `${kindLabel(record)}${tick.count > 1 ? ` ×${tick.count}` : ""} · ${record.summary}` : undefined}
											className={`pointer-events-auto absolute top-1/2 h-2 -translate-y-1/2 rounded-sm ${laneTone(lane)} ${tick.selected ? "ring-1 ring-foreground" : ""}`}
											style={{
												left: `${projectLeft(tick.startedAt, props.domainStart, span)}%`,
												width: `${Math.max(0.6, (100 / Math.max(1, props.records.length)) * Math.min(tick.count, 12))}%`,
											}}
											onClick={(event) => {
												event.stopPropagation();
												props.onSelect(tick.recordId);
											}}
										/>
									);
								})}
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

const DEV_METRICS: Record<string, unknown> = {};

function turnDurationLabel(turn: { inFlight: boolean; durationMs?: number; startedAt: number } | undefined, now: number): string | undefined {
	if (!turn) return undefined;
	if (turn.inFlight) {
		const elapsed = Math.max(0, now - turn.startedAt);
		return elapsed > 0 ? formatDuration(elapsed) : t("session.trajectory.inFlight");
	}
	if (turn.durationMs === undefined) return undefined;
	return formatDuration(turn.durationMs);
}

function TrajectoryLedger(props: {
	records: TrajectoryRecord[];
	turns: TrajectoryTurn[];
	now: number;
	selectedId?: string;
	onSelect: (id: string) => void;
	borderBottom?: boolean;

	scrollRef?: RefObject<HTMLDivElement | null>;

	onRequestEarlier?: () => void;

	foldedTurns: Set<number>;
	expandedGroups: Set<string>;
	onToggleTurn: (turn: number) => void;
	onToggleGroup: (key: string) => void;
}) {
	const byTurn = useMemo(() => {
		const map = new Map<number, TrajectoryRecord[]>();
		for (const record of props.records) {
			const bucket = map.get(record.turnIndex);
			if (bucket) bucket.push(record);
			else map.set(record.turnIndex, [record]);
		}
		return map;
	}, [props.records]);

	const row = (record: TrajectoryRecord) => (
		<li key={record.id}>
			<button type="button" className={`flex w-full items-start gap-2 px-3 py-1.5 text-left text-caption hover:bg-muted/50 ${record.id === props.selectedId ? "bg-muted" : ""}`} onClick={() => props.onSelect(record.id)}>
				<span className={`mt-1 size-1.5 shrink-0 rounded-full ${laneTone(record.lane)}`} />
				<span className="w-20 shrink-0 font-medium text-foreground">{kindLabel(record)}</span>
				<span className="min-w-0 flex-1 truncate text-muted-foreground">{record.summary || "—"}</span>
				{usageSummary(record) ? (
					<span className="shrink-0 tabular-nums text-micro text-muted-foreground" title={usageTitle(record)}>
						{usageSummary(record)}
					</span>
				) : null}
				<span className="shrink-0 tabular-nums text-muted-foreground">{rowTimeLabel(record)}</span>
			</button>
		</li>
	);

	return (
		<div
			ref={props.scrollRef}
			className={`min-h-0 overflow-auto ${props.borderBottom ? "border-b border-border/60" : "border-r border-border/60"}`}
			onScroll={(event) => {
				if (event.currentTarget.scrollTop > 48) return;
				props.onRequestEarlier?.();
			}}
		>
			{props.records.length === 0 ? (
				<div className="px-3 py-6 text-center text-caption text-muted-foreground">{t("session.trajectory.empty")}</div>
			) : (
				<ul className="divide-y divide-border/50">
					{[...byTurn.entries()].map(([turnIndex, turnRecords]) => {
						const folded = props.foldedTurns.has(turnIndex);
						const summary = summarizeTurn(props.turns[turnIndex], props.turns[turnIndex]?.records ?? turnRecords);
						const peek = folded ? foldedTurnPeek(turnRecords) : undefined;
						const duration = turnDurationLabel(props.turns[turnIndex], props.now);
						return (
							<li key={`turn:${turnIndex}`}>
								<button type="button" className="flex w-full items-center justify-between gap-2 bg-muted/40 px-3 py-1 text-micro font-medium tracking-wide text-muted-foreground uppercase hover:bg-muted/60" onClick={() => props.onToggleTurn(turnIndex)}>
									<span>{t("session.trajectory.turn", { index: turnIndex + 1 })}</span>
									<span className="flex items-center gap-2 tabular-nums normal-case">
										<span>{t("session.trajectory.turnSteps", { steps: summary.steps, tools: summary.toolCalls })}</span>
										{summary.inputTokens + summary.outputTokens > 0 ? <span>{`${compactTokens(summary.inputTokens)}→${compactTokens(summary.outputTokens)}`}</span> : null}
										{duration ? <span>{duration}</span> : null}
									</span>
								</button>
								<ul className="divide-y divide-border/40">
									{folded
										? peek
											? [row(peek)]
											: []
										: foldTurnRecords(turnRecords).map((item) => {
												if (item.type === "record") return row(item.record);
												if (props.expandedGroups.has(item.key)) return item.records.map(row);
												return (
													<li key={item.key}>
														<button type="button" className="w-full px-3 py-1.5 text-left text-caption text-muted-foreground hover:bg-muted/50" onClick={() => props.onToggleGroup(item.key)}>
															{t("session.trajectory.groupFold", { steps: item.records.length, tools: item.toolCalls })}
														</button>
													</li>
												);
											})}
								</ul>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}

function CopyableBlock(props: { label?: string; text: string }) {
	const [copied, setCopied] = useState(false);
	const onCopy = async () => {
		if (!props.text || copied) return;
		await writeClipboard(props.text);
		setCopied(true);
		window.setTimeout(() => setCopied(false), 1500);
	};
	return (
		<div className="mt-3">
			<div className="mb-1 flex items-center justify-between gap-2">
				{props.label ? <span className="text-micro font-medium tracking-wide text-muted-foreground uppercase">{props.label}</span> : <span />}
				<button
					type="button"
					className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-micro text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					onClick={() => {
						void onCopy();
					}}
					title={t("common.copy")}
				>
					{copied ? <Check size={11} /> : <Copy size={11} />}
					{copied ? t("common.copied") : t("common.copy")}
				</button>
			</div>
			<pre className="max-h-72 overflow-auto rounded-md bg-muted/50 p-2 text-micro leading-relaxed wrap-break-word whitespace-pre-wrap">{props.text}</pre>
		</div>
	);
}

function PromptSnapshotDetail(props: { prompt: SessionPromptSnapshot }) {
	const prompt = props.prompt;
	const changes = [
		[t("session.trajectory.prompt.sectionsAdded"), prompt.sectionsAdded],
		[t("session.trajectory.prompt.sectionsUpdated"), prompt.sectionsUpdated],
		[t("session.trajectory.prompt.sectionsRemoved"), prompt.sectionsRemoved],
		[t("session.trajectory.prompt.toolsAdded"), prompt.toolsAdded],
		[t("session.trajectory.prompt.toolsRemoved"), prompt.toolsRemoved],
	].filter((entry): entry is [string, string[]] => Array.isArray(entry[1]) && entry[1].length > 0);
	return (
		<div className="mt-2 border-t border-border/60 pt-3">
			<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-caption">
				<dt className="text-muted-foreground">{t("session.trajectory.prompt.chars")}</dt>
				<dd className="tabular-nums">{prompt.text.length}</dd>
				<dt className="text-muted-foreground">{t("session.trajectory.prompt.tools")}</dt>
				<dd className="tabular-nums">{prompt.tools.length}</dd>
			</dl>
			{changes.length > 0 ? (
				<ul className="mt-2 space-y-1 text-caption">
					{changes.map(([label, names]) => (
						<li key={label} className="flex gap-1.5">
							<span className="shrink-0 text-muted-foreground">{label}</span>
							<span className="min-w-0 font-mono text-micro wrap-break-word">{names.join(", ")}</span>
						</li>
					))}
				</ul>
			) : null}
			{prompt.tools.length > 0 ? (
				<div className="mt-2">
					<p className="mb-1 text-micro font-medium tracking-wide text-muted-foreground uppercase">{t("session.trajectory.prompt.toolList")}</p>
					<p className="font-mono text-micro leading-relaxed text-muted-foreground wrap-break-word">{prompt.tools.join(", ")}</p>
				</div>
			) : null}
			{prompt.truncated ? <p className="mt-2 text-caption text-amber-600 dark:text-amber-400">{t("session.trajectory.prompt.truncated")}</p> : null}
			<CopyableBlock label={t("session.trajectory.prompt.fullText")} text={prompt.text} />
		</div>
	);
}

function TrajectoryInspector(props: { record?: TrajectoryRecord; runtimeState?: AgentRuntimeState }) {
	const record = props.record;
	const state = props.runtimeState;
	const tpsMode = useAtomValue(tpsDisplayModeAtom);
	const throughput = buildTpsDisplay(tpsMode, state?.tps, state?.endToEndTps, "reply", 1);

	const [traceView, setTraceView] = useState<{ traceId: string; status: "loading" | "loaded" | "missing"; payloadJson?: string } | undefined>(undefined);
	useEffect(() => {
		setTraceView(undefined);
	}, [record?.id]);
	const openTrace = useCallback(() => {
		const target = record?.modelTrace;
		if (!target?.agentId) return;
		setTraceView({ traceId: target.traceId, status: "loading" });
		void desktopApi.rpcLogs
			.getModelTrace({ agentId: target.agentId, traceId: target.traceId })
			.then((result) => {
				setTraceView(result ? { traceId: target.traceId, status: "loaded", payloadJson: result.payloadJson } : { traceId: target.traceId, status: "missing" });
			})
			.catch(() => {
				setTraceView({ traceId: target.traceId, status: "missing" });
			});
	}, [record?.modelTrace]);
	if (!record) {
		return <div className="min-h-0 overflow-auto px-3 py-4 text-caption text-muted-foreground">{t("session.trajectory.inspectHint")}</div>;
	}

	if (record.kind === "modelRequest" && traceView) {
		const summary: ModelTraceLogData | undefined = record.modelTrace
			? {
					kind: "request",
					traceId: record.modelTrace.traceId,
					model: record.modelId,
					provider: record.provider,
					messageCount: record.modelTrace.messageCount,
					toolCount: record.modelTrace.toolCount,
					payloadBytes: record.modelTrace.payloadBytes,
					truncated: record.modelTrace.truncated,
				}
			: undefined;
		return (
			<div className="flex h-full min-h-0 flex-col px-3 py-2">
				<button type="button" className="mb-2 inline-flex w-fit items-center gap-1 rounded-sm px-1.5 py-0.5 text-caption text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => setTraceView(undefined)}>
					<ArrowLeft size={12} />
					{t("session.trajectory.backToRecord")}
				</button>
				<div className="min-h-0 flex-1 overflow-auto">
					{traceView.status === "loading" ? <p className="py-4 text-center text-caption text-muted-foreground">{t("session.trajectory.traceLoading")}</p> : null}
					{traceView.status === "missing" ? <p className="py-4 text-center text-caption text-muted-foreground">{t("session.trajectory.traceMissing")}</p> : null}
					{traceView.status === "loaded" && summary ? <ModelTraceDetail payloadJson={traceView.payloadJson ?? ""} summary={summary} /> : null}
				</div>
			</div>
		);
	}
	return (
		<div className="min-h-0 overflow-auto px-3 py-3">
			<div className="mb-2 flex items-center gap-1.5 text-sm font-medium">
				{record.kind === "tool" ? <Wrench size={14} /> : record.kind === "modelRequest" ? <FileJson size={14} /> : <Hash size={14} />}
				{record.kind === "tool" ? record.toolName : kindLabel(record)}
			</div>
			{record.kind === "systemPrompt" ? <p className="mb-2 text-caption text-muted-foreground">{t("session.trajectory.systemPromptHint")}</p> : null}
			{record.prompt ? <PromptSnapshotDetail prompt={record.prompt} /> : null}
			<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-caption">
				{record.startedAt > 0 ? (
					<>
						<dt className="text-muted-foreground">{t("session.trajectory.field.time")}</dt>
						<dd className="tabular-nums">
							{formatTime(record.startedAt)} · {formatClock(record.startedAt)}
						</dd>
					</>
				) : null}
				<dt className="text-muted-foreground">{t("session.trajectory.field.duration")}</dt>
				<dd className="tabular-nums">{durationLabel(record)}</dd>
				{record.status && record.kind !== "process" ? (
					<>
						<dt className="text-muted-foreground">{t("session.trajectory.field.status")}</dt>
						<dd>{record.status}</dd>
					</>
				) : null}
				{record.toolCallId ? (
					<>
						<dt className="text-muted-foreground">{t("session.trajectory.field.callId")}</dt>
						<dd className="truncate font-mono text-micro">{record.toolCallId}</dd>
					</>
				) : null}
				{record.cwd ? (
					<>
						<dt className="text-muted-foreground">{t("session.trajectory.field.cwd")}</dt>
						<dd className="truncate font-mono text-micro">{record.cwd}</dd>
					</>
				) : null}
				{record.provider || record.modelId ? (
					<>
						<dt className="text-muted-foreground">{t("session.trajectory.field.model")}</dt>
						<dd className="truncate">{[record.provider, record.modelId].filter(Boolean).join("/")}</dd>
					</>
				) : null}
				{record.thinkingLevel ? (
					<>
						<dt className="text-muted-foreground">{t("session.trajectory.field.thinkingLevel")}</dt>
						<dd>{record.thinkingLevel}</dd>
					</>
				) : null}
				{record.usage ? (
					<>
						<dt className="text-muted-foreground">{t("session.trajectory.field.inputTokens")}</dt>
						<dd className="tabular-nums">{record.usage.inputTokens}</dd>
						<dt className="text-muted-foreground">{t("session.trajectory.field.outputTokens")}</dt>
						<dd className="tabular-nums">{record.usage.outputTokens}</dd>
						{record.usage.reasoningTokens !== undefined ? (
							<>
								<dt className="text-muted-foreground">{t("session.trajectory.field.reasoningTokens")}</dt>
								<dd className="tabular-nums">{record.usage.reasoningTokens}</dd>
							</>
						) : null}
						{record.usage.cacheReadTokens !== undefined ? (
							<>
								<dt className="text-muted-foreground">{t("session.trajectory.field.cacheRead")}</dt>
								<dd className="tabular-nums">{record.usage.cacheReadTokens}</dd>
							</>
						) : null}
						{record.usage.cacheWriteTokens !== undefined ? (
							<>
								<dt className="text-muted-foreground">{t("session.trajectory.field.cacheWrite")}</dt>
								<dd className="tabular-nums">{record.usage.cacheWriteTokens}</dd>
							</>
						) : null}
					</>
				) : null}
				{record.modelTrace ? (
					<>
						{record.modelTrace.messageCount !== undefined ? (
							<>
								<dt className="text-muted-foreground">{t("session.trajectory.field.traceMessages")}</dt>
								<dd className="tabular-nums">{record.modelTrace.messageCount}</dd>
							</>
						) : null}
						{record.modelTrace.toolCount !== undefined ? (
							<>
								<dt className="text-muted-foreground">{t("session.trajectory.field.traceTools")}</dt>
								<dd className="tabular-nums">{record.modelTrace.toolCount}</dd>
							</>
						) : null}
						{record.modelTrace.payloadBytes !== undefined ? (
							<>
								<dt className="text-muted-foreground">{t("session.trajectory.field.traceSize")}</dt>
								<dd className="tabular-nums">{traceSizeLabel(record.modelTrace.payloadBytes) || "—"}</dd>
							</>
						) : null}
						{record.modelTrace.truncated ? (
							<>
								<dt className="text-muted-foreground">{t("session.trajectory.field.traceTruncated")}</dt>
								<dd>{t("session.trajectory.traceTruncatedYes")}</dd>
							</>
						) : null}
					</>
				) : null}
				{record.customType ? (
					<>
						<dt className="text-muted-foreground">{t("session.trajectory.field.customType")}</dt>
						<dd className="truncate font-mono text-micro">{record.customType}</dd>
					</>
				) : null}
				{record.retry !== undefined ? (
					<>
						<dt className="text-muted-foreground">{t("session.trajectory.field.retry")}</dt>
						<dd className="tabular-nums">{record.maxRetries !== undefined ? `${record.retry}/${record.maxRetries}` : record.retry}</dd>
					</>
				) : null}
				{record.retryDelayMs !== undefined ? (
					<>
						<dt className="text-muted-foreground">{t("session.trajectory.field.retryDelay")}</dt>
						<dd className="tabular-nums">{formatDuration(record.retryDelayMs)}</dd>
					</>
				) : null}
			</dl>
			{record.inputDetail ? <CopyableBlock label={t("session.trajectory.field.payload")} text={record.inputDetail} /> : null}
			{record.outputDetail ? <CopyableBlock label={t("session.trajectory.field.result")} text={record.outputDetail} /> : null}{" "}
			{record.kind === "modelRequest" && record.modelTrace?.agentId ? (
				<button type="button" className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border/70 px-2 py-1.5 text-caption hover:bg-muted" onClick={openTrace}>
					<FileJson size={13} />
					{t("session.trajectory.viewFullRequest")}
				</button>
			) : null}
			{!record.prompt && !record.inputDetail && !record.outputDetail && (record.detail || record.text) ? <CopyableBlock text={record.detail || record.text || ""} /> : null}
			{state && (state.ttftMs !== undefined || state.inputTokens !== undefined || state.totalMs !== undefined) ? (
				<div className="mt-4 border-t border-border/60 pt-3">
					<div className="mb-1 flex items-center gap-1 text-caption font-medium">
						<Clock size={12} />
						{t("session.trajectory.runtime")}
					</div>
					<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-caption text-muted-foreground">
						{state.ttftMs !== undefined ? (
							<>
								<dt>TTFT</dt>
								<dd className="tabular-nums">{formatDuration(state.ttftMs)}</dd>
							</>
						) : null}
						{state.totalMs !== undefined ? (
							<>
								<dt>{t("session.trajectory.field.total")}</dt>
								<dd className="tabular-nums">{formatDuration(state.totalMs)}</dd>
							</>
						) : null}
						{state.tps !== undefined || state.endToEndTps !== undefined || state.totalMs !== undefined ? (
							<>
								<dt title={throughput.hint}>{throughput.label}</dt>
								<dd className="tabular-nums">{throughput.value}</dd>
							</>
						) : null}
						{state.inputTokens !== undefined ? (
							<>
								<dt>{t("session.trajectory.field.inputTokens")}</dt>
								<dd className="tabular-nums">{state.inputTokens}</dd>
							</>
						) : null}
						{state.outputTokens !== undefined ? (
							<>
								<dt>{t("session.trajectory.field.outputTokens")}</dt>
								<dd className="tabular-nums">{state.outputTokens}</dd>
							</>
						) : null}
						{state.cacheRead !== undefined ? (
							<>
								<dt>{t("session.trajectory.field.cacheRead")}</dt>
								<dd className="tabular-nums">{state.cacheRead}</dd>
							</>
						) : null}
					</dl>
				</div>
			) : null}
		</div>
	);
}
