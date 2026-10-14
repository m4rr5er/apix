/**
 * 「新会话」视图的三个回归点。
 *
 * **一、没有对话时，压缩上下文不该能点。**
 * 上下文交接会先跑一遍 `apix-context-handoff`（整理工作区 → 写交接文档），再压缩。
 * 在一个还没用过的会话上点它，等于为一个空工作区白烧一个回合、写一份空的交接文档。
 * 所以按钮要禁用，而且禁用时 tooltip 要说清原因；`useHandoff.start()` 里还有第二道闸。
 *
 * **二、点「新会话」时背景不能跳两次。**
 * 背景的 React `key` 原来是 `activeChat?.id ?? state.sessionId ?? "empty"`。
 * 问题在于**创建一个会话就会改 activeChat.id** —— 也就是说，在「新会话」空视图已经
 * 显示着的时候点 "+"，这个 key 会变，React 就把背景卸载重挂，重新随机一张图盖在
 * 原来那张上。用户看到的就是"背景跳两次"（两张不同的背景先后闪过）。
 * 修法是把 key 收敛成只跟工作区走：同一个工作区里的空视图共用一张背景。
 * 多样性没丢——一旦显示过对话，背景本就会被卸载，再回到空视图时必然重新roll。
 *
 * 这里钉住的是 key 的**标识符集合**：它只允许读 `ws.activePath`。谁要是把 chat id
 * 或 sessionId 加回去，这个脚本立刻会红。
 *
 * **三、回到新会话视图时，模型不能跟着消失。**
 * `clearTranscript()` 原来派发的是一个「回到 initialState」的动作，那会把 `model`
 * 一起清成 null —— 可模型是 pi 持有的，不是对话的一部分，而且之后没人再问 pi 要一次。
 * 于是「模型先显示默认值、然后突然变成 —」。
 * 这里直接跑 reducer 复现那条路径，断言模型活下来。
 *
 * 跑法：node scripts/check-newchat.mjs
 */

import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

const APP = readFileSync(join("src", "App.tsx"), "utf8");
const HOOK = readFileSync(join("src", "hooks", "useHandoff.ts"), "utf8");
const BAR = readFileSync(join("src", "components", "CommandBar.tsx"), "utf8");
const WORKSPACES = readFileSync(join("src", "hooks", "useWorkspaces.ts"), "utf8");

// ---------------------------------------------------- 一、压缩上下文的可用性

const COMMAND_BAR = resolve("src/components/CommandBar.tsx");

/** 用 esbuild + react-dom/server 真渲染一次命令栏，看 button 上到底有没有 disabled。 */
async function renderBar(props) {
  const dir = mkdtempSync(join(tmpdir(), "apix-cmdbar-"));
  const entry = join(dir, "entry.tsx");
  const out = join(dir, "bundle.mjs");
  writeFileSync(
    entry,
    `
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CommandBar } from ${JSON.stringify(COMMAND_BAR)};

export function render(props) {
  return renderToStaticMarkup(createElement(CommandBar, props));
}
`,
    "utf8",
  );
  await build({
    entryPoints: [entry],
    bundle: true,
    outfile: out,
    format: "esm",
    platform: "node",
    jsx: "automatic",
    logLevel: "silent",
    // 入口写在临时目录里，所以要显式告诉 esbuild 去哪儿找 react。
    absWorkingDir: process.cwd(),
    nodePaths: [resolve("node_modules")],
    banner: {
      js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
    },
  });
  const mod = await import(pathToFileURL(out).href);
  // Tooltip 用 useLayoutEffect，SSR 下 React 会就此唠叨一句。这个测试只关心
  // button 上有没有 disabled，把这几行噪音挡掉，别让它淹了断言结果。
  const quiet = console.error;
  console.error = () => {};
  try {
    return mod.render({ phase: "idle", hot: false, onCompact: () => {}, ...props });
  } finally {
    console.error = quiet;
    rmSync(dir, { recursive: true, force: true });
  }
}

const idle = await renderBar({ disabled: false });
const blocked = await renderBar({ disabled: true, disabledReason: "这个会话还没有对话内容" });
const hot = await renderBar({ disabled: false, hot: true });

check("可用时按钮不带 disabled", !/disabled/.test(idle), idle.match(/<button[^>]*>/)?.[0] ?? "");
check("禁用时按钮真的带 disabled", /<button[^>]*\bdisabled\b/.test(blocked), blocked.match(/<button[^>]*>/)?.[0] ?? "");
check("禁用时不再显示「交接中」之类的运行态", !/is-running/.test(blocked));
check("上下文偏高时仍带 is-hot（禁用逻辑没把高亮吞掉）", /is-hot/.test(hot));

check(
  "CommandBar 接受 disabledReason",
  /disabledReason\?: string/.test(BAR),
);
check(
  "禁用时 tooltip 用的是 disabledReason（不是一个说不清为什么的死按钮）",
  /: disabled\s*\n\s*\?\s*\(disabledReason \?\? "暂时不可用"\)/.test(BAR),
);

