/**
 * 修复 APIX 索引里指向「磁盘上没有的 session 文件」的会话绑定。
 *
 * 背景：`new_session` 会先返回一个路径，但 pi 只在**第一次真正发出消息时**才把文件
 * 落盘；而同一代引擎里若发生两次会话创建（切工作区时引擎重启、旧链还在等），被记
 * 下来的可能是那条**已经被顶掉的**路径 —— 它永远不会被写出来。点开这种会话时 pi
 * 不会报错（它会用一个空会话顶替那个不存在的路径），所以界面只显示一片空白。
 *
 * 判定规则与运行时的 `src/lib/sessionRecovery.ts` **完全共用同一份实现**，
 * 这里只负责批量套用，避免两套规则各自漂移：
 *
 *   - 绑定文件存在          → 不动
 *   - 绑定文件没了 + 有唯一近邻 → 认定为同一轮对话，接回去（adopt）
 *   - 绑定文件没了 + 认不出   → 不动，只在报告里说明（绝不把绑定清成 null）
 *
 * 只改 `sessionFile` 一个字段；写回保持 2 空格缩进 + 键名排序（与 APIX 自身的写出一致）。
 *
 * 用法：node scripts/repair-state.mjs [--apply]
 * 不给 --apply 就是干跑。
 */

import { build } from "esbuild";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const APPLY = process.argv.includes("--apply");
const STATE = join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "APIX", "state.json");
const SESSIONS = join(homedir(), ".pi", "agent", "sessions");

/** 与 Rust 侧 `session_dir_for` 保持一致的目录名推导。 */
function sessionDirFor(cwd) {
  const trimmed = String(cwd).trim().replace(/[/\\]+$/, "");
  const body = trimmed.replace(/^[/\\]+/, "").replace(/[/\\:]/g, "-");
  return `--${body}--`;
}

function listSessions(cwd) {
  const dir = join(SESSIONS, sessionDirFor(cwd));
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => {
      const full = join(dir, name);
      const stat = statSync(full);
      return { path: full, fileName: name, modifiedMs: stat.mtimeMs, size: stat.size };
    })
    .sort((a, b) => b.modifiedMs - a.modifiedMs);
}

/** 与 APIX 的写出一致：2 空格缩进、键名排序。 */
function sortedStringify(value, depth = 0) {
  const pad = "  ".repeat(depth + 1);
  const closePad = "  ".repeat(depth);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[\n${value.map((v) => pad + sortedStringify(v, depth + 1)).join(",\n")}\n${closePad}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    if (keys.length === 0) return "{}";
    const body = keys.map((k) => `${pad}${JSON.stringify(k)}: ${sortedStringify(value[k], depth + 1)}`);
    return `{\n${body.join(",\n")}\n${closePad}}`;
  }
  return JSON.stringify(value);
}

/** 载入运行时那份判定实现，保证规则只有一处。 */
async function loadResolver() {
  const dir = mkdtempSync(join(tmpdir(), "apix-repair-"));
  const out = join(dir, "bundle.mjs");
  await build({
    entryPoints: [resolve("src/lib/sessionRecovery.ts")],
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

const { mod, cleanup } = await loadResolver();
const { resolveChatSession } = mod;

const doc = JSON.parse(readFileSync(STATE, "utf8"));
const changes = [];
const notes = [];

for (const ws of doc.workspaces ?? []) {
  const files = listSessions(ws.path);
  for (const chat of ws.chats ?? []) {
    const recorded = chat.sessionFile ?? null;
    const decision = resolveChatSession({
      chat,
      siblings: (ws.chats ?? []).filter((entry) => entry !== chat),
      listing: {
        dir: sessionDirFor(ws.path),
        files,
        recordedExists: Boolean(recorded && existsSync(recorded)),
      },
    });

    if (decision.kind === "resume") continue;
    if (decision.kind === "adopt") {
      chat.sessionFile = decision.path;
      changes.push({
        where: `${ws.name} / ${chat.name}`,
        detail: `${recorded}\n      → ${decision.path}`,
      });
      continue;
    }
    notes.push({
      where: `${ws.name} / ${chat.name}`,
      detail:
        decision.kind === "reopen"
          ? `登记的记录不在，也没有时间接近的可认领候选（候选 ${files.length} 份）；运行时按登记路径重开，绑定不动`
          : decision.reason === "unbound"
            ? "从未绑定过 pi 会话，运行时会给它开一个新会话"
            : `登记的记录不在，同目录有多个候选无法确定，保持原绑定不动（候选 ${files.length} 份）`,
    });
  }
}

if (changes.length === 0 && notes.length === 0) {
  console.log("索引里没有失效的会话绑定，无需修复。");
  cleanup();
  process.exit(0);
}

if (changes.length > 0) {
  console.log(`发现 ${changes.length} 处可自动找回的绑定：\n`);
  for (const c of changes) {
    console.log(`  [重新绑定] ${c.where}`);
    console.log(`      ${c.detail}\n`);
  }
}
if (notes.length > 0) {
  console.log(`另有 ${notes.length} 处无法确定，保持不动：\n`);
  for (const n of notes) {
    console.log(`  [跳过] ${n.where}`);
    console.log(`      ${n.detail}\n`);
  }
}

if (changes.length === 0) {
  console.log("没有可写入的改动。");
  cleanup();
  process.exit(0);
}

if (!APPLY) {
  console.log("（干跑，未写入。加 --apply 才真正修改。）");
  cleanup();
  process.exit(0);
}

doc.updatedAt = String(Date.now());
writeFileSync(STATE, sortedStringify(doc) + "\n", "utf8");
console.log(`已写入 ${STATE}`);
cleanup();
