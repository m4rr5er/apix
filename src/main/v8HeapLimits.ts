/**
 * 渲染进程 V8 老生代堆上限（MB）。
 * 取 2GB：既远高于正常会话的 JS 峰值（~185MB），也高于 Chromium 在 8GB 机器上的
 * 默认档位量级，因此不会把「本来能跑」的负载改小；同时仍是硬上限，保留兜底语义。
 */
export const RENDERER_MAX_OLD_SPACE_MB = 2048;

/** 主进程 V8 老生代堆上限（MB），保持 #213 之前的实测口径不变。 */
export const MAIN_MAX_OLD_SPACE_MB = 384;

/**
 * 诊断用环境变量（不是产品设置项）：现场遇到 OOM 时临时抬档复现/验证，
 * 不必重新打包；值非法则回落默认，越界则夹到边界。
 * 例如 `PIDECK_MAIN_HEAP_MB=768 npm run dev`。
 */
const MAIN_HEAP_ENV = "PIDECK_MAIN_HEAP_MB";
const RENDERER_HEAP_ENV = "PIDECK_RENDERER_HEAP_MB";
/** 主进程档位下限高于实测峰值（~185MB），上限防手滑把 RSS 卫生彻底放开。 */
const MAIN_HEAP_BOUNDS = { min: 256, max: 4096 } as const;
/** 渲染进程档位下限 1GB（低于它等于退回 #213 的危险区），上限防手滑。 */
const RENDERER_HEAP_BOUNDS = { min: 1024, max: 8192 } as const;

export type HeapEnv = Record<string, string | undefined>;

/** 读取并校验环境变量覆盖值：非法回落默认，越界夹到边界。 */
export function resolveHeapOverrideMb(env: HeapEnv, name: string, fallbackMb: number, bounds: { min: number; max: number }): number {
	const raw = env?.[name];
	if (typeof raw !== "string" || !raw.trim()) return fallbackMb;
	const parsed = Number(raw.trim());
	if (!Number.isFinite(parsed)) return fallbackMb;
	return Math.min(bounds.max, Math.max(bounds.min, Math.round(parsed)));
}

/** 主进程实际生效的档位（默认 384MB，可被 PIDECK_MAIN_HEAP_MB 覆盖）。 */
export function mainProcessHeapMb(env: HeapEnv = process.env): number {
	return resolveHeapOverrideMb(env, MAIN_HEAP_ENV, MAIN_MAX_OLD_SPACE_MB, MAIN_HEAP_BOUNDS);
}

/** 渲染进程实际生效的档位（默认 2GB，可被 PIDECK_RENDERER_HEAP_MB 覆盖）。 */
export function rendererProcessHeapMb(env: HeapEnv = process.env): number {
	return resolveHeapOverrideMb(env, RENDERER_HEAP_ENV, RENDERER_MAX_OLD_SPACE_MB, RENDERER_HEAP_BOUNDS);
}

/** 主进程要写入 `--js-flags` 的 V8 参数（由 app.commandLine 在 ready 前安装）。 */
export function mainProcessJsFlags(env: HeapEnv = process.env): string {
	return `--max-old-space-size=${mainProcessHeapMb(env)}`;
}

/**
 * 窗口 webPreferences.additionalArguments 应带上的渲染进程 V8 参数。
 * 返回数组形式，直接展开给 webPreferences 使用。
 */
export function rendererHeapAdditionalArguments(env: HeapEnv = process.env): string[] {
	return [`--js-flags=--max-old-space-size=${rendererProcessHeapMb(env)}`];
}
