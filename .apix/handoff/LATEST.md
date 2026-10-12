# 上下文交接 · 第 1 次

- 时间：2026-10-12 14:52
- 工作区：`C:\projects\APIX`
- 会话主题：APIX（pi 的 Tauri 前端）连续六轮优化 —— 改配置不再重启引擎、新会话视图修正、内置 skills 体系、配色修正、删两个不动的背景

> 这份文档写给**失忆后的自己**。压缩之后你对这轮对话没有任何记忆，只有这份文档能救你。
> 下面每一节都是为此写的：不要复述代码，要写「做了什么 → 为什么 → 怎么验证的」。

---

## 这个工程是什么

APIX 是一个 **Tauri 2 桌面壳 + React 前端**，壳里跑一个 `pi`（`@earendil-works/pi-coding-agent`，**v1.1.0**）子进程，通过 **stdin/stdout 的 JSON 行 RPC**（`pi --mode rpc`）驱动。用户在界面上做的事，本质都是发给 pi 的命令。

- 前端：`src/`（React + TypeScript，无 UI 框架，自建 `ui/kit.tsx`）
- 壳：`src-tauri/`（Rust，Tauri commands 暴露给前端）
- pi 配置目录：`C:\Users\NPC-341\.pi\agent\`（`models.json` / `settings.json` / `mcp.json` / `skills/`）
- APIX 自己的数据：`%APPDATA%\APIX\state.json`（**故意不放进 pi 的目录**，否则 pi 会看到它不认识的键）
- 内置 skill 资产：`src-tauri/assets/skills/<id>/SKILL.md`，用 `include_str!` 编译进 exe，启动时物化到 `<agent>/skills/`

**这个工程不是 git 仓库。** 没有 `git stash` 这种兜底，改坏了只能靠 `scripts/deploy.mjs` 旁边的旧 exe。所以：
- **批量改动之后必须 `tsc --noEmit`**（本轮就有一次批量删除脚本吃掉了相邻字段，只有 tsc 抓到）；
- 构建前确认 **APIX 没有在运行**（覆盖 exe 会失败）。

---

## 之前做了什么

按时间顺序，六轮。每轮都写清「根因是什么」，因为根因才是下次能用的东西。

### 1. 模型供应商页「默认」标记里没有字

- **现象**：AI-AAA 名字右边的黄色胶囊是空的。
- **根因**：`.cell-flag` 写 `background: var(--apx-amber-soft)` + `color: var(--apx-amber-label)`，而**深色主题下这两个令牌逐字节相同**（都是 `#ffb340`）。浅色下 label 是 `#c93400`，所以**只在深色主题出现**。
- **真正的病根不是那一行**，而是 `--apx-amber-label` 被要求干两件互斥的事：在**实心**琥珀底上当字（要暗色）、在页面/半透明琥珀底上当琥珀色文字（要亮色）。后两个用法（`.status-warn`、`.skill-row-tag`）才是它的本职，所以**没有改它**，而是拆出 `--apx-amber-ink: #3a2400`（两套主题同值，因为两者的实心底是同一个亮琥珀）。
- 对比度：修前深色 **1.00:1**，修后 **8.22:1**（深）/ **7.55:1**（浅）。

### 2. 改配置不再重启引擎 —— 本轮最大的收获

**用户诉求**：改各种配置后不要重启引擎（原先要按「重启引擎」，约 5.6 秒）。

- **探测出的机制（关键，靠读 pi 源码 + 隔离探针实测，不是猜的）**：
  - pi 把「原地重读」`ctx.reload()` **只暴露给扩展**（`core/agent-session.js:2945` 附近；`modes/rpc/rpc-mode.js:252` 把它注册为 `commandContextActions.reload`）。**RPC 没有任何对应命令。**
  - 唯一通路：自己写一个扩展注册命令调 `ctx.reload()`，用 `pi --extension <path>` 带上，配置写完后发 `prompt { message: "/apix-reload" }` 触发。
  - `ctx.reload()` 会 `settingsManager.reload()` + `resourceLoader.reload()` + `_buildRuntime()`，覆盖 models/settings/skills/mcp，**且会话与对话记录不动**（sessionId / sessionFile 不变）。
  - 实测开销：**重启（spawn→就绪）5.5–5.9s；原地重读首次约 4.1s、之后稳定 1.1s**。加 `-e` 对冷启动的影响约 0.2s（可忽略）。→ 因此 App 在引擎就绪且非忙时**后台预热一次**。
  - `prompt` 发 slash 命令返回 `{"disposition":"handled"}`，**不产生用户消息**（实测 0 条），不污染对话。
