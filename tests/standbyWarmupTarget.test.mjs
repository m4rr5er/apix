import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { pickStandbyWarmupProject } = loadTsCommonJs("src/main/pi/standbyWarmupTarget.ts");

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const PROJECTS = new Set(["p1", "p2", "p3"]);

function entry(projectId, updatedAt, backend) {
	return { projectId, updatedAt, ...(backend === undefined ? {} : { backend }) };
}

function pick(entries, overrides = {}) {
	return pickStandbyWarmupProject({
		entries,
		projectIds: PROJECTS,
		defaultBackend: "pi",
		now: NOW,
		...overrides,
	});
}

test("默认后端 pi：已删除项目被跳过，回落到仍存在的最近项目", () => {
	assert.equal(pick([entry("gone", NOW), entry("p1", NOW - DAY)]), "p1");
	// 条目全部指向已删除项目 → 不预热（不能给 getProject 失败的项目起进程）
	assert.equal(pick([entry("gone", NOW), entry("gone2", NOW - DAY)]), undefined);
});

test("默认后端 pi：空 catalog 不预热", () => {
	assert.equal(pick([]), undefined);
});

test("非法时间戳不参与选择（不会把 NaN 当成最新）", () => {
	assert.equal(pick([entry("p1", NOW - DAY), entry("p2", Number.NaN)]), "p1");
	assert.equal(pick([entry("p1", Number.NaN)]), undefined);
});

test("startup wiring: pi standby warmup runs after WSL config sync and drives ensureStandbyAgent", () => {
	// 启动期预热必须在 syncWslConfig().then 内：WSL 项目的 spawn 参数依赖 agentManager 的
	// WSL 快照，早于它预热会用错环境；同时它不能挡在 createWindow 之前（装配只在 then 内调用）。
	const main = readFileSync("src/main/index.ts", "utf8");
	assert.match(main, /void syncWslConfig\(\)[\s\S]{0,400}warmStandbyAgentAtStartup\(\)/);
	assert.match(main, /function warmStandbyAgentAtStartup\(\): void \{[\s\S]{0,1200}pickStandbyWarmupProject\(/);
	assert.match(main, /function warmStandbyAgentAtStartup\(\): void \{[\s\S]{0,1600}agentManager\.ensureStandbyAgent\(target\)/);
});
