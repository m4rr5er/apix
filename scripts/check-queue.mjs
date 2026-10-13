/**
 * 队列操作（编辑 / 删除 / 立即注入）的回归测试。
 *
 * pi 没有逐项队列命令：`clear_queue` 整队取回，`steer`/`follow_up` 按桶重排。
 * 所以三个操作全是「取空 → 摘一项 → 其余归位」，这套算术错一次就会
 * 把用户排好的提示词弄丢，因此 flatten/remove/requeue 全部真跑，
 * QueueDock 用 react-dom/server 真渲染，按钮少一个都会红。
 *
 * 跑法：node scripts/check-queue.mjs
 */

import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

/** configBridge 顶层 import 了 Tauri 的 invoke，测试里必须有东西替它。 */
const stubTauri = {
  name: "stub-tauri",
  setup(b) {
    b.onResolve({ filter: /^@tauri-apps\/api\/core$/ }, () => ({ path: "core", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: "export async function invoke() { throw new Error('测试环境没有宿主') }",
      loader: "js",
    }));
  },
};

async function bundle(entrySource) {
  const dir = mkdtempSync(join(tmpdir(), "apix-queue-"));
  const out = join(dir, "bundle.mjs");
  const entry = join(dir, "entry.ts");
  writeFileSync(entry, entrySource, "utf8");
  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    format: "esm",
    platform: "node",
    jsx: "automatic",
    absWorkingDir: process.cwd(),
    nodePaths: [resolve("node_modules")],
    plugins: [stubTauri],
    logLevel: "silent",
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  });
  const mod = await import(pathToFileURL(out).href);
  return { mod, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const p = (file) => JSON.stringify(resolve(file).replace(/\\/g, "/"));

async function main() {
  const { mod, cleanup } = await bundle(
    `export { flattenQueue, removeTask, requeueCommands } from ${p("src/lib/queue.ts")};`,
  );
  const { flattenQueue, removeTask, requeueCommands } = mod;

  // ------------------------------------------------------------- 纯函数算术
  const tasks = flattenQueue(["改一下标题", "配色换暖色"], ["最后跑一遍检查"]);
  check("展平顺序与界面一致：先追加(steer)后排队(follow-up)",
    tasks.map((t) => t.text).join("|") === "改一下标题|配色换暖色|最后跑一遍检查");
  check("kind 标记正确", tasks[0].kind === "steer" && tasks[2].kind === "follow-up");

  const removed = removeTask(tasks, "follow-up", 2);
  check("摘除 follow-up 项", removed.target?.text === "最后跑一遍检查" && removed.rest.length === 2);
  check("其余保持原序", removed.rest.map((t) => t.text).join("|") === "改一下标题|配色换暖色");

  const stale = removeTask(tasks, "steer", 9);
  check("索引失效（pi 已在边界吃掉一条）→ target 为 null，队列原样交回",
    stale.target === null && stale.rest.length === 3);

  const cmds = requeueCommands(removed.rest.concat([removed.target]));
  check("重排命令按桶映射：steer→steer、follow-up→follow_up，顺序不变",
    JSON.stringify(cmds.map((c) => c.type)) === JSON.stringify(["steer", "steer", "follow_up"]),
    JSON.stringify(cmds));
  check("重排命令携带原文", cmds.every((c, i) => c.message === tasks[i].text));

  // ------------------------------------------------------- QueueDock 真渲染
  const { mod: dock, cleanup: dropDock } = await bundle(`
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueueDock } from ${p("src/components/QueueDock.tsx")};
export function render(props) { return renderToStaticMarkup(createElement(QueueDock, props)); }`);
  // 一条时不折叠，动作区才会渲染进静态 HTML（多条默认收起是设计行为）。
  const html = dock.render({
    steering: ["甲"],
    followUp: [],
    onInject: () => {},
    onEdit: () => {},
    onDelete: () => {},
  });
  check("队列项有「立即插入」", html.includes('aria-label="立即插入 甲"'));
  check("队列项有「编辑」", html.includes('aria-label="编辑这条追加 0"'));
  check("队列项有「删除」", html.includes('aria-label="删除这条追加 0"'));
  check("动作区随 hover 出现（类名存在，默认 opacity 0 由样式表负责）",
    html.includes("queue-dock-actions"));
  const collapsed = dock.render({
    steering: ["甲", "乙"],
    followUp: [],
    onInject: () => {},
    onEdit: () => {},
    onDelete: () => {},
  });
  check("多条时默认折叠成计数（不遮挡输入框）", collapsed.includes("2 条待处理") && !collapsed.includes("queue-dock-actions"));

  // ---------------------------------------------------------------- 接线
  const usePi = readFileSync(join("src", "hooks", "usePi.ts"), "utf8");
  const queueLib = readFileSync(join("src", "lib", "queue.ts"), "utf8");
  check("usePi 用 clear_queue 整队取回（pi 没有逐项命令，这是唯一取回路）",
    /"clear_queue"/.test(usePi));
  check("重放命令按桶映射：steer 与 follow_up 两个 RPC 都存在",
    /"steer"/.test(queueLib) && /"follow_up"/.test(queueLib));
  check("usePi 暴露 queueOp（inject / edit / delete 三种模式）",
    /queueOp/.test(usePi) && /"inject"|"edit"|"delete"/.test(usePi));
  check("取回后若索引失效，整队原样放回并报错（丢用户排队内容是不可接受的）",
    /rest/.test(usePi) && /requeueCommands/.test(usePi));

  const app = readFileSync(join("src", "App.tsx"), "utf8");
  check("App 把三个操作接到 QueueDock",
    /onInject=\{/.test(app) && /onEdit=\{/.test(app) && /onDelete=\{/.test(app));
  check("编辑走 composer 种子（复用「编辑这一轮」同一条路）",
    /setSeed\(/.test(app));

  cleanup();
  dropDock();

  let failed = 0;
  for (const { name, ok, detail } of results) {
    if (!ok) failed += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  }
  console.log(`\n${results.length - failed}/${results.length} 通过`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});