- **落地**：
  - `src-tauri/src/config.rs`：新增 `apix_dir()`（`state_file()` 改为复用它）、`APIX_RELOAD_EXTENSION`（内嵌扩展源码）、`apix_reload_extension()`（内容变了才写）。**扩展写在 `%APPDATA%\APIX\`，不是 `<agent>/extensions/`** —— 否则 pi 的其它前端（自带 TUI、dsh）会多出一个只属于 APIX 的命令。
  - `src-tauri/src/pi.rs`：`command.arg("--extension")`，用 `if let Ok` 包裹（写失败只是没有 reload，不阻止 pi 启动）。
  - `src/hooks/usePi.ts`：`reloadConfig()` —— `waitUntilIdle()` → 发命令 → `reloadSkills()` → 推进 `engineGeneration`；`reloadRef` 合并并发调用。
  - `src/components/settings/Settings.tsx`：`dirty` 布尔标记删掉，改成 `onApplyConfig()` + 300ms 防抖 + 尾部合并（`applying`/`queued` 两个 ref）。左下角三态：「正在应用配置…」/「配置已应用，无需重启」（2.6s 自动消失）/「配置未能自动应用」+ 重启按钮。**重启按钮只在失败时出现。**
- **⚠️ 预热必须按「进程」记账，不能按 `engineGeneration`** —— reload 自己会推进 generation，按它记账会无限自我触发。第一版就写错了。

### 3. 新会话视图两处修正

- **压缩上下文在新会话页面不该能点**：`disabled={!ready || !conversation}` + `disabledReason`（tooltip 说明原因）；`useHandoff.start()` 里加第二道闸。顺带发现 `.cmd-btn:disabled` 原来**只改了 `cursor`**（颜色描边都不变，看着和可用时一样，这正是它还会被点的原因），改成 `color: label-4` + `border-color: hairline-1`，并加 **`pointer-events: none`** —— Chrome 对 disabled 控件不发鼠标事件、也不转给父元素，而禁用的**原因**就写在这个按钮的 tooltip 里，不这样处理那句解释永远看不到。
- **点「新会话」背景跳两次**：背景的 React `key` 原来是 `activeChat?.id ?? state.sessionId ?? "empty"`，而 **`addChat` 会改 `activeChat.id`** → 在空视图已经显示着的时候点 `+`，key 变了 → 背景卸载重挂 → 又随机一张盖上去。改成 **`key={ws.activePath ?? "none"}`**（只要工作区不变就不可能重挂）。多样性没丢：显示过对话后背景本就被卸载，再回空视图必然重新 roll。

### 4. 两个新内置 skill

- `apix-skill-author`（创建/安装 skill）、`apix-mcp-author`（添加/安装 MCP、验证、OAuth 登录、排查）。
- **命令名来自 frontmatter 的 `name`，不是目录名**（`agent-session.js` 的 `_expandSkillCommand` 用 `s.name === skillName` 匹配 `/skill:<name>`）。所以 **`name` 必须等于目录名**，否则「装了但打不出来」。已用活体测试验证：改坏 name 后 pi 注册的命令变成 `skill:apix-skill-author-TYPO`。
- `pi mcp` 是**官方给 agent 用的接口**（`extensions/mcp/cli.js` 注释原话：*"Agents run it through bash to configure servers"*）：`add/remove/list/login/logout`，`--env/--cwd/--header/--bearer-token-env-var/--exposure/--description/-l`。本机 `pi` 在 PATH 上。
- MCP schema（`core/mcp-servers.js`）：名字 `^[A-Za-z0-9_-]+$`；`command`(stdio) 与 `url`(http/https) **二选一**；`type:"sse"` 已不支持；`exposure ∈ codemode/deferred/direct/hidden`。
- **内建标记 `apix-managed` 有三重作用**：`scan_skills` 用它判 `builtin`、`skill_delete` 用它拒绝删除、`ensure_builtin_skills` 用它决定升级时是否覆盖。**用户自己的 skill 绝不能带**（否则删不掉还会被覆盖）。`apix-skill-author` 里明确写了「抄内置 skill 当模板时必须删掉那行」——因为内置 skill 自己就带着它。

### 5. skills 体系重构（三处修复）

用户诉求：① 输入框的模型先显示后变 `-` ② 输入框里的 skills 应该只表示「这个会话想长期用的」③ 设置页要能配「全会话默认开启」的 skills。

- **模型消失**：`clearTranscript()` 派发的是**整体回到 `initialState`** 的动作，把 `model` 也清成 `null`；而模型是 **pi 持有的**，且清空后没人再问 pi 要状态。时序：`start()` 里 `get_state`（模型显示）→ generation 变化触发 effect → 空工作区无 activeChat → `clearTranscript()` → 变 `-`。改成 **`clearTranscript`** 只清 `items`/`queued`，并**删掉了 `reset` 这个动作**（它唯一能做的就是丢 UI 还需要的事实）。`newSession()` 也改用它。
- **skills 语义**：`on = 对话开关 ?? 是否在全局列表`；列表 = **全局 ∪ 本会话手加**，没有第三种来源。内置 skill 不再有任何特例。
  - 前提是**先拆掉一个依赖**：原先「压缩上下文」按钮发的是 `/skill:apix-context-handoff`，命令只在 skill 被加载时存在 → 才有「内置恒开且锁定」的特例。现在 `useHandoff` 读出内置 skill 的内容，按 pi 自己的展开格式直接作为提示词发出（`skills.ts: skillInvocationText`，纯函数有测试）。
  - `favouriteSkills` **改名 `globalSkills`**，`normalizeUi` 里**迁移旧键**（否则升级后用户列表静默消失）。
  - `SkillsTab` 变成两张卡：「全局 skills」（加入即默认开，关掉＝移出，下面是「加入全局：」那排按钮）+「全部 skills」池子。
  - **连带后果（必须知道）**：内置 skill 不再恒常加载，所以 `/skill:apix-skill-author` 要先把它加进全局或本对话才会存在。这是「列表＝会触发的集合」的必然结果。好处是：什么都没配时提示词里一个 skill 的 description 都不占（原来恒占 475 字）。

### 6. 删两个不动的背景 + 输入框 Skills 区域

- **删掉 `crystal`(CrystalGlow) 与 `arc`(PredictiveArc)**，池子 13 → 11。根因都不是库：
  - `crystal` 的 CSS 是 `color: transparent`，字母由 **6 层橙色 `text-shadow`** 画出，**每层偏移都乘 `--hover`**，而 `--hover` 只在 `:hover` 时变 1；背景容器 `pointer-events: none` → 永远 hover 不到 → 6 层叠成一块静止的实心橙色 APIX。**它是 13 个里唯一没有任何帧循环的。**
  - `arc` 的点阵本身是静态的，shader 只让那道弧带亮度在 ±30% 呼吸，看起来就是不动。
  - **导 three 的仍然只有 `bubbles`(BubbleText) 与 `particles`(GlowingParticles)`**，且这两个组件里一个橙色字面量都没有。
