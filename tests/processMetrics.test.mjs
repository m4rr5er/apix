import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parsePrivateMemoryBytes, parsePsRssKb, parseTasklistMemoryKb } from "../src/main/process/pidMemoryParsers.ts";
import { formatBytes, formatMb } from "../src/shared/formatBytes.ts";

// ===== 纯函数：tasklist CSV / ps rss 解析 =====

test("parseTasklistMemoryKb: standard CSV row", () => {
	assert.equal(parseTasklistMemoryKb('"node.exe","12345","Console","1","32,456 K"'), 32456);
});

test("parseTasklistMemoryKb: no thousands separator", () => {
	assert.equal(parseTasklistMemoryKb('"pi.exe","99","Console","1","2048 K"'), 2048);
});

test("parseTasklistMemoryKb: rejects malformed rows", () => {
	assert.equal(parseTasklistMemoryKb(""), null);
	assert.equal(parseTasklistMemoryKb('"node.exe","1"'), null);
	assert.equal(parseTasklistMemoryKb('"node.exe","1","Console","1","not-a-size"'), null);
	// 非 K 单位（tasklist 不会出现，防御性）
	assert.equal(parseTasklistMemoryKb('"node.exe","1","Console","1","12 M"'), null);
});

test("parsePsRssKb: standard ps output", () => {
	assert.equal(parsePsRssKb("  123456\n"), 123456);
	assert.equal(parsePsRssKb("0\n"), 0);
});

test("parsePsRssKb: rejects empty/non-numeric output", () => {
	assert.equal(parsePsRssKb(""), null);
	assert.equal(parsePsRssKb("  \n"), null);
	assert.equal(parsePsRssKb("abc"), null);
	assert.equal(parsePsRssKb("-5"), null);
});

// ===== 纯函数：PowerShell PrivateMemorySize64 解析 =====

test("parsePrivateMemoryBytes: standard PS output (bytes)", () => {
	assert.equal(parsePrivateMemoryBytes("123456789\r\n"), 123456789);
	assert.equal(parsePrivateMemoryBytes("0\n"), 0);
});

test("parsePrivateMemoryBytes: strips BOM/whitespace/thousands separators", () => {
	assert.equal(parsePrivateMemoryBytes("\uFEFF  123,456,789 \r\n"), 123456789);
});

test("parsePrivateMemoryBytes: rejects empty/non-numeric output", () => {
	assert.equal(parsePrivateMemoryBytes(""), null);
	assert.equal(parsePrivateMemoryBytes("\uFEFF \r\n"), null);
	assert.equal(parsePrivateMemoryBytes("N/A"), null);
	assert.equal(parsePrivateMemoryBytes("-5"), null);
});

test("formatBytes: human readable units", () => {
	assert.equal(formatBytes(0), "0 B");
	assert.equal(formatBytes(512), "512 B");
	assert.equal(formatBytes(1024), "1.0 KB");
	assert.equal(formatBytes(1048576), "1.0 MB");
	assert.equal(formatBytes(1073741824), "1.00 GB");
	assert.equal(formatBytes(-1), "-");
	assert.equal(formatBytes(Number.NaN), "-");
});

test("formatMb: fixed MB unit for process monitor", () => {
	assert.equal(formatMb(0), "0.0 MB");
	assert.equal(formatMb(1048576), "1.0 MB");
	assert.equal(formatMb(524288), "0.5 MB");
	assert.equal(formatMb(123456789), "117.7 MB");
	assert.equal(formatMb(-1), "-");
	assert.equal(formatMb(Number.NaN), "-");
});

// ===== 主进程装配：进程枚举与采样链路 =====

