/**
 * 持久化往返测试：**存**（state.json）× **取**（normalize）× **还原**（resolveChatSession）。
 *
 * 用户要保证的是"建好带历史的会话 → 完全退出 → 重开还能看到它"。这条链路横跨三处，
 * 任何一处判错都会表现为"会话打不开"或"内容没了"，所以这里用**真实临时目录里的真实
 * 文件**跑一遍：先造出会话文件，再造一份引用它们的 state.json，然后走完整套读取判定，
 * 断言每个会话落回它自己的那一个文件。
 *
 * 最后一组用例是回归：两个会话争抢同一份可认领记录时，抢输的那个**不许**被换成新会话
 * （那会把回到真实记录的唯一指针覆盖掉——这正是索引里出现"指向不存在文件"的成因）。
 *
 * 跑法：node scripts/check-persistence.mjs
 * 退出码非 0 表示有断言失败。
 */

import { build } from "esbuild";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
}

/** 渲染期不会用到 Tauri，但模块顶层 import 了 invoke，必须有东西替它。 */
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

async function loadModules() {
  const dir = mkdtempSync(join(tmpdir(), "apix-persist-"));
  const out = join(dir, "bundle.mjs");
  const entry = join(dir, "entry.ts");
  writeFileSync(
    entry,
    `export { normalize, liveChats } from ${JSON.stringify(
      resolve("src/hooks/useWorkspaces.ts").replace(/\\/g, "/"),
    )};
export { resolveChatSession } from ${JSON.stringify(
      resolve("src/lib/sessionRecovery.ts").replace(/\\/g, "/"),
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
    plugins: [stubTauri],
    logLevel: "silent",
  });
  const mod = await import(pathToFileURL(out).href);
  return { mod, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// --------------------------------------------------------------- 真实文件系统

/** 造一个真工作区目录 + 真会话目录（文件名与 pi 一致）。 */
function makeWorkspace(root, name, sessions) {
  const cwd = join(root, name);
  mkdirSync(cwd, { recursive: true });
  const dirName = `--${cwd.replace(/^[/\\]/, "").replace(/[/:\\]/g, "-")}--`;
  const sessionDir = join(root, "sessions", dirName);
  mkdirSync(sessionDir, { recursive: true });
  const files = [];
  for (const { stamp, uuid, bytes } of sessions) {
    const fileName = `${stamp.replace(/[:.]/g, "-")}_${uuid}.jsonl`;
    const path = join(sessionDir, fileName);
    writeFileSync(path, "x".repeat(bytes), "utf8");
    files.push({ path, fileName, modifiedMs: Date.parse(stamp), size: bytes });
  }
  return { cwd, sessionDir, files };
}

const ISO = (ms) => new Date(ms).toISOString();

async function main() {
  const { mod, cleanup } = await loadModules();
  const { normalize, liveChats, resolveChatSession } = mod;

  const root = mkdtempSync(join(tmpdir(), "apix-ws-"));
  try {
    // ------------------------------------------------------------ 载入规则
    const legacy = normalize([
      // 早于归档功能的状态文件：没有 archivedAt；没有 chats 字段
      { path: "C:\\a", name: "a", activeChat: "c1" },
      // activeChat 指向一个不存在的会话 → 归 null，而不是凭空造一个
      { path: "C:\\b", name: "b", chats: [], activeChat: "ghost" },
      // activeChat 指向归档会话 → 不合法，退到第一个未归档的
      {
        path: "C:\\c", name: "c", activeChat: "old",
        chats: [
          { id: "old", name: "旧", sessionFile: null, createdAt: 1, archivedAt: 42 },
          { id: "new", name: "新", sessionFile: null, createdAt: 2, archivedAt: null },
        ],
      },
      "不是对象",
    ]);
    check("旧状态文件载入后 chats 为空数组", legacy[0].chats.length === 0);
    check("旧状态文件载入后 activeChat 为 null（不造占位会话）", legacy[0].activeChat === null);
    check("activeChat 指向不存在的会话 → null", legacy[1].activeChat === null);
    check("activeChat 指向归档会话 → 退到未归档的那个", legacy[2].activeChat === "new");
    check("归档会话不出现在 liveChats 里", liveChats(legacy[2]).length === 1);
    check("非对象条目被丢弃", legacy.length === 3);

    // ------------------------------------------------- 存 → 取 → 还原 往返
    // 三个场景：正常绑定 / 需要认领（记录被顶掉）/ 从未落盘
    const healthy = makeWorkspace(root, "healthy", [
      { stamp: "2026-10-10T02:00:00.000Z", uuid: "aaaa0000-0000-7000-8000-000000000001", bytes: 900 },
    ]);
    const adopted = makeWorkspace(root, "adopted", [
      { stamp: "2026-10-10T02:00:00.500Z", uuid: "bbbb0000-0000-7000-8000-000000000002", bytes: 1200 },
    ]);
    const never = makeWorkspace(root, "never", []);

    const saved = {
      workspaces: [
        {
          path: healthy.cwd, name: "healthy", activeChat: "h1",
          chats: [{ id: "h1", name: "有历史", createdAt: Date.parse("2026-10-10T02:00:00.000Z"), archivedAt: null,
            sessionFile: healthy.files[0].path }],
        },
        {
          path: adopted.cwd, name: "adopted", activeChat: "a1",
          chats: [{ id: "a1", name: "记录被顶掉", createdAt: Date.parse("2026-10-10T01:59:59.900Z"), archivedAt: null,
            // 登记的是被顶掉的那条（不存在），真实内容在 500ms 后的兄弟文件里
            sessionFile: join(adopted.sessionDir, "2026-10-10T02-00-00-100Z_bbbb0000-0000-7000-8000-000000000001.jsonl") }],
        },
        {
          path: never.cwd, name: "never", activeChat: "n1",
          chats: [{ id: "n1", name: "从未落盘", createdAt: Date.parse("2026-10-10T03:00:00.000Z"), archivedAt: null,
            sessionFile: join(never.sessionDir, "2026-10-10T03-00-00-000Z_cccc0000-0000-7000-8000-000000000001.jsonl") }],
        },
      ],
    };

    // 重新载入（模拟重启），再按运行时的方式逐会话判定
    const loaded = normalize(saved.workspaces);

    const resolveOne = (workspace, chat, files) =>
      resolveChatSession({
        chat,
        siblings: workspace.chats.filter((c) => c.id !== chat.id),
        listing: {
          dir: workspace.path,
          files,
          recordedExists: files.some((f) => f.path === chat.sessionFile),
        },
      });

    const healthyTarget = resolveOne(loaded[0], loaded[0].chats[0], healthy.files);
    check(
      "有历史的会话重启后 → resume 到同一个文件（内容和状态都能还原）",
      healthyTarget.kind === "resume" && healthyTarget.path === healthy.files[0].path,
      healthyTarget.kind,
    );

    const adoptedTarget = resolveOne(loaded[1], loaded[1].chats[0], adopted.files);
    check(
      "记录被顶掉的会话 → adopt 到时间最近的兄弟文件",
      adoptedTarget.kind === "adopt" && adoptedTarget.path === adopted.files[0].path,
      adoptedTarget.kind === "adopt" ? adoptedTarget.path : adoptedTarget.kind,
    );

    const neverTarget = resolveOne(loaded[2], loaded[2].chats[0], never.files);
    check(
      "从未落盘的会话 → reopen（按登记路径重开，绑定原样保留，不换新会话）",
      neverTarget.kind === "reopen" && neverTarget.path === loaded[2].chats[0].sessionFile,
      neverTarget.kind,
    );
    check("空目录里的会话仍然带着自己的绑定", Boolean(loaded[2].chats[0].sessionFile));

    // ---------------------------------------------------------- 回归：争抢
    // 两个会话的登记都被顶掉，而目录里只有一份可认领的真实记录。
    // 抢到的那一个 adopt；抢输的那一个绝不能变成 fresh（那会覆盖掉回到真实记录的指针）。
    const contest = makeWorkspace(root, "contest", [
      { stamp: "2026-10-10T02:00:01.000Z", uuid: "dddd0000-0000-7000-8000-000000000009", bytes: 800 },
    ]);
    const contested = normalize([
      {
        path: contest.cwd, name: "contest", activeChat: "x1",
        chats: [
          { id: "x1", name: "甲", createdAt: Date.parse("2026-10-10T02:00:00.900Z"), archivedAt: null,
            sessionFile: join(contest.sessionDir, "2026-10-10T02-00-00-100Z_dddd0000-0000-7000-8000-000000000001.jsonl") },
          { id: "x2", name: "乙", createdAt: Date.parse("2026-10-10T02:00:59.000Z"), archivedAt: null,
            sessionFile: join(contest.sessionDir, "2026-10-10T02-00-59-000Z_dddd0000-0000-7000-8000-000000000002.jsonl") },
        ],
      },
    ]);
    const winner = resolveOne(contested[0], contested[0].chats[0], contest.files);
    const loser = resolveOne(contested[0], contested[0].chats[1], contest.files);
    check(
      "争抢时最接近的那个认领成功",
      winner.kind === "adopt" && winner.path === contest.files[0].path,
      winner.kind,
    );
    check(
      "争抢失败的那个保持原绑定（reopen），不会被换成新会话",
      loser.kind === "reopen" && loser.path === contested[0].chats[1].sessionFile,
      `${loser.kind}${loser.reason ? `/${loser.reason}` : ""}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  let failed = 0;
  for (const { name, ok, detail } of results) {
    if (!ok) failed += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  }
  console.log(`\n${results.length - failed}/${results.length} 通过`);

  cleanup();
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
