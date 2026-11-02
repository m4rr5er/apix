/**
 *
 * 目录 bundle / 扁平 md、.system 跳过、项目根（最近 .git）解析、并集合并。
 * 目标是保证草稿期扫描结果与 host 目录不冲突（同名 host 优先）且不会漏静态根。
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const catalog = loadTsCommonJs("src/main/skills/skillCatalog.ts");

/** VM realm 的数组/对象与宿主 realm 原型不同：断言前拍平成普通 JSON。 */
const plain = (value) => JSON.parse(JSON.stringify(value));

/** 内存扫描 IO：directories 映射目录项；files 映射文件内容（缺省 = 读取失败/不存在）。 */
function createIo(directories, files) {
	return {
		async listDirectory(path) {
			const entries = directories[path];
			if (entries === undefined) throw new Error("ENOENT");
			return entries.map((entry) => ({ name: entry.name, type: entry.type }));
		},
		async readTextHead(path) {
			return files[path];
		},
	};
}

function dir(name) {
	return { name, type: "directory" };
}
function file(name) {
	return { name, type: "file" };
}

const sk = (name, description, extra = "") => `---\nname: ${name}\ndescription: ${description}\n${extra}---\n`;
const flat = (name, description) => `---\nname: ${name}\ndescription: ${description}\n---\n\nbody\n`;

test("resolveSkillProjectRoot：向上找最近 .git；找不到时回退 cwd", async () => {
	// 用 fromCharCode(92) 处理 Windows 分隔符，避免测试源码里的反斜杠转义噪音。
	const sep = String.fromCharCode(92);
	const normalize = (path) =>
		String(path)
			.split(sep)
			.join("/")
			.replace(/\/\.git$/, "");
	const gitDirs = new Set(["C:/repo", "C:/repo/apps"]);
	const pathExists = async (path) => gitDirs.has(normalize(path));
	assert.equal(await catalog.resolveSkillProjectRoot("C:/repo/apps/web", pathExists), resolve("C:/repo/apps"));
	assert.equal(await catalog.resolveSkillProjectRoot("C:/outside/deep", pathExists), resolve("C:/outside/deep"));
});
