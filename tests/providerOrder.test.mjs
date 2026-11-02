import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

// 供应商卡片自定义顺序纯函数：应用顺序 / 拖拽落点 / 手柄方向键 / 边界
const { buildProviderRank, applyProviderOrder, buildProviderOrderScope, moveProviderRelative, neighborProvider, moveProviderByStep } = loadTsCommonJs("src/renderer/src/utils/providerOrder.ts");

// vm 沙箱里「数组字面量 / 展开语法」产出的数组原型属于沙箱 realm，与宿主 realm 的数组
// 原型不同，deepStrictEqual 会判不等。用宿主 realm 的 Array.from 归一化后再比较。
const list = (value) => Array.from(value);

test("applyProviderOrder 把列出的供应商按自定义名次前置，未列出的保持配置原序追加在后", () => {
	const names = ["alpha", "beta", "gamma", "delta"];
	// beta 排到最前，delta 排第二；alpha/gamma 没排过 → 保持它们在配置里的相对顺序
	assert.deepEqual(list(applyProviderOrder(names, ["beta", "delta"])), ["beta", "delta", "alpha", "gamma"]);
});

test("applyProviderOrder 未自定义排序时原样返回副本（不共享引用）", () => {
	const names = ["alpha", "beta"];
	const result = applyProviderOrder(names, undefined);
	assert.deepEqual(list(result), ["alpha", "beta"]);
	assert.notEqual(result, names);
	assert.deepEqual(list(applyProviderOrder(names, [])), ["alpha", "beta"]);
});

test("applyProviderOrder 忽略顺序数组里的未知名字与脏数据，重名只认首次位置", () => {
	const names = ["alpha", "beta"];
	assert.deepEqual(list(applyProviderOrder(names, ["beta", "ghost"])), ["beta", "alpha"]);
	// 重名取首次出现：beta 名次 0、alpha 名次 1 → 仍是 beta 在前
	assert.deepEqual(list(applyProviderOrder(names, ["beta", "alpha", "beta"])), ["beta", "alpha"]);
	// 空串/非字符串（旧 settings.json 脏数据）不产生名次
	const rank = buildProviderRank(["", null, "alpha"]);
	assert.equal(rank.size, 1);
	assert.equal(rank.get("alpha"), 0);
});

test("moveProviderRelative 按锚点前/后落位（拖拽落点语义）", () => {
	const names = ["a", "b", "c", "d"];
	assert.deepEqual(list(moveProviderRelative(names, "d", "b", "before")), ["a", "d", "b", "c"]);
	assert.deepEqual(list(moveProviderRelative(names, "a", "c", "after")), ["b", "c", "a", "d"]);
	// 拖到自己身上/未知名字：原序返回，调用方据此跳过写盘
	assert.deepEqual(list(moveProviderRelative(names, "b", "b", "before")), names);
	assert.deepEqual(list(moveProviderRelative(names, "ghost", "b", "before")), names);
});

test("neighborProvider 取可见列表的邻居，越界返回 null", () => {
	const visible = ["a", "c", "d"];
	assert.equal(neighborProvider(visible, "c", -1), "a");
	assert.equal(neighborProvider(visible, "c", 1), "d");
	assert.equal(neighborProvider(visible, "a", -1), null);
	assert.equal(neighborProvider(visible, "d", 1), null);
});

test("buildProviderOrderScope 把多个来源合成一份顺序：已排名的先上、其余保持来源序追加", () => {
	// 模型页与认证页的供应商集合不同：认证页独有的 gamma 也要进顺序，否则在认证页拖一次
	// 会把 gamma 从顺序里去掉，模型页的顺序随之回到默认。
	assert.deepEqual(
		list(
			buildProviderOrderScope(
				[
					["alpha", "beta"],
					["beta", "gamma"],
				],
				["gamma", "alpha"],
			),
		),
		["gamma", "alpha", "beta"],
	);
	// 没排过顺序：各来源按传入先后拼接（模型页在前、认证页独有的在后）
	assert.deepEqual(list(buildProviderOrderScope([["alpha", "beta"], ["gamma"]], undefined)), ["alpha", "beta", "gamma"]);
	// 同一名字出现在多个来源只保留一次；顺序数组里的未知名字不凭空造出供应商
	assert.deepEqual(list(buildProviderOrderScope([["alpha"], ["alpha"]], ["ghost"])), ["alpha"]);
	// 空集合 / 空顺序都安全
	assert.deepEqual(list(buildProviderOrderScope([], ["alpha"])), []);
});

test("moveProviderByStep 在完整列表上位移，跳过隐藏项且不打乱可见相对顺序", () => {
	// b 被隐藏：完整列表里 b 夹在 a、c 之间，可见列表是 a/c/d
	const full = ["a", "b", "c", "d"];
	const visible = ["a", "c", "d"];
	// c 上移 → 落到 a 前（隐藏的 b 被挤到中间，用户看不到）
	assert.deepEqual(list(moveProviderByStep(full, visible, "c", -1)), ["c", "a", "b", "d"]);
	// a 下移 → 落到 c 后
	assert.deepEqual(list(moveProviderByStep(full, visible, "a", 1)), ["b", "c", "a", "d"]);
	// 边界：首项上移 / 末项下移都返回 null，调用方保持原序
	assert.equal(moveProviderByStep(full, visible, "a", -1), null);
	assert.equal(moveProviderByStep(full, visible, "d", 1), null);
});

test("契约完整性：「模型」「认证」两页共享同一份顺序（providerOrderScope），拖完不会互相重置", () => {
	const read = (path) => readFileSync(path, "utf8");
	const configModal = read("src/renderer/src/ConfigModal.tsx");
	const modelsTab = read("src/renderer/src/config/ModelsTab.tsx");
	const authTab = read("src/renderer/src/config/AuthTab.tsx");

	// 作用域由「模型 + 认证」两页的并集算出（单页集合会让另一页独有的供应商掉队）
	assert.ok(configModal.includes("buildProviderOrderScope(["));
	assert.ok(configModal.includes("providerOrderScope={providerOrderScope}"));
	// 两页拖拽的作用域都必须优先用并集：只传自己的列表 = 认证页拖动会把模型页顺序重置
	for (const [label, source] of [
		["ModelsTab", modelsTab],
		["AuthTab", authTab],
	]) {
		assert.ok(source.includes("props.providerOrderScope?.length ? props.providerOrderScope"), `${label} 未用 providerOrderScope 作为拖拽作用域`);
		assert.ok(source.includes("providerReorder.gripProps("), `${label} 缺少拖拽手柄`);
		assert.ok(source.includes("providerReorder.registerCard("), `${label} 缺少卡片注册`);
		assert.ok(source.includes("color:var(--color-accent)") && source.includes("dropTarget.position ==="), `${label} 缺少插入指示线`);
	}
	// 认证页卡片也要有标题行标记，否则落点会按整张卡的中线算（展开态卡片偏移）
	assert.ok(authTab.includes('data-provider-head=""'));
});