- **输入框 Skills 区域**：名字由省略号改成**换行**（`.skill-row-name`），说明最多两行（`-webkit-line-clamp: 2`）；弹出层 340 → **400px**（旧版那个「添加 skill」列表套的是 `.popover-list-short`，**只有 150px**，大部分截断来自它）；已安装清单从常驻展开改成**收在加号后面**（`picking`）；全部加入时加号消失。**抽成 `SkillsPanel` 子组件**——`Popover` 关闭时卸载 children，所以选择器状态天然不跨次残留。

---

## 当前状态

- **全绿**：11 个检查脚本，共 **310 条断言**全过。
  `rich 50 / rail 22 / duration 17 / session-recovery 19 / persistence 12 / backdrops 15 / skills 48 / theme-ink 9 / reload 30 / newchat 35 / builtin-skills 53`
- `tsc --noEmit`、`cargo check --release`、`vite build` 均通过。
- **已构建并部署**：`44cae8463e5e919c2f024a7dfac3f520bcdd902f04dad37555670fbbd583dd6a`（apix.exe 10.31 MB），NSIS 安装包 4.35 MiB，`diag-shortcut` PASS。
- APIX 进程**未运行**（构建时可覆盖）。
- 用户当前的持久化状态：`theme: dark`、`fontScale: 1.12`、`globalSkills: []`（旧键 `favouriteSkills: []`）、`visibleProviders: []`；没有会话带 skills 开关。

