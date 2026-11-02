import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// 纯规则模块：只做数据转换，不碰网络/终端，可直接 import 断言
const { globToRegExp, filterAssetsByPatterns, formatAssetSize, classifyAsset, buildAssetSelectionRows, actionLabel, parseAssetSelection, selectRows } = await import("../scripts/atomgit-asset-selection.mjs");

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const assets = (...names) => names.map((name, i) => ({ name, size: 1000 + i }));

test("filterAssetsByPatterns: 未给模式时原样返回（保持全量同步行为）", () => {
	const input = assets("a.zip", "b.tgz");
	assert.deepEqual(filterAssetsByPatterns(input, []), input);
	assert.deepEqual(filterAssetsByPatterns(input, undefined), input);
});

test("globToRegExp: 正则元字符按字面处理，不会被当成模式", () => {
	// 资产名里的 . 必须字面匹配，否则 latest.yml 会命中 latestXyml
	assert.equal(globToRegExp("latest.yml").test("latest.yml"), true);
	assert.equal(globToRegExp("latest.yml").test("latestXyml"), false);
	assert.equal(globToRegExp("a+b*").test("a+bcd"), true);
});

test("actionLabel: 默认动作有可读说明（选择器里用户据此判断）", () => {
	const rows = buildAssetSelectionRows(assets("a.tgz", "b.exe", "c.exe"), {
		uploads: [{ name: "a.tgz", reason: "new" }],
		skips: [{ name: "b.exe", reason: "same-size" }],
		conflicts: [{ name: "c.exe", githubSize: 1, remoteSize: 2 }],
	});
	const labels = new Map(rows.map((r) => [r.name, actionLabel(r)]));
	assert.match(labels.get("a.tgz"), /待上传/);
	assert.match(labels.get("b.exe"), /大小一致/);
	assert.match(labels.get("c.exe"), /冲突/);
});

test("parseAssetSelection: 空串 = 默认计划，a/all = 全选", () => {
	assert.deepEqual(parseAssetSelection("", 4), { indices: [] });
	assert.deepEqual(parseAssetSelection("   ", 4), { indices: [] });
	assert.deepEqual(parseAssetSelection("a", 3), { indices: [1, 2, 3] });
	assert.deepEqual(parseAssetSelection("ALL", 3), { indices: [1, 2, 3] });
});

test("parseAssetSelection: 编号与范围（含中文逗号/en dash），去重保序", () => {
	assert.deepEqual(parseAssetSelection("1,3-5", 6), { indices: [1, 3, 4, 5] });
	assert.deepEqual(parseAssetSelection("1 2", 3), { indices: [1, 2] });
	assert.deepEqual(parseAssetSelection("2-2", 3), { indices: [2] });
	assert.deepEqual(parseAssetSelection("1,1,2", 3), { indices: [1, 2] });
	assert.deepEqual(parseAssetSelection("1，3–4", 5), { indices: [1, 3, 4] });
});

test("parseAssetSelection: 非法输入一律报错，绝不同降成默认计划", () => {
	// 输入了内容却解析失败时回退成「默认计划」= 用户以为只传 3 个、实际传了全部
	for (const bad of ["0", "7", "foo", "3-1", "1-", "-2", "1,,a-z", "1--2"]) {
		const result = parseAssetSelection(bad, 6);
		assert.ok(result.error, `期望 ${JSON.stringify(bad)} 报错，实际 ${JSON.stringify(result)}`);
		assert.equal(result.indices, undefined);
	}
});

test("selectRows: 点名的「默认跳过」行升级为强制重传，未选中的行被裁掉", () => {
	const rows = buildAssetSelectionRows(assets("a.tgz", "b.exe", "c.exe"), {
		uploads: [{ name: "a.tgz", reason: "new" }],
		skips: [{ name: "b.exe", reason: "same-size" }],
		conflicts: [{ name: "c.exe", githubSize: 1, remoteSize: 2 }],
	});
	const indexOf = (name) => rows.find((r) => r.name === name).index;

	const picked = selectRows(rows, [indexOf("a.tgz"), indexOf("b.exe"), indexOf("c.exe")]);
	assert.deepEqual(picked.map((r) => r.name).sort(), ["a.tgz", "b.exe", "c.exe"]);
	const b = picked.find((r) => r.name === "b.exe");
	// 远端已有同名同大小时直接 PUT 会拿到 409，必须标记升级才能触发「先删后传」
	assert.deepEqual([b.action, b.reason], ["upload", "force-reselect"]);
	// 冲突行保持冲突语义：改不改由 --force-upload / --force-resync 明确表态
	assert.equal(picked.find((r) => r.name === "c.exe").action, "conflict");
	assert.equal(picked.find((r) => r.name === "a.tgz").action, "upload");
	assert.equal(picked.find((r) => r.name === "a.tgz").reason, "new");

	assert.deepEqual(
		selectRows(rows, [indexOf("a.tgz")]).map((r) => r.name),
		["a.tgz"],
	);
});

test("sync 脚本接线：CLI 开关与选择器调用点存在（删掉即回归）", () => {
	const script = readFileSync(join(repoRoot, "scripts", "sync-release-to-atomgit.mjs"), "utf8");
	for (const flag of ["--only", "--select", "--force-upload", "--dry-run", "--yes"]) {
		assert.ok(script.includes(`'${flag}'`) || script.includes(`\"${flag}\"`), `缺少 CLI 开关 ${flag}`);
	}
	assert.match(script, /filterAssetsByPatterns\(allGhAssets, onlyPatterns\)/);
	assert.match(script, /pickAssetsInteractively\(rows\)/);
	// dry-run 必须在下载/上传/删除之前返回。
	// formatter 会把单引号字面量改成双引号：两种引号都要认。
	const dryRunIndex = Math.max(script.indexOf("console.log('dry-run：未执行任何写操作。')"), script.indexOf('console.log("dry-run：未执行任何写操作。")'));
	const uploadIndex = script.indexOf("await uploadOneAsset(targetTag, fileName, localFilePath)");
	assert.ok(dryRunIndex > 0 && uploadIndex > dryRunIndex, "dry-run 必须在上传之前提前返回");
});

test("createLineReader: 逐行读取、CRLF 归一化、EOF 返回 null（不挂死）", async () => {
	const { createLineReader } = await import("../scripts/sync-release-to-atomgit.mjs");
	const { Readable } = await import("node:stream");

	const reader = createLineReader(Readable.from(["1,3\r\na\n", "last-no-newline"]));
	assert.equal(await reader.next(), "1,3"); // \r 要被剥掉，否则 parseAssetSelection 会拿到 "3\r" 报错
	assert.equal(await reader.next(), "a");
	assert.equal(await reader.next(), "last-no-newline"); // 无换行的末行也要交付
	assert.equal(await reader.next(), null); // EOF：调用方必须自己决定下一步
	assert.equal(await reader.next(), null); // 重复读仍为 EOF（幂等）
});

test("createLineReader: 数据晚于提问到达时也能正确交付（TTY 场景）", async () => {
	const { createLineReader } = await import("../scripts/sync-release-to-atomgit.mjs");
	const { PassThrough } = await import("node:stream");
	const stream = new PassThrough();
	const reader = createLineReader(stream);
	const pending = reader.next();
	stream.write("hello\n");
	assert.equal(await pending, "hello");
});
