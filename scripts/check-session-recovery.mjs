/**
 * `src/lib/sessionRecovery.ts` 的回归测试。
 *
 * 这个模块决定"重新打开会话时到底恢复哪一个文件"，判错一次就会把用户的对话换
 * 成一段空白。所以断言分两部分：
 *
 *   1. 合成用例 —— 覆盖 resume / adopt / fresh 三条路径和全部拒收条件；
 *   2. 真实回放 —— 用实际观测到的三个损坏 chat（state.json 里登记的路径已不在
 *      磁盘上）作为固定用例，断言它们仍然能被正确认领或正确放弃。
 *
 * 跑法：node scripts/check-session-recovery.mjs
 *       node scripts/check-session-recovery.mjs --live   # 额外打印当前 state.json 的判定结果
 * 退出码非 0 表示有断言失败。
 */

import { build } from "esbuild";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MODULE = resolve("src/lib/sessionRecovery.ts");

const results = [];

function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
}

async function loadModule() {
  const dir = mkdtempSync(join(tmpdir(), "apix-recovery-"));
  const out = join(dir, "bundle.mjs");
  await build({
    entryPoints: [MODULE],
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

/** 造一个会话文件名，形状与 pi 的完全一致。 */
function sessionName(iso, uuid) {
  return `${iso.replace(/[:.]/g, "-")}_${uuid}.jsonl`;
}

function file(dir, iso, uuid, size = 4096) {
  return { path: `${dir}\\${sessionName(iso, uuid)}`, fileName: sessionName(iso, uuid), modifiedMs: Date.parse(iso), size };
}

const DIR = "C:\\projects\\demo";

// ---------------------------------------------------------------- 真实回放用例
//
// 三条都是从用户机器上实测到的：登记的 sessionFile 与磁盘上的文件差了 300–500ms
// 和一个 uuid（同一毫秒附近创建了两次会话，被记录的是被顶掉的那条）。

const REAL_CASES = [
  {
    name: "default 工作区：登记的 09:55:05.798 已不在，应认领 09:55:06.183",
    createdAt: Date.parse("2026-10-09T09:54:57.043Z"),
    recorded: `${DIR}\\${sessionName("2026-10-09T09:55:05.798Z", "01a12016-77c6-7049-a4ec-fdfedf40b379")}`,
    files: [
      file(DIR, "2026-10-09T07:04:32.694Z", "01a11f7a-52b5-77cd-8693-07f1a1e5e89f", 14362),
      file(DIR, "2026-10-09T07:23:52.093Z", "01a11f8c-039c-7017-9d7f-e0f0541e503d", 8783),
      file(DIR, "2026-10-09T07:50:33.220Z", "01a11fa4-7204-751b-ba8f-ab0267e40766", 10030),
      file(DIR, "2026-10-09T08:42:24.021Z", "01a11fd3-e995-7245-9782-ca94eee20a22", 15531),
      file(DIR, "2026-10-09T09:55:06.183Z", "01a12016-7947-7049-a4ec-fe024ec4b122", 9830),
    ],
    expect: { kind: "adopt", fileName: sessionName("2026-10-09T09:55:06.183Z", "01a12016-7947-7049-a4ec-fe024ec4b122") },
  },
  {
    name: "9480_ios / ios：登记的 01:09:42.515 已不在，应认领 01:09:42.971",
    createdAt: Date.parse("2026-10-10T01:09:40.979Z"),
    recorded: `${DIR}\\${sessionName("2026-10-10T01:09:42.515Z", "01a1235b-d1f2-7461-b0fa-12244573f545")}`,
    files: [
      file(DIR, "2026-10-09T08:50:19.927Z", "01a11fdb-2c97-7476-841f-a562ddbf2c87", 46669),
      file(DIR, "2026-10-10T01:09:42.971Z", "01a1235b-d3bb-7461-b0fa-1227cf3a71a3", 241383),
    ],
    expect: { kind: "adopt", fileName: sessionName("2026-10-10T01:09:42.971Z", "01a1235b-d3bb-7461-b0fa-1227cf3a71a3") },
  },
  {
    name: "9480_ios / 新会话：02:11:08 从未落盘，最近的文件在 61 分钟外，应原样重开（不认领、不改绑定）",
    createdAt: Date.parse("2026-10-10T02:11:08.376Z"),
    recorded: `${DIR}\\${sessionName("2026-10-10T02:11:08.380Z", "01a12394-0fdc-748b-9bc1-acd55d5d7478")}`,
    files: [
      file(DIR, "2026-10-09T08:50:19.927Z", "01a11fdb-2c97-7476-841f-a562ddbf2c87", 46669),
      file(DIR, "2026-10-10T01:09:42.971Z", "01a1235b-d3bb-7461-b0fa-1227cf3a71a3", 241383),
    ],
    expect: { kind: "reopen" },
  },
];

async function main() {
  const { mod, cleanup } = await loadModule();
  const { parseSessionStamp, resolveChatSession, freshReasonText, sameSessionPath } = mod;

  // ------------------------------------------------------------- 文件名解析
  check(
    "parseSessionStamp 读出 pi 文件名里的创建时间",
    parseSessionStamp(sessionName("2026-10-09T09:55:06.183Z", "01a12016-7947-7049-a4ec-fe024ec4b122"))
      === Date.parse("2026-10-09T09:55:06.183Z"),
  );
  check("parseSessionStamp 对异形文件名返回 null", parseSessionStamp("not-a-session.jsonl") === null);

  // ----------------------------------------------------------------- 合成用例
  const listing = (files, recordedExists = false) => ({ dir: DIR, files, recordedExists });
  const mk = (recorded, createdAt, files, recordedExists = false, siblings = []) =>
    resolveChatSession({
      chat: { id: "self", createdAt, sessionFile: recorded },
      siblings,
      listing: listing(files, recordedExists),
    });

  const t0 = Date.parse("2026-10-10T10:00:00.000Z");
  const near = (ms) => new Date(t0 + ms).toISOString();

  check("没有绑定过 pi 会话 → fresh(unbound)", (() => {
    const r = resolveChatSession({
      chat: { id: "self", createdAt: t0, sessionFile: null },
      siblings: [],
      listing: listing([]),
    });
    return r.kind === "fresh" && r.reason === "unbound";
  })());

  check("登记的文件存在 → resume", (() => {
    const recorded = `${DIR}\\${sessionName(near(1000), "aaaaaaaa-0000-7000-8000-000000000001")}`;
    const r = mk(recorded, t0, [file(DIR, near(1000), "aaaaaaaa-0000-7000-8000-000000000001")], true);
    return r.kind === "resume" && r.path === recorded;
  })());

  check("宿主没给出清单 → 仍然相信登记路径（resume）", (() => {
    const recorded = `${DIR}\\${sessionName(near(1000), "aaaaaaaa-0000-7000-8000-000000000002")}`;
    const r = resolveChatSession({
      chat: { id: "self", createdAt: t0, sessionFile: recorded },
      siblings: [],
      listing: null,
    });
    return r.kind === "resume" && r.path === recorded;
  })());

  check("登记的没了 + 唯一近邻 → adopt 最近的", (() => {
    const r = mk(
      `${DIR}\\${sessionName(near(100), "bbbbbbbb-0000-7000-8000-000000000001")}`,
      t0,
      [file(DIR, near(400), "bbbbbbbb-0000-7000-8000-000000000002")],
    );
    return r.kind === "adopt" && r.path.endsWith("000000000002.jsonl");
  })());

  check("最近的候选在 10 分钟窗口之外 → 原样重开（不猜）", (() => {
    const recorded = `${DIR}\\${sessionName(near(100), "cccccccc-0000-7000-8000-000000000001")}`;
    const r = mk(recorded, t0, [file(DIR, near(11 * 60 * 1000), "cccccccc-0000-7000-8000-000000000002")]);
    return r.kind === "reopen" && r.path === recorded;
  })());

  check("目录里一个候选都没有 → 原样重开（新建工作区的常态）", (() => {
    const recorded = `${DIR}\\${sessionName(near(100), "cccccccc-0000-7000-8000-000000000009")}`;
    const r = mk(recorded, t0, []);
    return r.kind === "reopen" && r.path === recorded;
  })());

  check("两个候选几乎并列 → 拒绝猜测 fresh(ambiguous)", (() => {
    const r = mk(
      `${DIR}\\${sessionName(near(50), "dddddddd-0000-7000-8000-000000000001")}`,
      t0,
      [
        file(DIR, near(1000), "dddddddd-0000-7000-8000-000000000002"),
        file(DIR, near(5000), "dddddddd-0000-7000-8000-000000000003"),
      ],
    );
    return r.kind === "fresh" && r.reason === "ambiguous";
  })());

  check("被别的会话占用的文件不参与认领 → 原样重开", (() => {
    const taken = file(DIR, near(400), "eeeeeeee-0000-7000-8000-000000000002");
    const recorded = `${DIR}\\${sessionName(near(100), "eeeeeeee-0000-7000-8000-000000000001")}`;
    const r = mk(recorded, t0, [taken], false, [
      { id: "other", createdAt: t0, sessionFile: taken.path },
    ]);
    return r.kind === "reopen" && r.path === recorded;
  })());

  check("更接近的兄弟会话优先认领（最近者胜，不重复占同一份记录）", (() => {
    const shared = file(DIR, near(1000), "eeeeeeee-0000-7000-8000-000000000003");
    const records = `${DIR}\\${sessionName(near(50), "eeeeeeee-0000-7000-8000-000000000004")}`;
    // 自己离候选 1000ms，兄弟只离 10ms → 兄弟赢，自己只能原样重开
    const r = mk(records, t0, [shared], false, [
      { id: "other", createdAt: t0 + 990, sessionFile: null },
    ]);
    return r.kind === "reopen";
  })());

  check("0 字节（从未落盘）的文件不参与认领 → 原样重开", (() => {
    const recorded = `${DIR}\\${sessionName(near(100), "ffffffff-0000-7000-8000-000000000001")}`;
    const r = mk(recorded, t0, [file(DIR, near(400), "ffffffff-0000-7000-8000-000000000002", 0)]);
    return r.kind === "reopen" && r.path === recorded;
  })());

  // pi 报回来的路径用正斜杠、盘符大小写也可能不同，而索引里存的是宿主给的原样。
  // 用 === 比较永远是 false，会把「会话已经开着」的判断悄悄变成「每次都要重开」。
  check(
    "sameSessionPath 忽略斜杠方向与大小写",
    sameSessionPath("C:\\Users\\a\\.pi\\session.jsonl", "c:/users/a/.pi/session.jsonl"),
  );
  check("sameSessionPath 不把不同文件当成同一个", !sameSessionPath("a/b.jsonl", "a/c.jsonl"));
  check("sameSessionPath 对同一写法返回真", sameSessionPath("a/b.jsonl", "a/b.jsonl"));

  check("freshReasonText 对每个原因都有话可说", (() => {
    return ["unbound", "ambiguous"].every((reason) => typeof freshReasonText(reason) === "string" && freshReasonText(reason).length > 0);
  })());

  // ---------------------------------------------------------------- 引擎接线
  //
  // `openSessionRef` 是「引擎此刻开着哪个会话」的唯一答案。它只在 `start` 里被
  // 写过一次，而 `switch_session` / `new_session` / `fork` 成功后都没回填 ——
  // 于是预热 reload 推进 generation 时，`openChat` 会对同一个文件再切一遍，
  // 而 `switchSession` 尾部的 setStats(null) 落在 stats effect 的回填之后、
  // 且不再有任何依赖变化去触发重取 —— 上下文进度条「闪一下就永远变成 —」。
  // 修法是把回填收进所有会话变更都路过的 `applyState`。
  const usePi = readFileSync(resolve("src/hooks/usePi.ts"), "utf8");
  const applyStateBody = /const applyState = useCallback\(\([\s\S]*?\n  \}, \[/.exec(usePi)?.[0] ?? "";
  check(
    "applyState 把 get_state 报回的 sessionFile 按槽位记进 openSessionBySlot（唯一回填点）",
    applyStateBody.includes("openSessionBySlot.current.set") && Boolean(applyStateBody.match(/data[?.]*\.sessionFile/)),
    applyStateBody.replace(/\s+/g, " ").slice(0, 140),
  );
  for (const op of ["newSession", "switchSession", "rewindToTurn"]) {
    const body = new RegExp(`const ${op} = [\\s\\S]*?\\n  (?:const|\\}|,\\n)`, "").exec(usePi)?.[0] ?? "";
    check(
      `${op} 成功后经过 applyState（所以 ref 会被回填）`,
      body.includes("applyState("),
    );
  }

  // ------------------------------------------- 会话清单的字段名必须两边一致
  //
  // 实测事故：Rust 的 SessionListing/SessionFileInfo 漏了
  // `#[serde(rename_all = "camelCase")]`，于是前端拿到的 `recordedExists`
  // 是 undefined（读作「登记的文件没了」）。所有普通会话因此被判成 reopen，
  // 引擎以「不带 --session」的方式冷启动 —— 满屏历史的会话打开是空白新会话。
  // 旧版每次打开都多走一次 openChat（内含 switch_session）把它盖住了，
  // 改成每会话一个进程之后就暴露了。字段名是跨语言的契约，钉在这里。
  const rustConfig = readFileSync(resolve("src-tauri/src/config.rs"), "utf8");
  for (const struct of ["SessionFileInfo", "SessionListing"]) {
    const decl =
      new RegExp(`#\\[derive\\(Serialize\\)\\]\\s*#\\[serde\\(rename_all = "camelCase"\\)\\]\\s*pub struct ${struct}`)
        .test(rustConfig);
    check(`${struct} 带 camelCase 序列化（否则前端字段全是 undefined）`, decl);
  }
  const bridgeTypes = readFileSync(resolve("src/lib/configBridge.ts"), "utf8");
  check(
    "前端按 camelCase 读这几个字段（与上面的 serde 声明成对）",
    /recordedExists: boolean/.test(bridgeTypes) &&
      /fileName: string/.test(bridgeTypes) &&
      /modifiedMs: number/.test(bridgeTypes),
  );

  // 第二道保险：focus 之后无条件收敛一次，即使 hint 拿不到也不会开成空白会话。
  const appSrc = readFileSync(resolve("src/App.tsx"), "utf8");
  const focusBody = /const focus = useCallback\([\s\S]*?\n  \}, \[/.exec(appSrc)?.[0] ?? "";
  check(
    "focus 无条件调 openChat 收敛（hint 落空时也不会开成新会话）",
    /if \(chat\) void openChat\(workspacePath, chat\);/.test(focusBody),
    focusBody.replace(/\s+/g, " ").slice(0, 120),
  );

  // --------------------------------------------------------------- 真实回放
  for (const scenario of REAL_CASES) {
    const r = resolveChatSession({
      chat: { id: "self", createdAt: scenario.createdAt, sessionFile: scenario.recorded },
      siblings: [],
      listing: { dir: DIR, files: scenario.files, recordedExists: false },
    });
    const expectation = scenario.expect;
    const ok =
      expectation.kind === "adopt"
        ? r.kind === "adopt" && r.path.endsWith(expectation.fileName)
        : expectation.kind === "reopen"
          ? r.kind === "reopen" && r.path === scenario.recorded
          : r.kind === expectation.kind && r.reason === expectation.reason;
    const detail =
      r.kind === "adopt"
        ? `-> adopt ${r.path.split("\\").pop()}`
        : r.kind === "reopen"
          ? "-> reopen（绑定原样保留）"
          : `-> ${r.kind}/${r.reason ?? ""}`;
    check(scenario.name, ok, detail);
  }

  // ------------------------------------------------------------------- 输出
  let failed = 0;
  for (const { name, ok, detail } of results) {
    if (!ok) failed += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
  }
  console.log(`\n${results.length - failed}/${results.length} 通过`);

  if (process.argv.includes("--live")) {
    reportLive(resolveChatSession);
  }

  cleanup();
  process.exitCode = failed === 0 ? 0 : 1;
}

/**
 * 用当前机器上的 state.json 与真实会话目录跑一遍判定，只打印不计数 ——
 * 它依赖本机状态，不适合作为断言。
 */
function reportLive(resolveChatSession) {
  const stateFile = join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "APIX", "state.json");
  if (!existsSync(stateFile)) {
    console.log(`\n--live: 找不到 ${stateFile}`);
    return;
  }
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  const sessionsRoot = join(homedir(), ".pi", "agent", "sessions");
  console.log("\n--- --live：当前 state.json 的判定结果 ---");
  for (const workspace of state.workspaces ?? []) {
    const encoded = `--${workspace.path.trim().replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
    const dir = join(sessionsRoot, encoded);
    const files = existsSync(dir)
      ? readdirSync(dir).filter((n) => n.endsWith(".jsonl")).map((n) => {
        const full = join(dir, n);
        return { path: full, fileName: n, modifiedMs: statSync(full).mtimeMs, size: statSync(full).size };
      })
      : [];
    console.log(`\n[${workspace.name}] ${workspace.path}  (${files.length} 个会话文件)`);
    for (const chat of workspace.chats ?? []) {
      const recordedExists = Boolean(chat.sessionFile && existsSync(chat.sessionFile));
      const r = resolveChatSession({
        chat,
        siblings: (workspace.chats ?? []).filter((entry) => entry.id !== chat.id),
        listing: { dir, files, recordedExists },
      });
      const label =
        r.kind === "adopt"
          ? `adopt -> ${r.path.split("\\").pop()}`
          : r.kind === "resume"
            ? "resume"
            : r.kind === "reopen"
              ? "reopen（绑定原样保留）"
              : `fresh(${r.reason})`;
      console.log(`   ${String(chat.name).padEnd(8)} ${label}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