### 怎么复现验证

```bash
cd C:\projects\APIX
N="C:/Users/NPC-341/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"

# 全量检查（纯 node，无副作用，秒级）
for f in rich rail duration session-recovery persistence backdrops skills theme-ink reload newchat builtin-skills; do
  printf "%-20s " "$f"; "$N" "scripts/check-$f.mjs" 2>&1 | tail -1
done

# 类型检查
"$N" node_modules/typescript/bin/tsc --noEmit
```

### 构建与部署

```bash
cd C:\projects\APIX
tasklist //FI "IMAGENAME eq APIX.exe"      # 先确认没在跑
PATH="/c/Users/NPC-341/.cargo/bin:$PATH" \
  "C:/Users/NPC-341/.workbuddy/binaries/node/versions/22.22.2-6/node.exe" \
  node_modules/@tauri-apps/cli/tauri.js build          # 约 2.5 分钟，务必放后台
"$N" scripts/deploy.mjs                                 # 复制到 %LOCALAPPDATA%\APIX\
"$N" scripts/diag-shortcut.mjs                           # 图标一致性
```

**部署完不需要也不应该由 AI 去启动 APIX** —— 启动由用户来。

---

## 踩过的坑

**这一节最重要**，每条都是「现象 → 根因 → 下次怎么避免」。

1. **Bash heredoc 在这个环境会吃掉反斜杠**。`cat > f << 'EOF'` 里的 `\(`、`\$1`、`\r\n` 会被改写，导致脚本语法错误。→ **凡是含反斜杠的脚本一律用 Write 工具落盘**，别用 heredoc。
2. **批量删除脚本的结束标记写成 `"\n"`**，结果把**相邻字段**（`Palette.dither`）一起吃掉了。tsc 报 `'dither' does not exist in type Palette` 才暴露。→ 批量改完**必须 tsc**；结束标记要用有辨识度的字符串，别用换行。
3. **给 `react-dom/server` 打的 esbuild 包漏了 `banner`**：
   `banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" }`。
   缺了它会报 `Dynamic require of "stream" is not supported`；而我把 import 失败**静默 catch 成空串**，导致一批「界面里不含某个名字」的断言**假通过**。`check-rail.mjs` / `check-newchat.mjs` 早就有这个 banner。→ **渲染失败要让它响，不要 catch 掉。**
