/**
 * 内置 skill 的回归检查。
 *
 * 内置 skill 是 APIX 的一部分：它们随程序编译进去、落到用户的 skills 目录、
 * **开关恒为开且锁定**（`src/lib/skills.ts`），因此每个内置 skill 的名字 +
 * description + 路径都会常驻系统提示词（正文只有真正用到时才读）。
 * 加一个内置 skill 是有代价的，所以这里既查「装没装对」，也查「贵不贵」。
 *
 * 静态部分盯住几条硬契约：
 *   - `config.rs` 的 BUILTIN_SKILLS 与 assets 目录一一对应，不多不少；
 *   - frontmatter 的 `name` == 目录名 —— 用户是用 `/skill:<name>` 调用的，
 *     而 APIX 界面用的是目录名当 id，两者一旦分叉，就会出现「装了但打不出来」；
 *   - 每个内置 skill 都带 `apix-managed` 标记（否则设置页不会标「内置」、删得掉）；
 *   - description 不能太长（它常驻提示词）。
 *
 * 活的这部分会真的起一次 pi，用 APIX 完全相同的参数形状
 * （`--no-skills` + 每个 `--skill`），确认三个 `/skill:` 命令真的注册上了。
 * 找不到 pi 就跳过并说明，不算失败——这是环境问题，不是回归。
 *
 * 跑法：node scripts/check-builtin-skills.mjs
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });

const ASSETS = join("src-tauri", "assets", "skills");
const CONFIG = readFileSync(join("src-tauri", "src", "config.rs"), "utf8");

// ------------------------------------------------------- BUILTIN_SKILLS 与目录

const dirs = readdirSync(ASSETS).filter((name) => existsSync(join(ASSETS, name, "SKILL.md")));
const listed = [...CONFIG.matchAll(/"([a-z0-9-]+)"\s*,\s*\n\s*include_str!\("\.\.\/assets\/skills\/\1\/SKILL\.md"\)/g)].map(
  (m) => m[1],
);

check(
  "BUILTIN_SKILLS 与 assets 目录一一对应",
  listed.length === dirs.length && dirs.every((name) => listed.includes(name)),
  `配置 ${listed.length} 个 [${listed.join(", ")}] / 磁盘 ${dirs.length} 个 [${dirs.join(", ")}]`,
);
check("内置 skill 都是通过 include_str! 编译进去的（不是运行时读盘）", listed.length > 0);
check(
  "本次新增的两个都在清单里",
  listed.includes("apix-skill-author") && listed.includes("apix-mcp-author"),
);

/** 复刻 Rust 的 `is_valid_skill_id`。 */
function validId(id) {
  if (!id || id.length > 64) return false;
  if (!/[a-z0-9]/.test(id[0])) return false;
  if (!/[a-z0-9]/.test(id[id.length - 1])) return false;
  return /^[a-z0-9-]+$/.test(id);
}

/** 只取 frontmatter 里的一级 `key: value`，够用且不会误读正文里的冒号。 */
function frontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return null;
  const out = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (pair) out[pair[1]] = pair[2].trim();
  }
  return out;
}

// ------------------------------------------------------- 每个 skill 的硬契约

const DESCRIPTIONS = [];
/**
 * 单条 description 的上限。300 是「不许写成一段话」的界线，不是目标值：
 * 现有三条分别约 276（交接，历史遗留）/ 95 / 100 字。真正管住总开销的是
 * 下面那条总和预算，单条上限只是防止某一条失控。
 */
const MAX_DESCRIPTION = 300;

/**
 * 常驻系统提示词的 description 总预算。
 *
 * 内置 skill 恒为开启，所以每一条 description 都会进每一次请求的系统提示词。
 * 700 是给三个内置 skill 留的余量（现有三条加起来约 470 字）；它故意不是
 * 「刚好卡住现值」——这样以后往 description 里塞废话会立刻被抓住。
 */
const MAX_TOTAL_DESCRIPTION = 700;

