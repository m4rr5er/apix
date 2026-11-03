/**
 * 更新源（GitHub Release 镜像）配置 —— 主进程侧编排逻辑。
 *
 * 纯数据与拼接规则在 shared/updateSources.ts（主/渲染共用同一份清单，UI 展示与
 * feed URL 生成自动同步）；本文件只保留需要主进程侧的归一化与查询函数。
 */

import type { UpdateSourceId } from "../../shared/types/settings";
import { normalizeCustomMirrorHost } from "../../shared/updateSources";

export { normalizeCustomMirrorHost }; // 再导出，供调用点单一来源

/** 校验设置里的更新源 id；APIX 只有 GitHub 通道，旧 atomgit 值统一收敛到 github。 */
export function normalizeUpdateSource(source: unknown): UpdateSourceId {
	const id = typeof source === "string" ? source : "github";
	return id === "github" ? "github" : id === "atomgit" ? "github" : "github";
}

/** 镜像展示信息（设置页下拉/列表用）：id + 显示名 labelKey + 完整 feed URL。 */
export type UpdateSourceOption = {
	id: UpdateSourceId;
	/** 渲染层 i18n label key 后缀（settings.updateSourceOption.<id>）。 */
	labelKey: string;
	host: string | null;
	feedUrl: string | null;
};

/**
 * 更新源下拉选项：APIX 只发布 GitHub Release，因此仅保留 GitHub 一项。
 */
export function updateSourceOptions(): UpdateSourceOption[] {
	return [{ id: "github", labelKey: "github", host: null, feedUrl: null }];
}

/**
 * 生成镜像源的 generic feed baseUrl。
 * github 源返回 null → 走 app-update.yml 的原生 GitHub provider；APIX 没有
 * AtomGit 镜像，旧 atomgit 值也按 GitHub 处理。
 */
export function updateSourceFeedUrl(_source: UpdateSourceId, _customHost?: string | null): string | null {
	return null;
}

/**
 * macOS manual 检查的 latest-release 探测 URL：
 * github 源返回 null → 主进程走官方 GitHub `/releases/latest` 重定向。
 */
export function updateSourceLatestReleaseUrl(_source: UpdateSourceId, _customHost?: string | null): string | null {
	return null;
}
