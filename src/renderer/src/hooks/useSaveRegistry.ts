import { useCallback, useRef, useState } from "react";

export function useSaveRegistry() {
	const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set());
	/** 同步脏集合（markDirty 后立即可读；state 仅驱动渲染，异步更新）。 */
	const dirtyRef = useRef(new Set<string>());
	const saversRef = useRef(new Map<string, () => Promise<boolean>>());

	const register = useCallback((key: string, save: () => Promise<boolean>) => {
		saversRef.current.set(key, save);
	}, []);

	const unregister = useCallback((key: string) => {
		saversRef.current.delete(key);
	}, []);

	const markDirty = useCallback((key: string, dirty: boolean) => {
		if (dirty) dirtyRef.current.add(key);
		else dirtyRef.current.delete(key);
		setDirtyKeys(new Set(dirtyRef.current));
	}, []);

	/** 同步读取当前是否有脏标记（markDirty 后立即可用；state 是异步的）。 */
	const isDirty = useCallback(() => dirtyRef.current.size > 0, []);

	/** 同步列出当前脏 key（侧栏黄点 / 关闭文案按导航归并时用）。 */
	const listDirtyKeys = useCallback(() => [...dirtyRef.current], []);

	/** 保存单个 key（未注册返回 false）；成功后清除该 key 的脏标记。 */
	const saveKey = useCallback(async (key: string): Promise<boolean> => {
		const save = saversRef.current.get(key);
		if (!save) return false;
		const ok = await save();
		if (ok) {
			dirtyRef.current.delete(key);
			setDirtyKeys(new Set(dirtyRef.current));
		}
		return ok;
	}, []);

	/** 保存全部已注册的保存函数；全部成功才清除脏标记。 */
	const saveAll = useCallback(async (): Promise<boolean> => {
		let ok = true;
		for (const save of saversRef.current.values()) {
			if (!(await save())) ok = false;
		}
		if (ok) {
			dirtyRef.current.clear();
			setDirtyKeys(new Set());
		}
		return ok;
	}, []);

	return {
		dirtyKeys,
		hasDirty: dirtyKeys.size > 0,
		register,
		unregister,
		markDirty,
		isDirty,
		listDirtyKeys,
		saveKey,
		saveAll,
	};
}
