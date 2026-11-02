import type { FetchedModel } from "../../../shared/types/fetchedModel";
// 排序键与主进程 / 模型下拉列表共用 shared 比较器，保证「保存顺序 = 下拉顺序」。
import { sortModelRows } from "../../../shared/modelOrder";
import type { ModelItem } from "./configTypes";

export type { FetchedModel };

export function buildModelsFromFetchedSelection(fetchedModels: FetchedModel[], selectedModelIds: string[], existingModels: ModelItem[]): ModelItem[] {
	const existingIds = new Set(existingModels.map((model) => model.id));
	const selectedIds = new Set(selectedModelIds);
	const result = fetchedModels
		.filter((model) => selectedIds.has(model.id) && !existingIds.has(model.id))
		.map((model) => {
			const item: ModelItem = {
				id: model.id,
				name: model.name ?? model.id,
			};
			if (model.contextWindow != null) item.contextWindow = model.contextWindow;
			if (model.maxTokens != null) item.maxTokens = model.maxTokens;
			if (model.reasoning !== undefined) item.reasoning = model.reasoning;
			if (model.thinkingLevelMap) item.thinkingLevelMap = { ...model.thinkingLevelMap };
			if (model.input && model.input.length > 0) item.input = model.input;
			return item;
		});
	// 按展示名正序排列（name 缺失回退 id），保证保存后模型表顺序稳定。
	return sortModelRows(result);
}
