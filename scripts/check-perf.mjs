/**
 * 「用久了打字发涩」的性能修复接线回归。
 *
 * 三处开销各钉一条，全是实测定位的：
 *   1. 每条 record 都 JSON.stringify 进 logs → 每个 token 复制一遍 400 条数组
 *      并整树重渲染；热类型必须跳过。
 *   2. transcript 行没有 memo → 流式期间每秒重渲染全部历史；行必须是
 *      memo 组件，且 App 传的是稳定回调（inline 箭头会让 memo 失效）。
 *   3. 长 DOM 的强制 reflow（输入框 resize 读 scrollHeight）→ 离屏行要有
 *      content-visibility，否则几百屏后每次按键都重排整个 transcript。
 *
 * 跑法：node scripts/check-perf.mjs
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

const usePi = readFileSync(join("src", "hooks", "usePi.ts"), "utf8");
const transcript = readFileSync(join("src", "components", "Transcript.tsx"), "utf8");
const app = readFileSync(join("src", "App.tsx"), "utf8");
const css = readFileSync(join("src", "styles.css"), "utf8");

check(
  "热记录（delta/update 类）不进日志（不 stringify、不 setLogs）",
  /HOT_RECORDS/.test(usePi) &&
    /text_delta/.test(usePi) &&
    /thinking_delta/.test(usePi) &&
    /message_update/.test(usePi) &&
    /tool_execution_update/.test(usePi) &&
    /if \(!HOT_RECORDS\.has\(String\(record\.type\)\)\) \{\s*addLog\("record"/.test(usePi),
);

check("四种回合行都是 memo 组件",
  /const UserRow = memo\(function UserRow/.test(transcript) &&
    /const AssistantRow = memo\(function AssistantRow/.test(transcript) &&
    /const ToolRow = memo\(function ToolRow/.test(transcript) &&
    /const NoticeRow = memo\(function NoticeRow/.test(transcript));
check("reducer 保持未变 item 的对象身份（memo 的前提）",
  /copy\[index\] = patch\(item\)/.test(readFileSync(join("src", "lib", "reducer.ts"), "utf8")));
check(
  "App 传给 Transcript 的回调是稳定引用（没有 inline 箭头）",
  /onCopyTurn=\{handleCopyTurnStable\}/.test(app) &&
    /onEditTurn=\{handleEditTurnStable\}/.test(app) &&
    /onDeleteTurn=\{handleDeleteTurn\}/.test(app),
);

check(
  "回合行不得用 content-visibility（离屏估算高度会让滚动上下跳）",
  !/\.transcript > \.row\s*\{[^}]*content-visibility/.test(css),
);

let failed = 0;
for (const { name, ok, detail } of results) {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} 通过`);
process.exitCode = failed === 0 ? 0 : 1;
