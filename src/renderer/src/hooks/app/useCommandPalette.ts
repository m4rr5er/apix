import { useCallback, useEffect, useState } from "react";
import { useAtomValue, useStore } from "jotai";
import { Bot, CircleStop, Clock, Fingerprint, Puzzle, RefreshCw, RotateCw, Settings2, SquarePen, Star, Wrench } from "lucide-react";
import { buildSettingsCommands, type PaletteCommand } from "../../utils/commandPaletteCommands";
import { markCommandPaletteOnboardingSeen } from "../../components/overlays/CommandPaletteOnboarding";
import { openSettingsAtom } from "../../atoms/app-ui-atoms";
import { hostPluginCatalogAtom, hostPluginPanelAtom } from "../../atoms/host-plugin-atoms";
import { isModuleHidden } from "../../../../shared/hiddenModules";
import { copyTextWithCopiedNotice } from "../../utils/clipboardNotice";
import { desktopApi as api } from "../../desktopApi";
import { t } from "../../i18n";

export interface CommandPaletteActions {
	selectProjectCommand: (projectId: string) => void;
	restartActiveAgent: (agentId?: string) => Promise<void> | void;
	closeAgent: (agentId: string) => Promise<void> | void;
	runSessionControl: (sessionId: string, action: "reload") => Promise<void> | void;

	openAutomationPage: () => void;

	openAgentMarketPage: () => void;

	openFavoritesPage: () => void;

	openEnvironmentGuide: (options?: { previewSetup?: boolean }) => void;
}

export function useCommandPalette({ activeProjectId, currentSessionId, activeAgentId, hiddenModules, actions }: { activeProjectId: string | undefined; currentSessionId: string | undefined; activeAgentId: string | undefined; hiddenModules: string[]; actions: CommandPaletteActions }) {
	const store = useStore();
	const { catalog: pluginCatalog } = useAtomValue(hostPluginCatalogAtom);
	const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

	const openCommandPalette = useCallback(() => {
		markCommandPaletteOnboardingSeen();
		setCommandPaletteOpen(true);
	}, []);

	useEffect(() => {
		return api.app.onShortcutTriggered((id) => {
			if (id !== "openCommandPalette") return;
			const target = document.activeElement;
			if (target instanceof HTMLElement && (target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
				return;
			}
			openCommandPalette();
		});
	}, [openCommandPalette]);

	const commandPaletteCommands: PaletteCommand[] = (() => {
		const commands: PaletteCommand[] = [];
		const actionGroup = t("command.groupActions");

		commands.push({
			id: "action:new-session",
			group: actionGroup,
			title: t("command.actionNewSession"),
			keywords: ["new", "新建", "会话", "session", "chat", "创建"],
			icon: SquarePen,
			run: () => {
				if (activeProjectId) actions.selectProjectCommand(activeProjectId);
			},
		});

		commands.push({
			id: "action:open-settings",
			group: actionGroup,
			title: t("command.actionOpenSettings"),
			keywords: ["settings", "设置", "偏好", "preferences", "配置"],
			icon: Settings2,
			run: () => store.set(openSettingsAtom, { tab: "common" }),
		});

		commands.push({
			id: "action:pi-environment-guide",
			group: actionGroup,
			title: t("command.actionPiEnvironment"),
			keywords: ["pi", "环境", "检测", "安装", "install", "environment", "node", "npm"],
			icon: Wrench,
			run: () => actions.openEnvironmentGuide(),
		});

		if (import.meta.env.DEV) {
			commands.push({
				id: "action:pi-environment-guide-preview",
				group: actionGroup,
				title: t("command.actionPiEnvironmentPreview"),
				keywords: ["pi", "预览", "preview", "安装引导", "环境检测"],
				icon: Wrench,
				run: () => actions.openEnvironmentGuide({ previewSetup: true }),
			});
		}

		commands.push({
			id: "action:open-automation",
			group: actionGroup,
			title: t("command.actionOpenAutomation"),
			subtitle: isModuleHidden(hiddenModules, "automation") ? t("command.openHiddenPageHint") : undefined,
			keywords: ["定时任务", "自动化", "automation", "cron", "schedule", "任务计划"],
			icon: Clock,
			run: () => actions.openAutomationPage(),
		});
		commands.push({
			id: "action:open-agents",
			group: actionGroup,
			title: t("command.actionOpenAgents"),
			subtitle: isModuleHidden(hiddenModules, "agents") ? t("command.openHiddenPageHint") : undefined,
			keywords: ["智能体", "agent", "agents", "角色", "agent market"],
			icon: Bot,
			run: () => actions.openAgentMarketPage(),
		});
		commands.push({
			id: "action:open-favorites",
			group: actionGroup,
			title: t("command.actionOpenFavorites"),
			subtitle: isModuleHidden(hiddenModules, "favorites") ? t("command.openHiddenPageHint") : undefined,
			keywords: ["收藏", "favorite", "favorites", "bookmark", "收藏夹", "快照"],
			icon: Star,
			run: () => actions.openFavoritesPage(),
		});

		if (currentSessionId) {
			commands.push({
				id: "action:restart-agent",
				group: actionGroup,
				title: t("command.actionRestartAgent"),
				subtitle: t("command.actionRestartAgentDesc"),
				keywords: ["restart", "重启", "重开", "agent", "进程", "重新启动"],
				icon: RotateCw,
				run: () => void actions.restartActiveAgent(activeAgentId),
			});
			commands.push({
				id: "action:stop-agent",
				group: actionGroup,
				title: t("command.actionStopAgent"),
				subtitle: t("command.actionStopAgentDesc"),
				keywords: ["stop", "停止", "关闭", "agent", "进程", "结束"],
				icon: CircleStop,
				run: () => {
					if (activeAgentId) void actions.closeAgent(activeAgentId);
				},
			});
			commands.push({
				id: "action:reload-session",
				group: actionGroup,
				title: t("command.actionReloadSession"),
				subtitle: t("command.actionReloadSessionDesc"),
				keywords: ["reload", "重载", "重新加载", "刷新", "session"],
				icon: RefreshCw,
				run: () => void actions.runSessionControl(currentSessionId, "reload"),
			});
		}

		if (activeAgentId) {
			commands.push({
				id: "action:copy-agent-id",
				group: actionGroup,
				title: t("command.actionCopyAgentId"),
				subtitle: activeAgentId,
				keywords: ["copy", "复制", "agent", "id", "标识"],
				icon: Fingerprint,
				run: () => void copyTextWithCopiedNotice(activeAgentId),
			});
		}

		for (const plugin of pluginCatalog?.plugins ?? []) {
			if (!plugin.enabled) continue;
			for (const command of plugin.manifest.contributes.commands)
				commands.push({
					id: `host-plugin:${plugin.manifest.id}:${command.id}`,
					group: t("hostPlugins.title"),
					title: command.title,
					subtitle: plugin.manifest.name,
					keywords: [plugin.manifest.id, plugin.manifest.name],
					icon: Puzzle,
					run: () => store.set(hostPluginPanelAtom, { pluginId: plugin.manifest.id, panelId: command.panelId }),
				});
		}
		commands.push(...buildSettingsCommands((target) => store.set(openSettingsAtom, target), hiddenModules));
		return commands;
	})();

	return { commandPaletteOpen, setCommandPaletteOpen, openCommandPalette, commandPaletteCommands };
}
