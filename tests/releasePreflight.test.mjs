/**
 * scripts/release-preflight.mjs 纯函数单测：参数解析 / 泳道构建（步骤脚本必须真实
 * 存在——脚本被删或改名时这里先红，而不是发版当天 preflight 挂一个起不来的步骤）/
 * 泳道选择 / 输出截尾。不真正跑检查进程（那属于 npm run preflight 本体）。
 */
import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { buildLanes, parsePreflightArgs, selectLanes, tail } from "../scripts/release-preflight.mjs";

test("parsePreflightArgs：默认值与各开关", () => {
	const defaults = parsePreflightArgs([]);
	assert.equal(defaults.e2e, false);
	assert.equal(defaults.list, false);
	assert.equal(defaults.testConcurrency, 4);
	assert.deepEqual([...defaults.only], []);
	assert.deepEqual([...defaults.skip], []);

	const full = parsePreflightArgs(["--e2e", "--list", "--only", "typecheck,release", "--skip", "unit-tests", "--test-concurrency", "8"]);
	assert.equal(full.e2e, true);
	assert.equal(full.list, true);
	assert.deepEqual([...full.only], ["typecheck", "release"]);
	assert.deepEqual([...full.skip], ["unit-tests"]);
	assert.equal(full.testConcurrency, 8);
});

test("parsePreflightArgs：非法输入抛错并带提示", () => {
	assert.throws(() => parsePreflightArgs(["--nope"]), /未知参数/);
	assert.throws(() => parsePreflightArgs(["--only"]), /--only 需要/);
	assert.throws(() => parsePreflightArgs(["--test-concurrency", "0"]), /正整数/);
	assert.throws(() => parsePreflightArgs(["--test-concurrency", "x"]), /正整数/);
});

test("buildLanes：四条基础泳道 + e2e 开关 + 单测并发透传", () => {
	const base = buildLanes({ testConcurrency: 4, e2e: false });
	assert.deepEqual(
		base.map((lane) => lane.id),
		["typecheck", "unit-tests", "format", "release"],
	);
	assert.equal(
		base.some((lane) => lane.id === "e2e"),
		false,
	);

	const withE2e = buildLanes({ testConcurrency: 2, e2e: true });
	assert.equal(
		withE2e.some((lane) => lane.id === "e2e"),
		true,
	);
	const unit = withE2e.find((lane) => lane.id === "unit-tests");
	assert.ok(unit.label.includes("--test-concurrency=2"));
	assert.ok(unit.steps[0].args.includes("--test-concurrency=2"));
});

test("selectLanes：--only 优先，--skip 过滤，未知 id 报错", () => {
	const lanes = buildLanes({ testConcurrency: 4, e2e: false });
	assert.deepEqual(
		selectLanes(lanes, { only: new Set(["typecheck"]), skip: new Set() }).map((l) => l.id),
		["typecheck"],
	);
	assert.deepEqual(
		selectLanes(lanes, { only: new Set(), skip: new Set(["unit-tests", "format"]) }).map((l) => l.id),
		["typecheck", "release"],
	);
	assert.deepEqual(selectLanes(lanes, { only: new Set(), skip: new Set() }), lanes);
	assert.throws(() => selectLanes(lanes, { only: new Set(["nope"]), skip: new Set() }), /未知泳道 id：nope/);
	assert.throws(() => selectLanes(lanes, { only: new Set(), skip: new Set(["nope"]) }), /未知泳道 id：nope/);
});

test("tail：保留末尾 N 行并剥掉结尾空行", () => {
	const lines = ["a", "b", "c", "", ""];
	assert.equal(tail(lines.join("\n"), 2), "b\nc");
	assert.equal(tail("single", 5), "single");
	assert.equal(tail("", 5), "");
	assert.equal(tail(undefined, 5), "");
});