4. **`mkdirSync(path, { recursive: true })` 返回的是第一个新建的目录**（已存在则返回 `undefined`），**不是完整路径**。拿它的返回值当目录用 → 临时目录跑偏 → pi 起不来。→ 路径自己拼。
5. **子进程调用没加超时** → pi 起不来时整个检查脚本挂死（表现为「命令没反应」而不是失败）。→ `Promise.race` 或 `setTimeout`。
6. **注释里的破折号逐字匹配失败**：想删 `.star-toggle` 的 CSS，但脚本按注释文案匹配，`——` 数量对不上。→ 改成**按选择器定位 + 花括号配对**删规则，不依赖注释文案。
7. **双引号字符串里嵌双引号**：`check("...「模型突然变成 —」...", ...)` 写成 `"...「"模型突然变成—"」..."` 直接语法错误。→ 中文引言一律用 `「」`。
8. **检查脚本里断言"旧文案不存在"会被自己的注释骗过**。→ 断言前先 `stripComments`。
9. **`clearTranscript` 用整体 reset 抹掉模型** —— 见上文第 5 轮。教训：清界面 ≠ 清状态，**先问"这个字段是谁的"**。
10. **`disabled` 只改 cursor 是不够的**，而且 **`disabled` 会让 tooltip 变得不可达**（Chrome 不派发鼠标事件给 disabled 控件，也不转给父元素）→ 要 `pointer-events: none` 把 hover 让给 tooltip 宿主。
11. **vendored 组件当装饰有个隐坑**：纯 `:hover` 驱动的件当背景等于冻住。→ 已写成检查规则（见下）。

---

## 压缩后仍需记住的关键细节

### 路径

