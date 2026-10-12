/**
 * `src/lib/skills.ts` 的回归测试。
 *
 * 这套规则决定「哪个 skill 会被模型触发」。输入只有两个——设置页配的**全局列表**，
 * 和**对话自己的开关**——但默认值分两种（全局默认开、对话里手加的默认关），
 * 而且"哪些 skill 出现在列表里"和"哪些真的进了引擎"必须是同一个集合。
 * 这正是最容易在某次改动里悄悄改错、错了还不容易看出来的地方，
 * 所以断言的是**最终行为**：每行的开关位置、以及送进引擎的 --skill 名单。
 *
 * 其中第一条是这次改造的重点：**内置 skill 不得因为"内置"就自动出现在对话里**。
 * 它们曾经是被强制加入并锁定的（那时交接按钮依赖这个 skill 被加载），
 * 现在它们和用户自己写的 skill 走完全一样的规则。
 *
 * 跑法：node scripts/check-skills.mjs
 * 退出码非 0 表示有断言失败。
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

async function load() {
  const dir = mkdtempSync(join(tmpdir(), "apix-skills-"));
  const out = join(dir, "bundle.mjs");
  const entry = join(dir, "entry.ts");
  writeFileSync(
    entry,
    `export { skillRows, enabledSkillPaths, addableSkills, skillInvocationText } from ${JSON.stringify(
      resolve("src/lib/skills.ts").replace(/\\/g, "/"),
    )};
export { skillKey } from ${JSON.stringify(
      resolve("src/lib/configBridge.ts").replace(/\\/g, "/"),
    )};
export { SkillsPanel } from ${JSON.stringify(
      resolve("src/components/Composer.tsx").replace(/\\/g, "/"),
    )};`,
    "utf8",
  );
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
    // react-dom/server 会 require node 内建模块（stream），ESM 包里必须给出 require。
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  });
  const mod = await import(pathToFileURL(out).href);
  return { mod, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const { mod, cleanup } = await load();
const {
  skillRows,
  enabledSkillPaths,
  addableSkills,
  skillInvocationText,
  skillKey,
  SkillsPanel,
} = mod;

/** 真渲染一次弹出层（react-dom/server），断言界面上看得见的东西。 */
let renderPanel = () => "";
try {
  const dir = mkdtempSync(join(tmpdir(), "apix-panel-"));
  const out = join(dir, "bundle.mjs");
  const entry = join(dir, "entry.ts");
  writeFileSync(
    entry,
    `import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SkillsPanel } from ${JSON.stringify(
      resolve("src/components/Composer.tsx").replace(/\\/g, "/"),
    )};
export function render(props) { return renderToStaticMarkup(createElement(SkillsPanel, props)); }`,
    "utf8",
  );
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
    // react-dom/server 会 require node 内建模块（stream），ESM 包里必须给出 require。
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  });
  const panel = await import(pathToFileURL(out).href);
  renderPanel = (props) => panel.render(props);
} catch (error) {
  check("能渲染 SkillsPanel", false, String(error));
}

const skill = (id, name, extra = {}) => ({
  id,
  name,
  description: `${name} 的说明`,
  source: "agent",
  path: `C:/skills/${id}/SKILL.md`,
  writable: true,
  disableModelInvocation: false,
  builtin: false,
  ...extra,
});

const COMPACT = skill("compact-handoff", "Compact Handoff");
const PDF = skill("pdf-tools", "PDF Tools");
const BUILT = skill("apix-note", "APIX Note", { builtin: true });
const LIB = [COMPACT, PDF, BUILT];

const keyOf = (s) => skillKey(s);
const onKeys = (rows) => rows.filter((r) => r.on).map((r) => r.key).sort();
/** 按 key 取某一行——下标会随排序规则一起变，不可靠。 */
const rowOf = (rows, key) => rows.find((r) => r.key === key);

