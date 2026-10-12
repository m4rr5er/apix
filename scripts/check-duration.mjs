/**
 * `src/lib/duration.ts` 的回归测试。
 *
 * 两个格式化函数都直接决定界面上看到的字样（生成中的计时、归档列表的时间），
 * 而它们的边界（59→60 秒、59→60 分、跨天、时区）正好是最容易写错的地方 ——
 * 所以断言的是**最终字符串**，不是内部算法。
 *
 * 跑法：node scripts/check-duration.mjs
 * 退出码非 0 表示有断言失败。
 */

import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
}

async function load() {
  const dir = mkdtempSync(join(tmpdir(), "apix-duration-"));
  const out = join(dir, "bundle.mjs");
  await build({
    entryPoints: [resolve("src/lib/duration.ts")],
    outfile: out,
    bundle: true,
    format: "esm",
    platform: "node",
    absWorkingDir: process.cwd(),
    nodePaths: [resolve("node_modules")],
    logLevel: "silent",
  });
  const mod = await import(pathToFileURL(out).href);
  return { mod, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const { mod, cleanup } = await load();
const { formatElapsed, formatStamp } = mod;

// ------------------------------------------------------------------- 计时格式
const cases = [
  [0, "0:00"],
  [940, "0:00"],
  [1_000, "0:01"],
  [7_400, "0:07"],
  [59_000, "0:59"],
  [60_000, "1:00"],
  [83_000, "1:23"],
  [12 * 60_000 + 4_000, "12:04"],
  [59 * 60_000 + 59_000, "59:59"],
  [60 * 60_000, "1:00:00"],
  [60 * 60_000 + 2 * 60_000 + 33_000, "1:02:33"],
  [100 * 60 * 60_000, "100:00:00"],
];
for (const [ms, expected] of cases) {
  const actual = formatElapsed(ms);
  check(`formatElapsed(${ms}) === ${expected}`, actual === expected, actual === expected ? "" : `实际 ${actual}`);
}
check("formatElapsed 负数按 0 处理", formatElapsed(-5_000) === "0:00");
check("formatElapsed 向下取整（不足一秒不跳）", formatElapsed(1_999) === "0:01");

// ------------------------------------------------------------------- 时间戳
const stamp = new Date(2026, 9, 10, 9, 5, 42); // 本地时间 2026-10-10 09:05:42
check("formatStamp 补零到分钟", formatStamp(stamp.getTime()) === "2026-10-10 09:05", formatStamp(stamp.getTime()));
check(
  "formatStamp 忽略秒",
  // +17s keeps 09:05:42 inside the same minute (09:05:59), so only the second
  // field differs; +59s would roll into 09:06 and test nothing.
  formatStamp(stamp.getTime()) === formatStamp(stamp.getTime() + 17_000),
);
check(
  "formatStamp 跨零点进位",
  formatStamp(new Date(2026, 11, 31, 23, 59, 59).getTime()) === "2026-12-31 23:59",
  formatStamp(new Date(2026, 11, 31, 23, 59, 59).getTime()),
);

let failed = 0;
for (const { name, ok, detail } of results) {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} 通过`);

cleanup();
process.exitCode = failed === 0 ? 0 : 1;
