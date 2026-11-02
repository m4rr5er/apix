import { useEffect } from "react";
import { useAtom } from "jotai";
import { settingsFocusAtom, type SettingsTabId } from "../../../atoms";

/** 高亮 class（样式见 styles/surfaces.css）：跳转后短暂描边，指明落点。 */
const ANCHOR_FLASH_CLASS = "settings-anchor-flash";
const ANCHOR_FLASH_MS = 1600;

/**
 * 给跳转落点加一次短暂高亮。
 *
 * 先摘 class 再强制 reflow：同一个锚点连续被跳转两次时（例如反复从命令面板选同一项），
 * 浏览器不会重放同名动画，看起来像「第二次没反应」。
 */
function flashAnchor(el: HTMLElement): void {
	el.classList.remove(ANCHOR_FLASH_CLASS);
	// 读一次布局属性触发样式重算，使下一帧新加的 class 能重新起动画
	void el.offsetWidth;
	el.classList.add(ANCHOR_FLASH_CLASS);
	window.setTimeout(() => el.classList.remove(ANCHOR_FLASH_CLASS), ANCHOR_FLASH_MS);
}

export function useSettingsFocus(activeTab: SettingsTabId, setActiveTab: (tab: SettingsTabId) => void, persistTab: (tab: SettingsTabId) => void): void {
	const [focusTarget, setFocusTarget] = useAtom(settingsFocusAtom);

	useEffect(() => {
		if (!focusTarget) return;
		if (activeTab !== focusTarget.tab) {
			setActiveTab(focusTarget.tab);
			persistTab(focusTarget.tab);
			return;
		}
		const section = focusTarget.section;
		if (!section) {
			setFocusTarget(null);
			return;
		}
		const elementId = `settings-section-${section}`;
		let cancelled = false;
		let timer = 0;
		const deadline = Date.now() + 2000;
		const tryScroll = () => {
			if (cancelled) return;
			const el = document.getElementById(elementId);
			if (el) {
				el.scrollIntoView({ block: "start", behavior: "smooth" });
				flashAnchor(el);
				setFocusTarget(null);
				return;
			}
			if (Date.now() < deadline) {
				timer = window.setTimeout(tryScroll, 50);
				return;
			}
			setFocusTarget(null);
		};
		timer = window.setTimeout(tryScroll, 0);
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [focusTarget, activeTab, persistTab, setActiveTab, setFocusTarget]);
}
