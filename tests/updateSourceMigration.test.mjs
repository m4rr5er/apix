/**
 * updateSource 一次性迁移单测（APIX：atomgit → github）。
 *
 * SettingsStore 依赖 electron（app.getPath）无法直接 import，
 * 迁移逻辑抽成纯函数 migrateUpdateSourceToGithub 后用 loadTsCommonJs 加载验证。
 * 守护的边界：旧 atomgit 值必须回到 GitHub；github/缺省不动；未知值不在这里做清洗。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { migrateUpdateSourceToGithub } = loadTsCommonJs("src/main/settings/SettingsStore.ts");

test("旧设置 atomgit：迁移为 github 并写标记", () => {
	const settings = { updateSource: "atomgit" };
	const changed = migrateUpdateSourceToGithub(settings);
	assert.equal(changed, true);
	assert.equal(settings.updateSource, "github");
	assert.equal(settings.updateSourceAtomgitMigrated, true);
});

test("已是 github：不改动，也不重复写标记", () => {
	const settings = { updateSource: "github" };
	const changed = migrateUpdateSourceToGithub(settings);
	assert.equal(changed, false);
	assert.equal(settings.updateSource, "github");
});

test("缺字段：不迁移（走新默认值 github）", () => {
	const settings = {};
	const changed = migrateUpdateSourceToGithub(settings);
	assert.equal(changed, false);
	assert.equal(settings.updateSource, undefined);
});

test("未知值：迁移逻辑不负责清洗，保留给 patch 归一化", () => {
	const settings = { updateSource: "custom" };
	const changed = migrateUpdateSourceToGithub(settings);
	assert.equal(changed, false);
	assert.equal(settings.updateSource, "custom");
});
