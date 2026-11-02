import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { BusySendDelivery } from "../../../shared/busySendDelivery";
import type { AgentBackend } from "../../../shared/types";
import { APP_DISPLAY_NAME_DEFAULT, type LogoStyle } from "../../../shared/types/settings";
import type { QuickMessagesSnapshot } from "../../../shared/types/quickMessages";
import type { ReplyActionsSnapshot } from "../../../shared/types/replyActions";
import { isModuleHidden } from "../../../shared/hiddenModules";
import type { SettingsFieldAnchorSlug } from "../utils/settingsFieldAnchors";
import { defaultExpandedSidebarProjects, readExpandedSidebarProjects } from "../utils/sidebarExpandedProjects";
import { DEFAULT_SIDEBAR_NAV_TAB, readSidebarNavTab, type SidebarNavTab } from "../utils/sidebarNavTab";

export const settingsOpenAtom = atom(false);

export const logoStyleAtom = atom<LogoStyle>("classic");

export const customLogoAtom = atom<string>("");

export const appDisplayNameAtom = atom<string>(APP_DISPLAY_NAME_DEFAULT);

export const activeEditorFileAtom = atom<string | null>(null);

export type SettingsTabId = "common" | "shortcuts" | "appearance" | "terminal" | "proxy" | "web" | "editors" | "git" | "dev" | "im" | "pet" | "notification" | "storage" | "backup" | "usage" | "process" | "vision" | "imagegen" | "videogen" | "acp" | "hostplugins";

export type SettingsSectionId = "git" | "dev-pi-rpc" | SettingsFieldAnchorSlug;

export type SettingsPaneId = "settings" | "config";

export type SettingsFocusTarget = {
	tab: SettingsTabId;
	section?: SettingsSectionId;

	pane?: "config";

	configTab?: "models" | "auth" | "settings" | "trust" | "mcp" | "raw";

	provider?: string;
};

export const settingsFocusAtom = atom<SettingsFocusTarget | null>(null);

export const openSettingsAtom = atom(null, (_get, set, target?: SettingsFocusTarget) => {
	set(settingsFocusAtom, target ?? null);
	set(settingsOpenAtom, true);
});

export const defaultAgentBackendAtom = atom<AgentBackend>("pi");

export const hiddenModulesAtom = atom<readonly string[]>([]);

export const imageGenModuleHiddenAtom = atom((get) => isModuleHidden(get(hiddenModulesAtom), "imagegen"));

export const videoGenModuleHiddenAtom = atom((get) => isModuleHidden(get(hiddenModulesAtom), "videogen"));

export const hiddenComposerFeaturesAtom = atom<readonly string[]>([]);

export const respondingTipsHiddenAtom = atom((get) => isModuleHidden(get(hiddenModulesAtom), "respondingTips"));

export const automationModuleHiddenAtom = atom((get) => isModuleHidden(get(hiddenModulesAtom), "automation"));

export const agentsModuleHiddenAtom = atom((get) => isModuleHidden(get(hiddenModulesAtom), "agents"));

export const favoritesModuleHiddenAtom = atom((get) => isModuleHidden(get(hiddenModulesAtom), "favorites"));

export const scrollToLatestOnSendAtom = atom(true);

export const busySendDeliveryAtom = atom<BusySendDelivery>("steer");

export const quickMessagesSnapshotAtom = atom<QuickMessagesSnapshot | null>(null);

export const replyActionsSnapshotAtom = atom<ReplyActionsSnapshot | null>(null);

export const sidebarNavTabAtom = atom<SidebarNavTab>(readSidebarNavTab(typeof window === "undefined" ? undefined : window.localStorage) ?? DEFAULT_SIDEBAR_NAV_TAB);

export type TurnFlowSettings = {
	expandInterimDuringStream: boolean;

	processGroupDisplay: boolean;
};

export const turnFlowSettingsAtom = atom<TurnFlowSettings>({
	expandInterimDuringStream: true,
	processGroupDisplay: true,
});

export const effectiveAgentBackendAtom = atom<AgentBackend>((get) => get(defaultAgentBackendAtom));

export const compactMiddlePackagesAtom = atomWithStorage<boolean>("pi-desktop:compact-middle-packages", true);

export const sidebarExpandedProjectIdsAtom = atom<ReadonlySet<string>>(new Set<string>());