check("App 把「没有对话」与「回合进行中」都算进禁用条件", /disabled=\{!ready \|\| !conversation \|\| pi\.state\.busy\}/.test(APP));
check(
  "App 给出禁用原因（引擎未就绪 / 没有对话内容 / 回合进行中）",
  /引擎还没就绪/.test(APP) && /没有对话内容/.test(APP) && /等当前回合结束后再交接/.test(APP),
);
check(
  "conversation 就是 hasConversation(items)，不是另算一套",
  /const conversation = hasConversation\(pi\.state\.items\)/.test(APP),
);
check(
  "useHandoff.start 里有第二道闸（UI 只是第一道）",
  /if \(!hasConversation\(itemsRef\.current\)\) return;/.test(HOOK),
);
check(
  "第二道闸也挡「回合进行中」（pi 一轮只收一条提示词，硬发会空转到 90 秒超时）",
  /if \(busyRef\.current\) return;/.test(HOOK),
);
check(
  "第二道闸排在「开始交接」的副作用之前",
  HOOK.indexOf("if (!hasConversation(itemsRef.current)) return;") <
    HOOK.indexOf('notify("info", "开始上下文交接'),
);

// 禁用了但看不出来，等于没禁用——用户还是去点它。
const STYLES = readFileSync(join("src", "styles.css"), "utf8");
const disabledRule = /\.cmd-btn:disabled\s*\{([^}]*)\}/.exec(STYLES)?.[1] ?? "";
check("存在 .cmd-btn:disabled 规则", disabledRule.length > 0);
check("禁用时颜色变淡（不只是改 cursor）", /color:\s*var\(--apx-label-4\)/.test(disabledRule), disabledRule.trim().replace(/\s+/g, " "));
check("禁用时描边也变淡", /border-color:\s*var\(--apx-hairline-1\)/.test(disabledRule));
check(
  "禁用时仍然可 hover（否则 tooltip 里的原因永远看不到）",
  /pointer-events:\s*none/.test(disabledRule),
);
check(
  "tooltip 挂在包裹元素上（pointer-events 交给它才有效）",
  /className=\{`tip-host/.test(readFileSync(join("src", "components", "ui", "Tooltip.tsx"), "utf8")),
);

// ------------------------------------------------ 二、背景的 key 只跟工作区走

const backdrop = /<NewChatBackdrop[\s\S]*?\/>/.exec(APP);
check("App 里有且只有一处 NewChatBackdrop", (APP.match(/<NewChatBackdrop/g) ?? []).length === 1);

const keyExpr = backdrop ? /key=\{([^}]*)\}/.exec(backdrop[0])?.[1] : null;
check("背景带 key（它决定什么时候重新 roll）", Boolean(keyExpr), keyExpr ?? "没找到 key");

if (keyExpr) {
  // 关键词法：表达式里出现的标识符路径。字符串字面量要先去掉，`"none"` 不是标识符。
  const identifiers = (
    keyExpr.replace(/"[^"]*"|'[^']*'/g, "").match(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g) ?? []
  ).filter((name) => !["null", "undefined"].includes(name));

  check(
    "key 只读 ws.activePath",
    identifiers.length === 1 && identifiers[0] === "ws.activePath",
    `实际读的是：${identifiers.join(", ") || "(无)"}`,
  );
  for (const banned of ["activeChat", "sessionId", "sessionFile", "chat"]) {
    check(`key 不看 ${banned}（它会在新建会话时变，导致背景重挂）`, !keyExpr.includes(banned));
  }
}

check(
  "addChat 仍然会改 activeChat.id —— 这正是当初不能用 chat id 当 key 的原因",
  /chats: \[chat, \.\.\.w\.chats\], activeChat: chat\.id/.test(WORKSPACES),
);
check(
  "条件渲染用的也是 conversation（与禁用条件同源）",
  /\{!conversation \? \(/.test(APP),
);
check(
  "旧写法（activeChat?.id ?? sessionId ?? \"empty\"）已不存在",
  !/key=\{ws\.activeChat\?\.id/.test(APP),
);

// ------------------------------------ 三、回到新会话视图时模型不能跟着消失

/** 把纯 reducer 打成一个包来跑——它只依赖 protocol.ts 里的类型和一个标签函数。 */
async function loadReducer() {
  const dir = mkdtempSync(join(tmpdir(), "apix-reducer-"));
  const out = join(dir, "bundle.mjs");
  const entry = join(dir, "entry.ts");
  writeFileSync(
    entry,
    `export { reduce, initialState } from ${JSON.stringify(
      resolve("src/lib/reducer.ts").replace(/\\/g, "/"),
    )};`,
    "utf8",
  );
  await build({
    entryPoints: [entry],
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

const { mod: reducer, cleanup: dropReducer } = await loadReducer();

/** 一条 `get_state` 响应，按 reducer 期望的形状喂进去。 */
const stateFrom = (data) => ({
  kind: "record",
  record: { type: "response", command: "get_state", success: true, data },
});

// 引擎就绪后的样子：默认模型 + 一个会话 + 一段对话。
let live = reducer.reduce(reducer.initialState, stateFrom({
  model: { provider: "AI-AAA", id: "deepseek-v4.1-flash" },
  thinkingLevel: "medium",
  sessionId: "01a12eb1-shape",
  sessionFile: "C:\\sessions\\x.jsonl",
  messageCount: 3,
}));
live = reducer.reduce(live, { kind: "notice", level: "info", text: "先塞一条，用来验证清空确实清空了" });
check("准备：引擎状态里有模型、会话和内容", Boolean(live.model) && live.items.length === 1);

// 打开一个没有会话的工作区 → 走的就是 `clearTranscript()`。
const cleared = reducer.reduce(live, { kind: "clearTranscript" });

check("清空对话后，对话确实清空了", cleared.items.length === 0);
check(
  "清空对话后，模型还在（这正是「模型突然变成 —」的那条路径）",
  cleared.model === live.model,
  `model=${JSON.stringify(cleared.model)}`,
);
check("清空对话后，思考档位还在", cleared.thinkingLevel === live.thinkingLevel);
check("清空对话后，会话 id / 文件还在", cleared.sessionId === live.sessionId && cleared.sessionFile === live.sessionFile);
check("清空对话后，busy 不被伪造", cleared.busy === live.busy);
check("清空对话后，队列也清了", cleared.queued.steering.length === 0 && cleared.queued.followUp.length === 0);
check(
  "没有别的动作能整体回到 initialState（那个动作已删除）",
  !/"reset"/.test(readFileSync(join("src", "lib", "reducer.ts"), "utf8").split("export type Action")[1].split(";")[0]),
);
check(
  "usePi 不再派发 reset（清空一律走 clearTranscript）",
  !/kind: "reset"/.test(readFileSync(join("src", "hooks", "usePi.ts"), "utf8")),
);

// ------------------------------------------- 四、引擎重启不得把 busy 卡成永久真
//
// 实测事故：新工作区发第一条消息 → 旧进程记下 user 消息后引擎重启 →
// 迟到的 agent_start 把 busy 钉在 true（它只能被 agent_settled 清掉，而死进程
// 不会再发任何事件），中断按钮对着空闲的新进程发 abort，等于没按。
// 修法两层：Rust 给每条 record 盖代际号、前端丢弃旧代际；start() 派发
// engineReset 把 busy 强制归零（新进程上不可能有在跑的回合）。

const busyState = reducer.reduce(reducer.initialState, { kind: "record", record: { type: "agent_start" } });
check("前提：agent_start 会把 busy 置真", busyState.busy === true);

const afterReset = reducer.reduce(
  { ...busyState, queued: { steering: ["x"], followUp: [] }, items: [{ kind: "assistant", streaming: true, key: "a", text: "半句" }] },
  { kind: "engineReset" },
);
check("engineReset 清掉 busy（新进程没有在跑的回合）", afterReset.busy === false);
check("engineReset 清掉排队", afterReset.queued.steering.length === 0 && afterReset.queued.followUp.length === 0);
check(
  "engineReset 把流式行落盘（不再呼吸），但不删内容",
  afterReset.items.length === 1 && afterReset.items[0].streaming === false && afterReset.items[0].text === "半句",
);
check("engineReset 不动模型与会话绑定", afterReset.model === busyState.model && afterReset.sessionFile === busyState.sessionFile);

const usePiSrc = readFileSync(join("src", "hooks", "usePi.ts"), "utf8");
const piRs = readFileSync(join("src-tauri", "src", "pi.rs"), "utf8");
check(
  "Rust 把每条 record 连同代际号发出（旧进程的事件带着自己的出生代数）",
  /emit\(\s*EVT_RECORD\s*,\s*json!\(\{[^}]*"gen"/.test(piRs),
  piRs.match(/emit\(\s*EVT_RECORD[^)]*\)/)?.[0]?.replace(/\s+/g, " ") ?? "",
);
check(
  "running 状态事件也带代际号（前端先认代数，再收事件）",
  /"state":\s*"running"[\s\S]{0,240}"gen"/.test(piRs),
);
check(
  "usePi 按槽位丢弃旧代际的 record（stale 事件进不了 reducer）",
  /genBySlot\.current/.test(usePiSrc) && /gen\s*<\s*\(genBySlot\.current\.get\(slot\)/.test(usePiSrc),
);
check(
  "usePi 的 start() 派发 engineReset",
  /const start = useCallback\([\s\S]*?dispatch\(\{ kind: "engineReset" \}\)/.test(usePiSrc),
);

dropReducer();

// ---------------------------------------------------------------------- 汇总

let failed = 0;
for (const { name, ok, detail } of results) {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} 通过`);
process.exitCode = failed === 0 ? 0 : 1;