const bodies = new Map();
for (const id of dirs) {
  const body = readFileSync(join(ASSETS, id, "SKILL.md"), "utf8");
  bodies.set(id, body);
  const fm = frontmatter(body);

  check(`${id}: 有 frontmatter`, Boolean(fm));
  if (!fm) continue;

  check(`${id}: 目录名是合法 skill id`, validId(id), id);
  check(`${id}: name 与目录名一致（决定 /skill: 能不能打出来）`, fm.name === id, `name=${fm.name}`);
  check(`${id}: description 非空`, Boolean(fm.description));
  check(
    `${id}: description 不超过 ${MAX_DESCRIPTION} 字`,
    (fm.description ?? "").length <= MAX_DESCRIPTION,
    `${(fm.description ?? "").length} 字`,
  );
  check(`${id}: description 是单行（多行会被 APIX 的解析器截断）`, !/[\r\n]/.test(fm.description ?? ""));
  check(
    `${id}: 带 apix-managed 标记（否则设置页不标「内置」、还删得掉）`,
    body.includes("apix-managed") && /managed-by:\s*apix/.test(body),
  );
  check(`${id}: 正文里说清了「何时使用」`, /## 何时使用/.test(body));
  DESCRIPTIONS.push(fm.description ?? "");
}

check(
  "所有内置 description 加起来不超过 700 字（它们全部常驻提示词）",
  DESCRIPTIONS.join("").length <= 700,
  `${DESCRIPTIONS.join("").length} 字`,
);

// ------------------------------------------------------------ 两个新 skill 的契约

const SKILL = bodies.get("apix-skill-author") ?? "";
const MCP = bodies.get("apix-mcp-author") ?? "";

check("skill-author: 讲清了 skill 放哪", /\.pi[\\/]agent[\\/]skills/.test(SKILL));
check("skill-author: 讲了 id 的字符规则", /小写字母、数字和连字符/.test(SKILL));
check(
  "skill-author: 明确禁止给用户的 skill 盖内置标记",
  /不要.*apix-managed/.test(SKILL) && /managed-by: apix/.test(SKILL),
);
check(
  "skill-author: 明确提示「抄内置 skill 当模板时要删掉标记」（模型最容易踩的坑）",
  /模板/.test(SKILL) && /删掉/.test(SKILL),
);
check("skill-author: 讲了装现有 skill 的来源与校验", /装一个现有的 skill/.test(SKILL) && /git clone/.test(SKILL));
check("skill-author: 讲了怎么让新 skill 生效", /生效方式/.test(SKILL) && /常用/.test(SKILL) && /默认是关的/.test(SKILL));
check("skill-author: 要求先征得确认再动笔", /必须拿到用户的确认才动笔/.test(SKILL));
check("skill-author: 要求不要覆盖同名 skill", /不要覆盖已有的 skill/.test(SKILL));

check("mcp-author: 给出 mcp.json 的位置", /\.pi[\\/]agent[\\/]mcp\.json/.test(MCP));
check("mcp-author: 给出 mcpServers 结构", /"mcpServers"/.test(MCP));
check("mcp-author: 说明服务器名的字符规则", /只允许字母、数字、`_`、`-`/.test(MCP));
check(
  "mcp-author: 说明 command / url 二选一",
  /只能有 `command` 或 `url` 其中之一/.test(MCP) && /不能两个都有/.test(MCP),
);
check(
  "mcp-author: 给出 pi mcp 的子命令",
  ["pi mcp add", "pi mcp list", "pi mcp login", "pi mcp remove"].every((c) => MCP.includes(c)),
);
check("mcp-author: 提醒先确认 pi 可用", /pi --version/.test(MCP));
check("mcp-author: 给出 --bearer-token-env-var（不要把令牌写死）", /bearer-token-env-var/.test(MCP));
check(
  "mcp-author: 讲了 sse 已不支持",
  /sse/.test(MCP) && /不支持/.test(MCP),
);
check(
  "mcp-author: 讲了生效方式（新建会话）——这是用户最容易误以为「没装上」的地方",
  /生效方式/.test(MCP) && /新会话/.test(MCP),
);
check("mcp-author: 说清设置页的「重新加载」只刷新界面", /只刷新界面/.test(MCP));
check("mcp-author: 给了排查入口（日志 / list）", /mcp\.log/.test(MCP));
check("mcp-author: 禁止编造包名和 URL", /不要编造包名和 URL/.test(MCP));

// ------------------------------------------------- 活的验证：真起一次 pi

/** 从 PATH 上找 pi 的 shim，再顺着它找包入口。找不到返回 null。 */
function findPiEntry() {
  if (process.env.APIX_PI_ENTRY && existsSync(process.env.APIX_PI_ENTRY)) {
    return process.env.APIX_PI_ENTRY;
  }
  const exts = process.platform === "win32" ? ["", ".cmd", ".bat", ".exe"] : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const shim = join(dir, `pi${ext}`);
      if (!existsSync(shim)) continue;
      const base = dirname(shim);
      for (const candidate of [
        join(base, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js"),
        join(base, "..", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js"),
      ]) {
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

const entry = findPiEntry();
if (!entry) {
  check("找不到 pi，活体验证跳过（环境问题，不算回归）", true, "设 APIX_PI_ENTRY 可强制指定");
} else {
  // 按 ensure_builtin_skills 的真实产物摆一份：<agent>/skills/<id>/SKILL.md
  //
  // 注意 mkdirSync 递归创建时返回的是**第一个新建的目录**（已存在则返回 undefined），
  // 不是完整路径——所以路径自己拼，别拿返回值当 dir 用。
  const root = join(tmpdir(), `apix-builtin-${Date.now()}`);
  const agent = join(root, "agent");
  const workspace = join(root, "ws");
  mkdirSync(join(agent, "skills"), { recursive: true });
  mkdirSync(workspace, { recursive: true });

  const skillPaths = [];
  for (const id of dirs) {
    mkdirSync(join(agent, "skills", id), { recursive: true });
    const target = join(agent, "skills", id, "SKILL.md");
    writeFileSync(target, bodies.get(id), "utf8");
    skillPaths.push(target);
  }

  const child = spawn(
    process.execPath,
    [entry, "--mode", "rpc", "--no-skills", ...skillPaths.flatMap((p) => ["--skill", p])],
    {
      cwd: workspace,
      env: { ...process.env, PI_CODING_AGENT_DIR: agent },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const pending = new Map();
  let seq = 0;
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  createInterface({ input: child.stdout }).on("line", (line) => {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      return;
    }
    if (record.type === "response" && pending.has(record.id)) {
      pending.get(record.id)(record);
      pending.delete(record.id);
    }
  });
  // 带超时：pi 起不来时要以断言失败收场，不能把整个脚本挂死。
  const call = (payload, timeoutMs = 15000) =>
    new Promise((res) => {
      const id = `q${++seq}`;
      const timer = setTimeout(() => {
        if (pending.delete(id)) res(null);
      }, timeoutMs);
      pending.set(id, (value) => {
        clearTimeout(timer);
        res(value);
      });
      child.stdin.write(JSON.stringify({ ...payload, id }) + "\n");
    });

  await new Promise((r) => setTimeout(r, 3000));
  const answer = await call({ type: "get_commands" });
  const commands = (answer?.data?.commands ?? []).map((c) => (typeof c === "string" ? c : c.name));
  try {
    child.kill();
  } catch {
    /* already gone */
  }
  rmSync(root, { recursive: true, force: true });

  check(
    "活体：pi 能起来并回答 get_commands",
    commands.length > 0,
    commands.length ? `${commands.length} 个命令` : `无响应${stderr ? ` / stderr: ${stderr.trim().slice(0, 200)}` : ""}`,
  );
  for (const id of dirs) {
    check(`活体：/skill:${id} 已注册`, commands.includes(`skill:${id}`), commands.join(", "));
  }
  check(
    "活体：只注册了白名单里的 skill（--no-skills 生效）",
    commands.filter((c) => String(c).startsWith("skill:")).length === dirs.length,
  );
}

// ---------------------------------------------------------------------- 汇总

let failed = 0;
for (const { name, ok, detail } of results) {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} 通过`);
process.exitCode = failed === 0 ? 0 : 1;
