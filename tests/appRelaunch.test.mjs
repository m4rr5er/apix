import assert from "node:assert/strict";
import test from "node:test";
import { loadTsCommonJs } from "./helpers/loadTsCommonJs.mjs";

const { desktopRelaunchOptions } = loadTsCommonJs("src/main/appRelaunch.ts");

test("portable 包重启回原始 EXE，而不是退出后会被清理的临时解包路径", () => {
	const options = desktopRelaunchOptions({ PORTABLE_EXECUTABLE_FILE: "C:\Users\me\AppData\Local\APIX\APIX.exe" }, ["C:\Temp\apix\APIX.exe", "--foo"]);
	assert.deepEqual(JSON.parse(JSON.stringify(options)), { execPath: "C:\Users\me\AppData\Local\APIX\APIX.exe", args: ["--foo"] });
});

test("非 portable 启动保持 Electron 默认 execPath", () => {
	const options = desktopRelaunchOptions({}, ["C:\Projects\APIX\node_modules\electron\electron.exe", "--inspect"]);
	assert.deepEqual(JSON.parse(JSON.stringify(options)), { args: ["--inspect"] });
});
