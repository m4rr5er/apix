import { moveKeyByStep, moveKeyRelative, neighborKey } from "./listReorder";

/**
 * 供应商卡片拖拽的 MIME 类型：自定义类型避免浏览器把外部拖入的文本/链接当成卡片重排。
 */
export const PROVIDER_CARD_DRAG_MIME = "application/x-pideck-provider-card";

/** 顺序数组 → 名字 → 名次（重名取首次出现的位置，空串忽略） */
export function buildProviderRank(order?: readonly string[] | null): Map<string, number> {
	const rank = new Map<string, number>();
	if (!order) return rank;
	for (const key of order) {
		if (typeof key !== "string" || key.length === 0) continue;
		if (!rank.has(key)) rank.set(key, rank.size);
	}
	return rank;
}

/**
 * 按自定义顺序重排供应商名称：列出的按名次前置，未列出的保持原序追加在后。
 * order 为空（未自定义排过序）时原样返回副本，避免无意义的重排与重渲染。
 */
export function applyProviderOrder(names: readonly string[], order?: readonly string[] | null): string[] {
	const rank = buildProviderRank(order);
	if (rank.size === 0) return [...names];
	return names
		.map((name, index) => ({ name, index }))
		.sort((a, b) => {
			const rankA = rank.get(a.name);
			const rankB = rank.get(b.name);
			// 未列出的排到最后：rank 缺失按 +∞ 处理，两者都缺失时保持原相对顺序。
			const weightA = rankA ?? Number.POSITIVE_INFINITY;
			const weightB = rankB ?? Number.POSITIVE_INFINITY;
			if (weightA !== weightB) return weightA - weightB;
			return a.index - b.index;
		})
		.map((entry) => entry.name);
}

/**
 * 「模型」与「认证」两页共用的排序作用域：两页的供应商集合可能不同（models.json 与 auth.json
 * 各自独立增删，认证还允许只配 key 不配模型），取并集并按当前自定义顺序排好后交给排序 hook 当
 * 「完整顺序」——在任一页拖动只会改变该供应商在并集里的位置，另一页独有的供应商保持原位，
 * 不会出现「在认证页排一次，模型页的顺序被重置」。
 * 只收录仍然存活的供应商名：已删除的供应商会在下一次拖动时被顺带清出偏好设置。
 */
export function buildProviderOrderScope(groups: readonly (readonly string[])[], order?: readonly string[] | null): string[] {
	const seen = new Set<string>();
	const union: string[] = [];
	for (const group of groups) {
		for (const name of group) {
			if (typeof name !== "string" || name.length === 0 || seen.has(name)) continue;
			seen.add(name);
			union.push(name);
		}
	}
	return applyProviderOrder(union, order);
}

/**
 * 把 fromKey 移动到锚点 anchorKey 的前/后，返回新的完整顺序。
 * 拖拽落点与手柄方向键（↑/↓）都复用这一个入口，避免两套位移逻辑漂移：
 * - 拖拽：anchor = 悬停的卡片，position 由指针在卡片内的上下半区决定；
 * - ↑ 键：anchor = 可见列表里的上一个供应商，position = "before"；
 * - ↓ 键：anchor = 可见列表里的下一个供应商，position = "after"。
 * 无位移（同名、元素不存在）时返回原序副本，调用方可据此跳过持久化。
 * 位移算法与智能体/收藏列表共用 `listReorder.ts` 的实现，这里只保留供应商语义的入口名。
 */
export function moveProviderRelative(names: readonly string[], fromKey: string, anchorKey: string, position: "before" | "after"): string[] {
	return moveKeyRelative(names, fromKey, anchorKey, position);
}

/** 可见列表里 key 的上一个（delta=-1）或下一个（delta=1）供应商；越界返回 null */
export function neighborProvider(visibleNames: readonly string[], key: string, delta: -1 | 1): string | null {
	return neighborKey(visibleNames, key, delta);
}

/**
 * 手柄 ↑/↓ 键盘重排的完整实现（原上移/下移按钮的无障碍替代）：以可见邻居为锚点，在完整列表上执行一次移动。
 * 返回 null 表示已经在边界（调用方应保持原序，不要写盘）。
 */
export function moveProviderByStep(fullNames: readonly string[], visibleNames: readonly string[], key: string, delta: -1 | 1): string[] | null {
	return moveKeyByStep(fullNames, visibleNames, key, delta);
}