function main() {
  // ------------------------------------ 内置不再自动出现（本次改造的核心）
  const bare = skillRows(LIB, [], {});
  check(
    "什么都没有配 → 对话里一个 skill 都没有（内置不再自动出现）",
    bare.length === 0,
    bare.map((r) => r.skill.name).join(", ") || "（空）",
  );
  check(
    "什么都没有配 → 引擎的 --skill 名单也是空的",
    enabledSkillPaths(LIB, [], {}).length === 0,
    enabledSkillPaths(LIB, [], {}).join(" | ") || "（空）",
  );
  check(
    "内置 skill 不构成「默认开」：只给内置开开关也没有任何隐含条目",
    skillRows(LIB, [], { [keyOf(BUILT)]: true }).length === 1 &&
      rowOf(skillRows(LIB, [], { [keyOf(BUILT)]: true }), keyOf(BUILT)).added,
  );
  check(
    "内置 skill 要显式打开才进引擎名单",
    JSON.stringify(enabledSkillPaths(LIB, [], { [keyOf(BUILT)]: true })) ===
      JSON.stringify([BUILT.path]),
  );
  check(
    "内置 skill 的开关不再被锁死（可以按对话关掉）",
    rowOf(skillRows(LIB, [], { [keyOf(BUILT)]: false }), keyOf(BUILT)).on === false,
  );
  check(
    "每一行都有 added 或 global 之一，没有第三种来源",
    skillRows(LIB, [keyOf(PDF)], { [keyOf(COMPACT)]: false }).every(
      (row) => row.added !== row.global,
    ),
  );

  // ------------------------------------------------- 全局：默认开、自动出现
  const globalRows = skillRows(LIB, [keyOf(COMPACT)], {});
  check(
    "加进全局 → 不用手动添加就出现在列表里，且默认开启",
    globalRows.length === 1 && globalRows[0].on === true,
  );
  check(
    "全局项被标记为 global 而不是 added",
    globalRows[0].global && !globalRows[0].added,
  );
  check(
    "全局项进入引擎的 --skill 名单",
    JSON.stringify(enabledSkillPaths(LIB, [keyOf(COMPACT)], {})) ===
      JSON.stringify([COMPACT.path]),
  );

  // ------------------------------------------------- 对话手加：默认关
  const addedOff = skillRows(LIB, [], { [keyOf(PDF)]: false });
  check(
    "对话里加入的 skill 默认关闭，但出现在列表里",
    addedOff.length === 1 && addedOff[0].on === false,
  );
  check(
    "关着的手加项不进引擎名单",
    enabledSkillPaths(LIB, [], { [keyOf(PDF)]: false }).length === 0,
  );
  check(
    "打开之后才进引擎名单",
    JSON.stringify(enabledSkillPaths(LIB, [], { [keyOf(PDF)]: true })) ===
      JSON.stringify([PDF.path]),
  );
  check("手加项被标记为 added", addedOff[0].added && !addedOff[0].global);

  // --------------------------------------- 对话级覆盖优先于全局（按对话隔离）
  check(
    "全局项在某个对话里被关掉 → 该对话不触发它",
    rowOf(skillRows(LIB, [keyOf(COMPACT)], { [keyOf(COMPACT)]: false }), keyOf(COMPACT)).on ===
      false &&
      enabledSkillPaths(LIB, [keyOf(COMPACT)], { [keyOf(COMPACT)]: false }).length === 0,
  );
  check(
    "关掉全局项不影响别的对话（状态是按对话存的）",
    enabledSkillPaths(LIB, [keyOf(COMPACT)], {}).length === 1,
  );
  check(
    "全局项在一个对话里关掉、在另一个对话里仍开着",
    enabledSkillPaths(LIB, [keyOf(COMPACT)], { [keyOf(COMPACT)]: false }).length === 0 &&
      enabledSkillPaths(LIB, [keyOf(COMPACT)], {}).length === 1,
  );

  // ------------------------------------------------- 库变了：不留幽灵开关
  const ghost = skillRows(LIB, [], { "agent/gone": true });
  check(
    "对话里记着但库里已删除的 skill → 不再出现",
    ghost.length === 0 && !ghost.some((r) => r.key === "agent/gone"),
  );
  check(
    "全局列表里记着但库里已删除的 skill → 同样不出现",
    skillRows(LIB, ["agent/gone"], {}).length === 0,
  );

  // ------------------------------------------------------------ 添加候选
  check(
    "添加列表排除已在列表里的（全局的和手加的都不重复出现）",
    addableSkills(LIB, [keyOf(COMPACT)], { [keyOf(PDF)]: false }).length === 1 &&
      addableSkills(LIB, [keyOf(COMPACT)], { [keyOf(PDF)]: false })[0].id === BUILT.id,
  );
  check(
    "内置 skill 出现在添加列表里（用户可以从池子里挑它）",
    addableSkills(LIB, [], {}).length === 3 &&
      addableSkills(LIB, [], {}).some((s) => s.builtin),
  );

  // ------------------------------------------------- 名单签名必须稳定
  const many = enabledSkillPaths(LIB, [keyOf(PDF)], { [keyOf(COMPACT)]: true, [keyOf(BUILT)]: true });
  check(
    "名单按路径排序且去重（顺序变了就会误触发引擎重启）",
    JSON.stringify(many) === JSON.stringify([COMPACT.path, PDF.path, BUILT.path].sort()),
    many.join(" | "),
  );
  check(
    "同一组输入两次调用结果一致",
    JSON.stringify(enabledSkillPaths(LIB, [keyOf(PDF)], { [keyOf(COMPACT)]: true })) ===
      JSON.stringify(enabledSkillPaths(LIB, [keyOf(PDF)], { [keyOf(COMPACT)]: true })),
  );
  check(
    "既在全局又手加，仍然只出现一次",
    enabledSkillPaths(LIB, [keyOf(COMPACT)], { [keyOf(COMPACT)]: true }).length === 1,
  );

  // ------------------------------------------------------------------ 排序
  const names = skillRows(LIB, [keyOf(PDF)], { [keyOf(COMPACT)]: false }).map((r) => r.skill.name);
  check(
    "全局项排在最前，其余按名称",
    names[0] === "PDF Tools" && names[1] === "Compact Handoff" && names.length === 2,
    names.join(" → "),
  );
  check(
    "开着的键集合与 on 标记一致",
    onKeys(skillRows(LIB, [keyOf(COMPACT)], { [keyOf(PDF)]: true })).length === 2,
  );

  // ------------------------------------------- 交接用的替代文本（不再依赖加载）
  const manifest = "C:\\Users\\x\\.pi\\agent\\skills\\apix-context-handoff\\SKILL.md";
  const invocation = skillInvocationText({
    name: "apix-context-handoff",
    manifestPath: manifest,
    raw: "---\nname: apix-context-handoff\ndescription: 一段很长的描述\n---\n\n# 正文\n\n第二步。\n",
  });
  check("替代文本去掉了 frontmatter", !invocation.includes("description: 一段很长的描述"));
  check("替代文本保留了正文", invocation.includes("# 正文") && invocation.includes("第二步。"));
  check(
    "替代文本带上 name 与 location（pi 展开 skill 时就是这么包的）",
    invocation.includes('name="apix-context-handoff"') && invocation.includes(`location="${manifest}"`),
  );
  check(
    "替代文本给出 skill 目录作为相对路径基准",
    invocation.includes("References are relative to C:\\Users\\x\\.pi\\agent\\skills\\apix-context-handoff."),
  );
  check(
    "替代文本用正斜杠路径也能求出目录",
    skillInvocationText({ name: "s", manifestPath: "/a/b/SKILL.md", raw: "x" }).includes(
      "References are relative to /a/b.",
    ),
  );
  check(
    "正文里没有 frontmatter 时原样保留",
    skillInvocationText({ name: "s", manifestPath: "/a/SKILL.md", raw: "# 只有正文\n" }).includes(
      "# 只有正文",
    ),
  );

  // ---------------------------------------------- 弹出层的界面（真渲染）
  // 界面规格（用户点名）：只有一行「本会话常驻skills」+ 右侧常驻加号；
  // 下面没有 skill 就显示一个空态，不再有大段文字说明。
  const emptyHtml = renderPanel({
    skillList: [],
    addable: LIB,
    onSetChatSkill: () => {},
    onForgetChatSkill: () => {},
  });
  check(
    "什么都没配 → 界面上一个 skill 名字都没有（内置也不出现）",
    LIB.every((skill) => !emptyHtml.includes(skill.name)),
    LIB.map((skill) => skill.name).join(", "),
  );
  check("标题是「本会话常驻skills」", emptyHtml.includes("本会话常驻skills"));
  check("什么都没配 → 空态只有一行「暂无 skill」", emptyHtml.includes("暂无 skill"));
  check(
    "空态不再是一大段文字（旧文案不得出现）",
    !/想让每个对话都默认带着|加入后默认关闭/.test(emptyHtml),
  );
  check("弹出层里不再渲染那段说明文字（skillsTip 只留给触发器 tooltip）", !/skills-popover-note/.test(emptyHtml));
  check("什么都没配 → 有加号入口", emptyHtml.includes("从已安装的 skill 里添加"));
  check(
    "已安装的 skill 列表默认收起（不点加号不出现）",
    !/skills-popover-head/.test(emptyHtml),
  );

  const globalHtml = renderPanel({
    skillList: skillRows(LIB, [keyOf(COMPACT)], {}),
    addable: addableSkills(LIB, [keyOf(COMPACT)], {}),
    onSetChatSkill: () => {},
    onForgetChatSkill: () => {},
  });
  check("全局项显示在列表里", globalHtml.includes(COMPACT.name));
  check("全局项带「全局」标记", globalHtml.includes(">全局<"));
  check("全局项的开关是开的", globalHtml.includes(`aria-label="关闭 ${COMPACT.name}"`));

  // 加号常驻：即使池子已全部在列表里，加号也必须在（点开给出简短空态），
  // 用户点名的就是「加号不该消失」。
  const fullHtml = renderPanel({
    skillList: skillRows(LIB, LIB.map((s) => keyOf(s)), {}),
    addable: addableSkills(LIB, LIB.map((s) => keyOf(s)), {}),
    onSetChatSkill: () => {},
    onForgetChatSkill: () => {},
  });
  check("全部都已加入时加号仍在", fullHtml.includes("从已安装的 skill 里添加"));

  const noPoolHtml = renderPanel({
    skillList: [],
    addable: [],
    onSetChatSkill: () => {},
    onForgetChatSkill: () => {},
  });
  check("池子是空的也照样显示加号", noPoolHtml.includes("从已安装的 skill 里添加"));

  const addedHtml = renderPanel({
    skillList: skillRows(LIB, [], { [keyOf(BUILT)]: false }),
    addable: addableSkills(LIB, [], { [keyOf(BUILT)]: false }),
    onSetChatSkill: () => {},
    onForgetChatSkill: () => {},
  });
  check(
    "本会话加入的内置项显示出来并带「内置」标记",
    addedHtml.includes(BUILT.name) && addedHtml.includes(">内置<"),
  );
  check(
    "加入的项默认关闭（开关的 aria-label 是「开启」）",
    addedHtml.includes(`aria-label="开启 ${BUILT.name}"`),
  );
  check("加入的项有「从本会话移除」", addedHtml.includes("从本会话移除"));

  // --------------------------------------------------------- 截断相关的样式
  const css = readFileSync(join("src", "styles.css"), "utf8");
  const composer = readFileSync(join("src", "components", "Composer.tsx"), "utf8");
  const app = readFileSync(join("src", "App.tsx"), "utf8");

  // 新会话空视图里没有 activeChat —— 旧接线在这种情况下静默 return，
  // 点加号挑的 skill 就这么被吞了。首条消息会补建会话（handleSend 是这么
  // 干的），配置常驻 skill 也必须走同样的语义。
  const setter = /const handleSetChatSkill[\s\S]*?\n  \);/.exec(app)?.[0] ?? "";
  check(
    "空视图（无 activeChat）里加 skill 会先补建会话，而不是静默丢弃",
    setter.length > 0 && setter.includes("addChat") && !/if \(!workspace \|\| !chat\) return/.test(setter),
    setter.replace(/\s+/g, " ").slice(0, 120),
  );
  check(
    "补建的会话随即被打开（和首条消息的创建路径一致，绑定到真实 session）",
    setter.includes("openChat"),
  );
  const nameRule = /\.skill-row-name\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  check(
    "skill 名字换行显示，不用省略号切掉（名字是认它的唯一依据）",
    !/text-overflow:\s*ellipsis/.test(nameRule) && !/white-space:\s*nowrap/.test(nameRule),
    nameRule.trim().replace(/\s+/g, " "),
  );
  check(
    "说明文字最多两行，而不是横向切掉",
    /-webkit-line-clamp:\s*2/.test(/\.skill-row-desc\s*\{([^}]*)\}/.exec(css)?.[1] ?? ""),
  );
  const popoverWidth = Number(/\.popover-panel-skills\s*\{[^}]*width:\s*(\d+)px/.exec(css)?.[1] ?? 0);
  check(
    "Skills 的弹层面板本身放宽（旧版只放宽内层，外层 340px + overflow hidden 把加号裁掉了）",
    popoverWidth >= 380,
    `${popoverWidth}px`,
  );
  check(
    "Skills Popover 把加宽类传给了面板",
    /panelClass="popover-panel-skills"/.test(composer),
  );
  const innerWidth = (/\.skills-popover\s*\{[^}]*width:\s*([^;}\s]+)/.exec(css)?.[1] ?? "").trim();
  check("内层宽度跟随面板，不再比外层宽", innerWidth === "100%", innerWidth);
  check("已安装列表由 picking 控制，默认收起", /\{picking \? \(/.test(composer));
  // `.popover-list-short`（150px）模型选择器还在用，所以这条只看 SkillsPanel 自己。
  const panelRegion = composer.slice(
    composer.indexOf("function SkillsPanel"),
    composer.indexOf("export function Composer"),
  );
  check(
    "SkillsPanel 不再渲染那个只有 150px 的列表（名字全在那儿被截掉）",
    panelRegion.length > 0 && !/popover-list-short/.test(panelRegion),
  );
  check("SkillsPanel 用自己的全宽选择器", /popover-list skills-picker/.test(panelRegion));

  let failed = 0;
  for (const { name, ok, detail } of results) {
    if (!ok) failed += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  }
  console.log(`\n${results.length - failed}/${results.length} 通过`);
  cleanup();
  process.exitCode = failed === 0 ? 0 : 1;
}

// 同步的：规则本身是纯函数，异步的只有上面那次 esbuild 加载。
main();
