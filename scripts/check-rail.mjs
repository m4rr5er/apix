/**
 * `src/components/WorkspaceRail.tsx` 的结构回归测试。
 *
 * 这次改造要的就是「按工作区分组、会话缩进挂在各自工作区下面」这个层级，而层级
 * 恰恰是最容易在后续改动里被悄悄压平的东西（比如把 chats 提到和 workspaces 同级）。
 * 所以这里断言渲染出来的 HTML 结构本身：分组数量、会话是否真的嵌在所属工作区的
 * `.rail-sessions` 里、折叠后是否真的不再渲染会话行、空工作区是否有占位文案。
 *
 * 用 esbuild 把组件打成临时包（`@tauri-apps/plugin-dialog` 换成桩），再用
 * react-dom/server 输出静态 HTML —— 不需要 jsdom。
 *
 * 跑法：node scripts/check-rail.mjs
 * 退出码非 0 表示有断言失败。
 */

import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const RAIL = resolve("src/components/WorkspaceRail.tsx");

const ENTRY = `
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspaceRail } from ${JSON.stringify(RAIL)};

export function render(props) {
  return renderToStaticMarkup(createElement(WorkspaceRail, props));
}
`;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
}

/** 数一个类名出现的次数。`rail-chat-title` 不该被算进 `rail-chat`。 */
function countClass(html, name) {
  return (html.match(new RegExp(`class="${name}(?=[ "])`, "g")) || []).length;
}

/** `@tauri-apps/plugin-dialog` 在 node 里没有宿主，替换成什么也不做的桩。 */
const stubDialogPlugin = {
  name: "stub-dialog",
  setup(build) {
    build.onResolve({ filter: /^@tauri-apps\/plugin-dialog$/ }, () => ({
      path: "dialog-stub",
      namespace: "stub",
    }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: "export async function open() { return null; }",
      loader: "js",
    }));
  },
};

/** 组件在渲染期会读 `window.localStorage`，SSR 下需要这个最小替身。 */
function installLocalStorage(initial) {
  const store = new Map(Object.entries(initial ?? {}));
  globalThis.window = globalThis.window ?? {};
  globalThis.window.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  return store;
}

