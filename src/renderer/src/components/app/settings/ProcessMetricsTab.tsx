import { Loader2, Activity, CircleStop, Info, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { AgentProcessMetric, ProcessMetricsSnapshot } from "../../../../../shared/types";
import { formatMb } from "../../../../../shared/formatBytes";
import { t } from "../../../i18n";
import { Button } from "../../ui-shadcn/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../ui-shadcn/table";
import { showNotice } from "../../../utils/notice";
import { ConfirmDialog } from "../../ui-shadcn/ConfirmDialog";

export function ProcessMetricsTab() {
	const [snapshot, setSnapshot] = useState<ProcessMetricsSnapshot | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const [stoppingAgent, setStoppingAgent] = useState<AgentProcessMetric | null>(null);

	const refresh = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const data = await window.piDesktop.system.getProcessMetrics();
			setSnapshot(data);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const stopAgent = useCallback(
		async (agent: AgentProcessMetric) => {
			const label = monitorRowLabel(agent);
			try {
				await window.piDesktop.system.stopAgent(agent.agentId);
				showNotice(t("config.process.stopped", { agent: label }), 2000, "info");
				await refresh();
			} catch (error) {
				showNotice(t("config.process.stopFailed", { agent: label }) + (error instanceof Error ? `：${error.message}` : ""), 4000, "error");
			}
		},
		[refresh],
	);

	const agents = snapshot?.agents ?? [];
	const agentTotal = snapshot?.totalAgentBytes ?? 0;

	return (
		<div className="flex min-h-0 flex-col gap-3">
			<div className="flex items-center justify-end gap-2">
				<Button type="button" variant="secondary" size="sm" onClick={() => void refresh()} disabled={loading}>
					<RefreshCw className={`size-3.5${loading ? " animate-pideck-spin" : ""}`} aria-hidden="true" />
					{t("config.process.refresh")}
				</Button>
			</div>

			{error ? (
				<div className="rounded-lg border border-border-subtle bg-bg-panel p-4 text-control text-text-tertiary">
					{t("config.process.loadFailed")}：{error}
				</div>
			) : null}

			{snapshot ? (
				<>
					<div className="grid grid-cols-2 gap-3">
						<div className="rounded-lg border border-border-subtle bg-bg-panel p-3">
							<div className="text-micro text-muted-foreground">{t("config.process.agentCount")}</div>
							<div className="mt-1 text-base font-semibold text-foreground">{agents.length}</div>
						</div>
						<div className="rounded-lg border border-border-subtle bg-bg-panel p-3">
							<div className="text-micro text-muted-foreground">{t("config.process.agentTotal")}</div>
							<div className="mt-1 text-base font-semibold text-foreground">{formatMb(agentTotal)}</div>
						</div>
					</div>

					<div className="flex items-start gap-1.5 text-micro text-muted-foreground">
						<Info className="mt-px size-3 shrink-0" aria-hidden="true" />
						<span>{t("config.process.memoryHint")}</span>
					</div>

					<div className="overflow-hidden rounded-lg border border-border-subtle bg-bg-panel">
						<div className="flex items-center gap-1.5 border-b border-border-subtle px-3 py-2">
							<Activity className="size-3.5 text-muted-foreground" aria-hidden="true" />
							<span className="text-sm font-medium text-foreground">{t("config.process.section")}</span>
							<span className="ml-auto text-micro text-muted-foreground">
								{t("config.process.sampledAt")}：{new Date(snapshot.sampledAt).toLocaleTimeString()}
							</span>
						</div>
						{agents.length === 0 ? (
							<div className="px-3 py-4 text-center text-control text-text-tertiary">{t("config.process.empty")}</div>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>{t("config.process.column.agentId")}</TableHead>
										<TableHead>{t("config.process.column.session")}</TableHead>
										<TableHead>PID</TableHead>
										<TableHead>{t("config.process.column.memory")}</TableHead>
										<TableHead className="text-center">{t("config.process.column.action")}</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{agents.map((agent) => (
										<TableRow key={`${agent.kind ?? "pi"}:${agent.pid}`}>
											<TableCell className="max-w-56 truncate font-medium" title={monitorRowLabel(agent)}>
												{monitorRowLabel(agent)}
											</TableCell>
											<TableCell className="max-w-56 truncate text-text-secondary" title={agent.sessionTitle ?? agent.sessionId}>
												{sessionColumnLabel(agent)}
											</TableCell>
											<TableCell className="font-mono text-text-secondary">{agent.pid}</TableCell>
											<TableCell className="font-mono text-text-secondary">{agent.memoryBytes == null ? "-" : formatMb(agent.memoryBytes)}</TableCell>

											<TableCell className="text-center">
												<Button
													type="button"
													variant="ghost"
													size="sm"
													className="gap-1 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
													title={t("config.process.stop", { agent: monitorRowLabel(agent) })}
													aria-label={t("config.process.stop", { agent: monitorRowLabel(agent) })}
													onClick={() => setStoppingAgent(agent)}
												>
													<CircleStop className="size-4" aria-hidden="true" />
													{t("config.process.stop")}
												</Button>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						)}
					</div>
				</>
			) : (
				<div className="flex items-center justify-center gap-2 py-12 text-control text-text-tertiary">
					<Loader2 size={14} className="animate-pideck-spin" aria-hidden="true" />
					{t("common.loading")}
				</div>
			)}

			{stoppingAgent ? (
				<ConfirmDialog
					title={t("config.process.stop")}
					message={t("config.process.stopConfirm", { agent: monitorRowLabel(stoppingAgent) })}
					confirmLabel={t("config.process.stop")}
					danger
					onConfirm={() => {
						const agent = stoppingAgent;
						setStoppingAgent(null);
						void stopAgent(agent);
					}}
					onCancel={() => setStoppingAgent(null)}
				/>
			) : null}
		</div>
	);
}

function monitorRowLabel(agent: AgentProcessMetric): string {
	return agent.agentId;
}

function sessionColumnLabel(agent: AgentProcessMetric): string {
	return agent.sessionTitle?.trim() || agent.sessionId || "-";
}