test("ProcessMonitor uses array-form system commands with timeout", () => {
	const source = readFileSync("src/main/process/ProcessMonitor.ts", "utf8");
	// 安全规范：命令必须数组参数，禁止字符串拼接 shell
	assert.match(source, /spawn\(args\[0\], args\.slice\(1\)/);
	// Windows 用 PowerShell PrivateMemorySize64（专用内存口径，同任务管理器），
	// Linux/macOS 用 ps -o rss；固定参数数组
	assert.match(source, /\"powershell\"[\s\S]*PrivateMemorySize64/);
	assert.match(source, /\[\"ps\", \"-o\", \"rss=\", \"-p\", String\(pid\)\]/);
	// 超时兜底：采样挂死不阻塞 IPC（超时常量作为 runCollect 第二参数传入）
	assert.match(source, /timeout: timeoutMs/);
	assert.match(source, /TASKLIST_TIMEOUT_MS/);
	// 数组元素可能独占一行：用 PS_TIMEOUT_MS 出现即可（定义处已单独断言常量存在）。
	// 实参可能被格式化换行/位置变化：只断言常量被用作超时实参。
	assert.match(source, /PS_TIMEOUT_MS\)/);
});

test("ProcessMonitor assembles agent snapshot with total", () => {
	const source = readFileSync("src/main/process/ProcessMonitor.ts", "utf8");
	// 只监控 pi agent：不再采集 Electron 自身进程（用户自行在系统任务管理器/活动监视器查看）
	assert.doesNotMatch(source, /app\.getAppMetrics\(\)/);
	assert.doesNotMatch(source, /totalElectronBytes/);
	assert.match(source, /Promise\.all\(/);
	assert.match(source, /totalAgentBytes/);
	assert.match(source, /sampledAt: Date\.now\(\)/);
});

test("AgentManager exposes listAgentPids filtered to running processes", () => {
	const source = readFileSync("src/main/pi/AgentManager.ts", "utf8");
	assert.match(source, /listAgentPids\(\): Array<\{ agentId: string; pid: number \}>/);
	assert.match(source, /runtime\.process\.pid/);
	assert.match(source, /runtime\.process\.isRunning\(\)/);
});

test("PiProcess exposes pid accessor", () => {
	const source = readFileSync("src/main/pi/PiProcess.ts", "utf8");
	assert.match(source, /get pid\(\): number \| undefined/);
	assert.match(source, /return this\.proc\?\.pid;/);
});

// ===== IPC / preload / UI 接线 =====

test("ProcessMetricsTab wires table columns and refresh", () => {
	const source = readFileSync("src/renderer/src/components/app/settings/ProcessMetricsTab.tsx", "utf8");
	assert.match(source, /window\.piDesktop\.system\.getProcessMetrics\(\)/);
	// 只展示 pi agent 行；不再渲染 Electron 进程表（类型/专用内存口径均已移除）
	assert.doesNotMatch(source, /processTypeLabel/);
	assert.doesNotMatch(source, /privateBytes/);
	assert.match(source, /formatMb\(agentTotal\)/);
	assert.match(source, /t\("config\.process\.refresh"\)/);
	assert.match(source, /agent\.agentId/);
	assert.match(source, /t\("config\.process\.empty"\)/);
});

test("SettingsModal registers process tab; ConfigModal no longer hosts it", () => {
	const settings = readFileSync("src/renderer/src/components/app/SettingsModal.tsx", "utf8");
	const config = readFileSync("src/renderer/src/ConfigModal.tsx", "utf8");
	// 进程监控已从 Pi 管理界面迁入设置：SettingsModal 以 TAB_META 注册 tab
	//（labelKey 走 i18n）+ lazy ProcessMetricsTab 渲染；ConfigModal 移除。
	// labelKey 的取值已收敛到 settingsTabLayout.ts 的 SETTINGS_TAB_LABEL_KEYS
	//（命令面板 Ctrl+P 搜设置项复用同一份 key，两处各写一份迟早漂移）。
	assert.match(settings, /process: \{ labelKey: SETTINGS_TAB_LABEL_KEYS\.process/);
	const tabLayout = readFileSync("src/renderer/src/components/app/settings/settingsTabLayout.ts", "utf8");
	assert.match(tabLayout, /process: "settings\.tabs\.process"/);
	assert.match(settings, /activeTab === "process"/);
	assert.match(settings, /<TabsContent value="process"/);
	assert.match(settings, /<ProcessMetricsTab \/>/);
	assert.doesNotMatch(config, /value="process"/);
	assert.doesNotMatch(config, /ProcessMetricsTab/);
});