async function loadRail() {
  const dir = mkdtempSync(join(tmpdir(), "apix-rail-"));
  const entry = join(dir, "entry.jsx");
  const out = join(dir, "bundle.mjs");
  writeFileSync(entry, ENTRY, "utf8");
  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    format: "esm",
    platform: "node",
    jsx: "automatic",
    absWorkingDir: process.cwd(),
    nodePaths: [resolve("node_modules")],
    plugins: [stubDialogPlugin],
    banner: {
      js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
    },
    logLevel: "silent",
  });
  const mod = await import(pathToFileURL(out).href);
  return { render: mod.render, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const noop = () => {};
const ALPHA = "C:\\projects\\alpha";
const BETA = "C:\\projects\\beta";
const GAMMA = "C:\\projects\\gamma";

const WORKSPACES = [
  {
    path: ALPHA,
    name: "alpha",
    activeChat: "c2",
    chats: [
      { id: "c1", name: "会话一", sessionFile: null, createdAt: 1, archivedAt: null },
      {
        id: "c2",
        name: "会话二",
        sessionFile: `${ALPHA}\\.pi\\s.jsonl`,
        createdAt: 2,
        archivedAt: null,
      },
      // Archived: archived chats are not rail content.
      {
        id: "c3",
        name: "已归档的会话",
        sessionFile: `${ALPHA}\\.pi\\s3.jsonl`,
        createdAt: 3,
        archivedAt: 1_700_000_000_000,
      },
    ],
  },
  { path: BETA, name: "beta", activeChat: null, chats: [] },
  // Every chat archived: the workspace has nothing valid to show either.
  {
    path: GAMMA,
    name: "gamma",
    activeChat: null,
    chats: [
      {
        id: "d1",
        name: "gamma 已归档会话",
        sessionFile: `${GAMMA}\\.pi\\s1.jsonl`,
        createdAt: 7,
        archivedAt: 1_700_000_100_000,
      },
    ],
  },
];

const BASE_PROPS = {
  workspaces: WORKSPACES,
  activePath: ALPHA,
  activeChatId: "c2",
  engineRunning: true,
  onAddWorkspace: noop,
  onSelectWorkspace: noop,
  onRemoveWorkspace: noop,
  onRenameWorkspace: noop,
  onAddChat: noop,
  onSelectChat: noop,
  onRenameChat: noop,
  onRemoveChat: noop,
  onArchiveChat: noop,
  onOpenSettings: noop,
  onRestartEngine: noop,
};

async function main() {
  const { render, cleanup } = await loadRail();

  // 消掉 React 在 SSR 下对 useLayoutEffect 的告警：Tooltip 用它做定位测量，
  // 服务端渲染本来就不该跑，不是问题。
  const realError = console.error;
  console.error = (...args) => {
    if (String(args[0]).includes("useLayoutEffect does nothing on the server")) return;
    realError(...args);
  };

  installLocalStorage({});
  const html = render(BASE_PROPS);

  check("每个工作区渲染一个 .rail-group", countClass(html, "rail-group") === 3, `= ${countClass(html, "rail-group")}`);
  check("每个展开的工作区渲染一个 .rail-sessions", countClass(html, "rail-sessions") === 3, `= ${countClass(html, "rail-sessions")}`);
  check("顶层是 role=tree", html.includes('role="tree"'));
  check("会话容器是 role=group", countClass(html, "rail-sessions") === (html.match(/role="group"/g) || []).length);
  check("只渲染属于工作区的 2 条会话", countClass(html, "rail-chat") === 2, `= ${countClass(html, "rail-chat")}`);
  check("工作区标题渲染", html.includes(">alpha<") && html.includes(">beta<") && html.includes(">gamma<"));
  check("会话标题渲染", html.includes("会话一") && html.includes("会话二"));

  // A workspace with no sessions — brand new, or with its last one archived —
  // must stay bare. The "新会话" placeholder row this replaced was the complaint.
  check("空工作区没有占位文案", countClass(html, "rail-empty") === 0, `= ${countClass(html, "rail-empty")}`);
  check("完全没有会话的工作区不渲染任何会话行", !html.includes("gamma 已归档会话"));
  // The container for the last (empty) workspace must hold nothing at all.
  const lastGroup = html.lastIndexOf('class="rail-group"');
  const emptyTail = html.slice(lastGroup);
  check(
    "空工作区下的分组容器确实是空的",
    emptyTail.includes('class="rail-sessions"') && !emptyTail.includes('class="rail-chat'),
    `tail len ${emptyTail.length}`,
  );

  check("当前会话带 is-active", countClass(html, "rail-chat is-active") === 1, `= ${countClass(html, "rail-chat is-active")}`);
  check("当前工作区带 is-active", countClass(html, "rail-group-head is-active") === 1, `= ${countClass(html, "rail-group-head is-active")}`);
  check("未绑定会话有标记", html.includes("未绑定"));
  check("展开状态写在 aria-expanded 上", (html.match(/aria-expanded="true"/g) || []).length === 3);
  // Archiving is a rail-level filter: the chat keeps existing (and keeps owning
  // its session file) but must not be rendered here.
  check("归档会话不出现在左侧栏", !html.includes("已归档的会话"));
  check("归档会话不影响其余会话计数", countClass(html, "rail-chat") === 2, `= ${countClass(html, "rail-chat")}`);

  // 层级：会话必须排在所属工作区的 .rail-sessions 之内 —— 即第一个 .rail-chat
  // 落在第一个 .rail-sessions 之后、第二个 .rail-group 之前。
  const sessionsAt = html.indexOf('class="rail-sessions"');
  const firstChatAt = html.indexOf('class="rail-chat');
  const secondGroupAt = html.indexOf('class="rail-group"', html.indexOf('class="rail-group"') + 1);
  check(
    "会话嵌在所属工作区的分组容器内（层级未被压平）",
    sessionsAt > -1 && firstChatAt > sessionsAt && firstChatAt < secondGroupAt,
    `sessions@${sessionsAt} chat@${firstChatAt} group2@${secondGroupAt}`,
  );
  check(
    "工作区头部排在它的会话之前",
    html.indexOf('class="rail-group-head') < sessionsAt,
  );

  // 折叠：localStorage 里记着 alpha 折叠 → 不再渲染它的会话行，只留头部。
  installLocalStorage({ "apix.rail.groups": JSON.stringify({ [ALPHA]: false }) });
  const collapsed = render(BASE_PROPS);
  check("折叠的工作区不渲染会话行", countClass(collapsed, "rail-chat") === 0, `= ${countClass(collapsed, "rail-chat")}`);
  check("折叠的工作区保留头部", countClass(collapsed, "rail-group-head") === 3, `= ${countClass(collapsed, "rail-group-head")}`);
  check("折叠状态写进 aria-expanded", (collapsed.match(/aria-expanded="false"/g) || []).length === 1);
  check("折叠的工作区不渲染分组容器", countClass(collapsed, "rail-sessions") === 2, `= ${countClass(collapsed, "rail-sessions")}`);

  console.error = realError;

  let failed = 0;
  for (const { name, ok, detail } of results) {
    if (!ok) failed += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
  }
  console.log(`\n${results.length - failed}/${results.length} 通过`);

  cleanup();
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
