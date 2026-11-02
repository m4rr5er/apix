/**
 * 窗口缩放期间的 ResizeObserver 合流。
 *
 * 背景：APIX 长会话里 timeline / 消息列表 / 面板库 / 画布共有几十个 ResizeObserver。
 * Windows 拖动窗口或最大化时，每个宽度变化都会让它们同步重排、重建虚拟列表和测量
 * 滚动锚点；实测连续缩放会掉到 ~10fps，表现为窗口先变、内容几百毫秒后一步步跳。
 *
 * 处理：原生 resize 发生后 120ms 内只记录每个 observer 的最新 entry，不回调；
 * 停手后统一 flush 一次。窗口本身的宽高变化仍由 CSS flex 实时完成，冻结的只是
 * JS 侧的测量/虚拟列表重排，所以拖拽中不会出现空白，停止后一次校准到位。
 *
 * 只在渲染层入口安装一次；不改变 observe/unobserve/disconnect 语义。
 */
type NativeResizeObserver = typeof ResizeObserver;

const RESIZE_SETTLE_MS = 120;

export function installResizeObserverResizeGuard(): void {
	if (typeof window === "undefined" || typeof window.ResizeObserver === "undefined") return;
	const flaggedWindow = window as Window & { __pideckRoResizeGuard?: boolean };
	if (flaggedWindow.__pideckRoResizeGuard) return;
	const Native = window.ResizeObserver;
	const pendingObservers = new Set<CoalescedResizeObserver>();
	let resizing = false;
	let settleTimer: number | undefined;

	const flush = () => {
		resizing = false;
		settleTimer = undefined;
		for (const observer of [...pendingObservers]) {
			const entries = [...observer.pendingEntries.values()];
			observer.pendingEntries.clear();
			pendingObservers.delete(observer);
			if (entries.length > 0) observer.callback(entries, observer as unknown as ResizeObserver);
		}
	};

	window.addEventListener(
		"resize",
		() => {
			resizing = true;
			if (settleTimer !== undefined) window.clearTimeout(settleTimer);
			settleTimer = window.setTimeout(flush, RESIZE_SETTLE_MS);
		},
		{ passive: true },
	);

	class CoalescedResizeObserver {
		readonly pendingEntries = new Map<Element, ResizeObserverEntry>();
		private readonly native: ResizeObserver;

		constructor(readonly callback: ResizeObserverCallback) {
			this.native = new Native((entries) => {
				if (!resizing) {
					this.callback(entries, this as unknown as ResizeObserver);
					return;
				}
				for (const entry of entries) this.pendingEntries.set(entry.target, entry);
				pendingObservers.add(this);
			});
		}

		observe(target: Element, options?: ResizeObserverOptions): void {
			this.native.observe(target, options);
		}

		unobserve(target: Element): void {
			this.native.unobserve(target);
			this.pendingEntries.delete(target);
		}

		disconnect(): void {
			this.native.disconnect();
			this.pendingEntries.clear();
			pendingObservers.delete(this);
		}
	}

	window.ResizeObserver = CoalescedResizeObserver as unknown as NativeResizeObserver;
	flaggedWindow.__pideckRoResizeGuard = true;
}
