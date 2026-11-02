// ============================================================
// AppParts — 产品级顶层桥接文件
// ============================================================
// 本文件保留：
//   1. Overlay domain (EnvironmentDialog re-export, ConfirmDialog)
//   2. 全局类型定义 (SessionModifiedFile, DiffFileHandler)
//   3. Re-exports from leaf modules (Composer, Sidebar, Surface)
// ============================================================

import { useEffect, useState } from "react";
import { ConfirmDialog as ShadcnConfirmDialog } from "../ui-shadcn/ConfirmDialog";

// Re-exports from other modules
export type { WorkspaceDrawerPanel as DrawerPanel } from "../../hooks/useWorkspacePanels";

// Re-exports from leaf modules (A12 migration in progress)
import { useAppDisplayName, useBrandGlyph } from "./PiTuiLogo";
import apixWordmark from "../../assets/apix-wordmark.svg";
export { WorktreeCreateDialog } from "../sidebar/SidebarComponents";
export { ComposerBottomBar, ModelPicker, PromptTemplatePicker, ExtensionWidgetCard } from "../session/ComposerComponents";

export type SessionModifiedFile = {
	path: string;
	toolName: string;
	status: string;
	changedLines?: number;
	/** 工具执行前的文件原始内容，用于历史会话恢复时展示差异对比。 */
	originalContent?: string;
	/** 工具写入/编辑后的新文件内容，优先于从磁盘实时读取（历史会话恢复时磁盘可能已变化或文件已删除）。 */
	content?: string;
};

type DiffFileHandler = (path: string, originalContent?: string, content?: string) => void;

// EnvironmentDialog 已收敛到 overlays/OverlayComponents（唯一实现，含 pi 环境三步引导），
// 这里仅保留 re-export 兼容旧 import 路径。
export { EnvironmentDialog } from "../overlays/OverlayComponents";

export function ConfirmDialog(props: { title: string; message: string; onConfirm: () => void; onCancel: () => void; confirmLabel?: string; danger?: boolean }) {
	// 实现已收敛到 ui-shadcn/ConfirmDialog（AlertDialog），此处仅保留兼容转发，
	// 避免一次性改动所有 import 路径；后续批量替换 import 后删除本包装。
	return <ShadcnConfirmDialog {...props} />;
}

// ============================================================
// Re-exports from Surface domain (session rendering components)
// 保持旧 import 路径继续工作
// ============================================================
export {
	SessionStatus,
	LogoMark,
	AgentAvatar,
	EmptyState,
	ToolCard,
	ToolGroupCard,
	DiagnosticMessageCard,
	ThinkingBlock,
	RespondingIndicator,
	AssistantText,
	UserBubble,
	ImagePreviewModal,
	stripMarkdown,
	MultiSelectModal,
	ConversationOutline,
	DrawerContent,
	SessionFileSummary,
	SessionHistoryModal,
	PromptSuggestions,
	FileContextMenu,
} from "../session/SurfaceComponents";
export { TurnRow } from "../session/turn";

// PiLogoCanvas — canvas-based animated pi logo (from upstream dev)
export { PiLogoCanvas } from "./PiLogoCanvas";

/** 模块级缓存：dev 分支名（多 worktree 并行区分窗口）。一次拉取，全实例共享。 */
let cachedDevBranch: string | undefined;
let devBranchPromise: Promise<string | undefined> | null = null;
function loadDevBranch(): Promise<string | undefined> {
	if (cachedDevBranch !== undefined) return Promise.resolve(cachedDevBranch);
	devBranchPromise ??= (async () => {
		try {
			const info = await (window as unknown as { piDesktop?: { app?: { info: () => Promise<{ devBranch?: string }> } } }).piDesktop?.app?.info();
			cachedDevBranch = info?.devBranch?.trim() || undefined;
			return cachedDevBranch;
		} catch {
			return undefined;
		}
	})();
	return devBranchPromise;
}

/**
 * 品牌位：单独一个白色 APIX 字标 SVG（用户自定义 logo 时显示自定义图）。
 * 不再叠加 π 动画标与文本，侧栏左上角保持单一品牌符号；分支名只留在 aria-label/title。
 */
export function BrandLockup() {
	const displayName = useAppDisplayName();
	const { customLogo } = useBrandGlyph();
	const [branch, setBranch] = useState<string | undefined>(undefined);
	useEffect(() => {
		void loadDevBranch().then(setBranch);
	}, []);
	const brandTitle = branch ? `${displayName} · ${branch}` : displayName;
	return (
		<div className="brand-lockup flex h-full min-w-0 items-center gap-2" aria-label={brandTitle} title={branch ? brandTitle : undefined}>
			{customLogo ? <img src={customLogo} alt="" className="size-[18px] shrink-0 object-contain" /> : <img src={apixWordmark} alt={displayName} className="brand-apix-wordmark h-auto max-h-[32px] w-[60px] shrink-0 object-contain" />}
		</div>
	);
}
