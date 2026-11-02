import { useState, type ReactElement, type ReactNode } from "react";
import type { AppInfo } from "../../../../shared/types";
import { formatI18nDateTime, t } from "../../i18n";
import { MorphPopover, MorphPopoverContent, MorphPopoverTrigger } from "../motion/popover-morph";
import { AnimatedBadge } from "../motion/animated-badge";
import { PiLogoCanvas } from "./PiLogoCanvas";
import { PiTuiLogoCanvas, useAppDisplayName, useBrandGlyph } from "./PiTuiLogo";

interface AboutPopoverProps {
	appInfo: AppInfo;
	/** 弹出触发区（BrandLockup 所在容器）；MorphPopoverTrigger 会为其注入点击控制。 */
	children: ReactElement;
}

/**
 * 左上角品牌区「关于」弹框：点击 PiDeck 品牌弹出 MorphPopover，
 * 版本、Electron/Chromium/Node 栈版本、打包/安装时间与官网/GitHub/发布链接。
 */
export function AboutPopover(props: AboutPopoverProps) {
	const [aboutOpen, setAboutOpen] = useState(false);

	const info = props.appInfo;
	const { style: logoStyle, customLogo } = useBrandGlyph();
	// 品牌名与品牌区同源：改过显示名称后「关于」面板标题同步，不再固定 PiDeck。
	const displayName = useAppDisplayName();

	return (
		<MorphPopover open={aboutOpen} onOpenChange={setAboutOpen}>
			<MorphPopoverTrigger>{props.children}</MorphPopoverTrigger>
			<MorphPopoverContent side="bottom" align="start" sideOffset={10} radius={16} className="w-72 overflow-hidden">
				<div className="flex flex-col gap-3 p-4">
					<div className="flex items-center gap-3">
						{customLogo ? <img src={customLogo} alt="" className="size-10 shrink-0 object-contain" /> : logoStyle === "pi-tui" ? <PiTuiLogoCanvas size={40} playOnClick /> : <PiLogoCanvas size={40} playOnClick />}
						<div className="min-w-0 flex-1">
							<div className="font-[PiDeckDepartureMono] text-lg font-normal leading-tight tracking-wide text-foreground">{displayName}</div>
							{/* 版本号用等宽小字：此前是带 ⓘ 图标的胶囊徽标，图标语义与「查看版本信息」
                  重复，胶囊边框在 40px logo 旁显得笨重；改为纯文本与弹框内版本行同源观感 */}
							<div className="font-mono text-micro leading-tight tabular-nums text-muted-foreground">v{info.version}</div>
						</div>
						{info.devBranch && (
							<AnimatedBadge status="warning" size="sm" bare>
								{t("about.devBranch")}: {info.devBranch}
							</AnimatedBadge>
						)}
					</div>

					<p className="text-xs leading-relaxed text-muted-foreground">{t("about.description")}</p>

					<div className="flex flex-col gap-1.5">
						<BlockLabel>{t("about.runtimeInfo")}</BlockLabel>
						{/* 探测失败/未安装的版本显示 —，同样保留行结构便于对照 */}
						<VersionRow label="Pi CLI" value={info.piVersion} />
						<VersionRow label={t("about.piAiVersion")} value={info.piAiVersion} />
						<p className="font-mono text-micro tabular-nums text-muted-foreground/70">
							{t("about.runtimeStack", {
								electron: info.electronVersion ?? "—",
								chromium: info.chromeVersion ?? "—",
								node: info.nodeVersion ?? "—",
							})}
						</p>
					</div>

					{(info.buildTime || info.installedAt) && (
						<div className="flex flex-col gap-1.5">
							<BlockLabel>{t("about.timestamps")}</BlockLabel>
							{info.buildTime && <TimeRow label={t("about.buildTime")} value={info.buildTime} />}
							{info.installedAt && <TimeRow label={t("about.installedAt")} value={info.installedAt} />}
						</div>
					)}
				</div>
			</MorphPopoverContent>
		</MorphPopover>
	);
}

/** 区块小标题（运行时 / 时间），大写跟踪线样式。 */
function BlockLabel(props: { children: ReactNode }) {
	return <div className="text-micro font-medium uppercase tracking-wider text-muted-foreground/70">{props.children}</div>;
}

/** 单行「标签 — 等宽值」：label 左对齐灰字，value 右侧等宽数字；值缺失显示 —。 */
function VersionRow(props: { label: string; value: string | undefined }) {
	return (
		<div className="flex items-baseline justify-between gap-3">
			<span className="truncate text-xs text-muted-foreground">{props.label}</span>
			<span className="shrink-0 font-mono text-xs tabular-nums text-foreground">{props.value ?? "—"}</span>
		</div>
	);
}

/** 单行时间：ISO 转当前 locale 的可读格式（formatI18nDateTime 已在 i18n 层统一）。 */
function TimeRow(props: { label: string; value: string }) {
	return (
		<div className="flex items-baseline justify-between gap-3">
			<span className="truncate text-xs text-muted-foreground">{props.label}</span>
			<span className="shrink-0 text-xs tabular-nums text-foreground">{formatI18nDateTime(props.value)}</span>
		</div>
	);
}
