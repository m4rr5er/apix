export type ModelSortRow = {
	name?: string;
	id?: string;
};

export function modelSortKey(row: ModelSortRow): string {
	const name = typeof row.name === "string" ? row.name.trim() : "";
	if (name.length > 0) return name.toLowerCase();
	return typeof row.id === "string" ? row.id.toLowerCase() : "";
}

export function compareModelRows(a: ModelSortRow, b: ModelSortRow): number {
	const aKey = modelSortKey(a);
	const bKey = modelSortKey(b);
	if (aKey !== bKey) return aKey.localeCompare(bKey);
	const aId = typeof a.id === "string" ? a.id : "";
	const bId = typeof b.id === "string" ? b.id : "";
	return aId.localeCompare(bId);
}

export function sortModelRows<T extends ModelSortRow>(rows: T[]): T[] {
	return rows.sort(compareModelRows);
}
