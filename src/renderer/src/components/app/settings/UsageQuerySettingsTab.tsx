import { useCallback, useEffect, useState } from "react";
import { useSetAtom } from "jotai";
import { RefreshCw } from "lucide-react";
import type { AppSettings } from "../../../../../shared/types/settings";
import type { UsageQueryProviderId, UsageQueryProviderStatus } from "../../../../../shared/types/usageQuery";
import { openSettingsAtom } from "../../../atoms/app-ui-atoms";
import { desktopApi } from "../../../desktopApi";
import { t } from "../../../i18n";
import { Button } from "../../ui-shadcn/button";
import { Switch } from "../../ui-shadcn/switch";
import { SettingRow } from "./SettingRows";
import { SettingsSection } from "./SettingsStorageTab";

type Props = {
	draft: AppSettings;
	updateDraft: (patch: Partial<AppSettings>) => void;
};

/**
 * 系统设置 → 用量查询。
 *
 * 只管理「是否把某个供应商的用量显示到左下角」，供应商本身的凭据/登录仍在配置管理里：
 * - aibvv：要求 models.json 里的 provider 已配置 API Key（用户先去配置管理手动登录/填写）；
 * - qoder：要求 auth.json 里已有 Qoder Provider 登录凭据，配置好后只需打开开关。
 *
 * 状态由主进程只读探测（不发供应商请求），避免设置页一打开就触发两次网络查询。
 */
export function UsageQuerySettingsTab({ draft, updateDraft }: Props) {
	const openSettings = useSetAtom(openSettingsAtom);
	const [status, setStatus] = useState<UsageQueryProviderStatus | null>(null);
	const [checking, setChecking] = useState(false);
	const enabled = new Set(draft.usageQueryProviders ?? []);

	const refreshStatus = useCallback(async () => {
		setChecking(true);
		try {
			setStatus(await desktopApi.usageQuery.status());
		} catch {
			setStatus({ aibvv: false, qoder: false });
		} finally {
			setChecking(false);
		}
	}, []);

	useEffect(() => {
		void refreshStatus();
		// 用户从配置管理返回时窗口重新获得焦点；顺手复检一次，避免状态停在旧值。
		const onFocus = () => void refreshStatus();
		window.addEventListener("focus", onFocus);
		return () => window.removeEventListener("focus", onFocus);
	}, [refreshStatus]);

	const toggle = (id: UsageQueryProviderId, checked: boolean) => {
		const next = checked ? [...new Set([...(draft.usageQueryProviders ?? []), id])] : (draft.usageQueryProviders ?? []).filter((item) => item !== id);
		updateDraft({ usageQueryProviders: next });
	};

	const openConfig = (provider: "AI-AAA" | "qoder") => {
		// 当前设置窗口已打开：深链只切换顶层分区，不另开一个设置弹窗。
		openSettings({ pane: "config", tab: "common", configTab: "models", provider });
	};

	return (
		<div className="config-settings-tab">
			<SettingsSection title={t("settings.usageQuery.title")} description={t("settings.usageQuery.description")}>
				<SettingRow
					anchor="usage-query-aibvv"
					title={
						<span className="inline-flex items-center gap-2">
							{t("settings.usageQuery.aibvv")}
							<span className={status?.aibvv ? "text-success" : "text-muted-foreground"}>{status?.aibvv ? t("settings.usageQuery.configured") : t("settings.usageQuery.notConfigured")}</span>
						</span>
					}
					description={
						<span>
							{t("settings.usageQuery.aibvvHint")}
							{!status?.aibvv && <span className="ml-1 text-warning">{t("settings.usageQuery.notConfiguredHint")}</span>}
						</span>
					}
				>
					<div className="flex items-center gap-2">
						<Button type="button" variant="outline" size="sm" onClick={() => openConfig("AI-AAA")}>
							{t("settings.usageQuery.configure")}
						</Button>
						<Switch checked={enabled.has("aibvv")} disabled={!status?.aibvv && !enabled.has("aibvv")} onCheckedChange={(checked) => toggle("aibvv", checked)} aria-label={t("settings.usageQuery.enable")} />
					</div>
				</SettingRow>
				<SettingRow
					anchor="usage-query-qoder"
					title={
						<span className="inline-flex items-center gap-2">
							{t("settings.usageQuery.qoder")}
							<span className={status?.qoder ? "text-success" : "text-muted-foreground"}>{status?.qoder ? t("settings.usageQuery.configured") : t("settings.usageQuery.notConfigured")}</span>
						</span>
					}
					description={
						<span>
							{t("settings.usageQuery.qoderHint")}
							{!status?.qoder && <span className="ml-1 text-warning">{t("settings.usageQuery.notConfiguredHint")}</span>}
						</span>
					}
				>
					<div className="flex items-center gap-2">
						<Button type="button" variant="outline" size="sm" onClick={() => openConfig("qoder")}>
							{t("settings.usageQuery.configure")}
						</Button>
						<Switch checked={enabled.has("qoder")} disabled={!status?.qoder && !enabled.has("qoder")} onCheckedChange={(checked) => toggle("qoder", checked)} aria-label={t("settings.usageQuery.enable")} />
					</div>
				</SettingRow>
				<div className="flex items-center justify-between gap-3 border-t border-border-subtle/60 px-1 py-2">
					<small className="text-caption leading-relaxed text-muted-foreground">{t("settings.usageQuery.footer")}</small>
					<Button type="button" variant="ghost" size="sm" className="shrink-0 gap-1.5" disabled={checking} onClick={() => void refreshStatus()}>
						<RefreshCw className={checking ? "size-3.5 animate-pideck-spin" : "size-3.5"} aria-hidden="true" />
						{checking ? t("settings.usageQuery.refreshing") : t("settings.usageQuery.refresh")}
					</Button>
				</div>
			</SettingsSection>
		</div>
	);
}