| 用途 | 路径 |
|---|---|
| 工程 | `C:\projects\APIX` |
| pi 的 agent 目录 | `C:\Users\NPC-341\.pi\agent\` |
| APIX 数据（state.json） | `%APPDATA%\APIX\` |
| 内置 skill 资产 | `C:\projects\APIX\src-tauri\assets\skills\<id>\SKILL.md` |
| pi 可执行 shim | `C:\nvm4w\nodejs\pi`（1.1.0，**在 PATH 上**） |
| pi 的 cli.js | `C:\nvm4w\nodejs\node_modules\@earendil-works\pi-coding-agent\dist\cli.js` |
| node（受管） | `C:\Users\NPC-341\.workbuddy\binaries\node\versions\22.22.2-6\node.exe` |
| cargo | `C:\Users\NPC-341\.cargo\bin\cargo.exe` |

### pi 的关键事实（都是实测/读源码确认的，不要重新怀疑）

- **RPC 命令全集**里**没有** reload / 重载配置。只有 `prompt/abort/new_session/get_state/set_model/...`（`modes/rpc/rpc-mode.js`）。
- **`ctx.reload()` 只给扩展**。想触发它就必须自己带一个扩展（`--extension`）+ 发 `/skill:` 之外的**自定义命令**（`prompt { message: "/<命令名>" }`）。
- **`new_session` 会重发 `session_start`**（`rpc-mode.js` 的 `rebindSession` → `bindExtensions` → `agent-session.js` emit），所以**新建会话会重读 `mcp.json`**，MCP 不用重启引擎就能生效。
- **skills 白名单是 spawn 期参数**：`--no-skills --skill <path>`。`ctx.reload()` 会**保留**这个白名单（已实测），但**新增**一个 skill 路径仍需重启引擎。
- `/skill:<name>` 的 `<name>` 是 **frontmatter 的 `name`**，不是目录名。
- `formatSkillsForPrompt` 只把 **name + description + location** 放进系统提示词；正文只在真正调用时读。→ **内置 skill 的 description 是每次请求都要付的钱**。
- `pi mcp list` 会打印每个服务器的状态/工具/错误，连不上时**非 0 退出**。日志在 `<agent>/mcp.log`。
- `--mode rpc` 的 `get_state` 会稳定返回 `model`，`new_session` 前后不变。

### 检查脚本（= 可执行的规格）

11 个，共 310 条断言，**都是"断言最终行为"而不是断言代码长相**：

| 脚本 | 钉住什么 |
|---|---|
| `check-skills.mjs` (48) | skills 规则（含**真渲染** SkillsPanel）+ `skillInvocationText` 格式 |
| `check-builtin-skills.mjs` (53) | 内置 skill 清单/frontmatter/**活体起一次 pi 验 `/skill:` 注册** + description 预算 |
| `check-newchat.mjs` (35) | 压缩上下文按钮可用性 + 背景 key 的**标识符集合** + **真跑 reducer** 验模型不被清掉 |
| `check-reload.mjs` (30) | 原地重载接线（**把 Rust 里内嵌的扩展源码当模块真加载**）+ 扩展落在正确目录 |
| `check-theme-ink.mjs` (9) | **通例**：任何规则的文字色令牌 ≠ 自己的底色令牌 + WCAG 对比度 |
| `check-backdrops.mjs` (15) | three 的使用者/懒加载 + **「池子里没有只有 hover 才动的背景」** + VARIANTS/PALETTE/JSX 三者对齐 |
| 其余 5 个 | 富文本、rail、时长、会话恢复、持久化 |

**加新功能时的纪律**：先在对应的 check 脚本里写断言，再改实现，然后**用「把旧行为改回去 → 断言 FAIL → 恢复 → PASS」验证测试本身有效**。本轮每一轮都这么做。

### 环境约束与用户偏好

- 中文交流；输出偏好**结论先行 + 分层细节 + 对比表格**，反对冗长铺垫。
- **不自动 commit / push**（工程也没 git）；**不自动启停 APIX**，只上传文件。
- 构建前确认 APIX 没在运行。
- 改配置要**增量最小化**，不顺手动无关代码。
- 落地前要求**执行前代码审查 + 安全确认 + 多次复检**（"你有 100% 把握吗"）。
- **没装 agent-browser**（要拉 Chromium ~500MB），所以视觉改动一律用「真实样式表 + 真实类名的静态预览页」交付，不截图。

---

## 还有什么目标

用户没说新聊天要做什么。已知的、可以接着做的：

1. **切换工作区仍要重启引擎**（约 5.6 秒）。根因：`cwd` 是 spawn 期参数，pi 无法原地换目录。如果要优化，只能考虑「常驻一个引擎 + 每个工作区一个会话目录」之类的架构，不是小改动。
2. **「设为默认模型」要不要顺带切当前对话**。目前不切（按钮文案是「新会话默认」，且 pi 的语义就是只管新会话）。用户如果期望切，得单独加。
3. **没做浏览器实录验证**。配色与弹层样式都是靠「真实 CSS 渲染的静态预览页」+ 可计算的对比度断言，不是截图。如果要做视觉终审，得先装 agent-browser。

---

## 暂定的后续计划

新聊天开始时，先做这件事：

1. **先跑一遍全量检查**，确认接手的是绿的（命令见「怎么复现验证」）。310 条断言、秒级。
2. **读 `LATEST.md`（就是这份）**，再读 `src/hooks/usePi.ts` 的 `reloadConfig` 与 `src/lib/skills.ts` —— 这两个文件是本轮改动最集中的地方。
3. 然后按用户的新需求动手。**动手前先确认需求**（这个用户会明确说清楚要什么，但也会追加"还有需要优化的"，所以一次只做他点名的那几条）。
4. 改完：`tsc` → 全量检查 → 构建（放后台）→ 部署 → 汇报。**汇报里必须写清：哪些是根因、哪些是验证出来的、哪些没验证。**

---

## 未决问题

1. **新聊天要做什么？**（最关键）
2. **删掉的两个背景是不是他要删的那两个？** `crystal` 置信度很高（源码级的因果链完全对上「橙底 APIX 白字、静止」）；**`arc` 略低** —— 点阵类候选还有 `dither`（DitherReveal，抖动网点）。我按「用户自己点名了 predictive-arc + arc 的点阵是静的」选了 arc。如果他回来说"还有一个也不动"，那大概率是 `dither`：它的 shader 里 `revealAmount` 乘了 `uMouseActive`，而背景永远没有指针 → 指针揭示的那部分永远不出现。
3. **「设为默认模型」的语义**（见「还有什么目标」第 2 条）。
4. 内置 skill 现在**默认不加载**，用户想要 `/skill:apix-skill-author` 就必须先把它加进全局或本对话。**这个告知过了，用户没反对，但也没说"这样也行"** —— 如果他反馈"打不出来"，根因就在这。
