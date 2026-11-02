import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentBackend, AvailableModel, ModelListReport } from "../../../shared/types";
import { desktopApi } from "../desktopApi";
import { t } from "../i18n";
import { showNotice } from "../utils/notice";

const EMPTY_MODELS: AvailableModel[] = [];

/** Accepted reports retain their source so a new scope cannot reuse their success flag. */
type CatalogResult = {
	backend?: AgentBackend;
	projectId?: string;
	report: ModelListReport;
};

export function useBackendModelCatalog(options: { sessionId: string; backend?: AgentBackend; projectId?: string; enabled: boolean }): {
	models: AvailableModel[];
	report: ModelListReport | null;
	/** 首次加载在途（手动刷新走 refreshing，两者互斥展示） */
	loading: boolean;
	/** 手动刷新进行中（选择器刷新按钮转圈用） */
	refreshing: boolean;
	/** 重新加载；传 true 绕过缓存强制重新 fork（手动刷新） */
	reload: (force?: boolean) => void;
} {
	const [catalog, setCatalog] = useState<CatalogResult | null>(null);
	const [loading, setLoading] = useState(false);
	const [refreshing, setRefreshing] = useState(false);
	const sequenceRef = useRef(0);

	const load = useCallback(
		(force = false) => {
			if (!options.enabled) return;
			const sequence = ++sequenceRef.current;
			setRefreshing(force);
			setLoading(!force);
			const loader = desktopApi.projects.listModelsReport(options.projectId, force);
			void loader
				.then((next) => {
					if (sequence !== sequenceRef.current) return;
					setCatalog({ backend: options.backend, projectId: options.projectId, report: next });
					setLoading(false);
					setRefreshing(false);
				})
				.catch((error) => {
					if (sequence !== sequenceRef.current) return;

					const rawDetail = error instanceof Error ? error.message : String(error);
					setCatalog({
						backend: options.backend,
						projectId: options.projectId,
						report: { models: [], ok: false, reason: "cli-failed", version: null, detail: rawDetail, source: "none", at: Date.now() },
					});
					setLoading(false);
					setRefreshing(false);
					showNotice(rawDetail, 4000);
				});
		},
		[options.enabled, options.backend, options.projectId],
	);

	useEffect(() => {
		if (options.enabled) load();
		else {
			setLoading(false);
			setRefreshing(false);
		}
		return () => {
			// Closing, switching source or unmounting must retire even a manual refresh.
			// The IPC may still finish, but its result and error notice no longer belong here.
			sequenceRef.current++;
		};
	}, [load, options.enabled]);

	// Filter during render, not in an effect: consumers use report.ok to invalidate
	// welcome preferences, so even the first render must reject another source's data.
	const report = catalog?.backend === options.backend && catalog?.projectId === options.projectId ? (catalog?.report ?? null) : null;
	return { models: report?.models ?? EMPTY_MODELS, report, loading: options.enabled && loading, refreshing: options.enabled && refreshing, reload: load };
}
