# APIX

APEX + pi。一个极轻量的 Windows 桌面编码助手：**pi 做引擎，Tauri 做壳，自建 React 前端**。

不是 Web UI，也不是给浏览器套个窗口——是一个有托盘、有独立进程、安装包 MB 级的原生桌面应用。

```
┌──────────────────────────────────────────────┐
│  APIX · Windows desktop app                  │
│  ┌────────────────────────────────────────┐  │
│  │ Frontend · WebView2 (React + TS)       │  │
│  └───────────────────┬────────────────────┘  │
│                 invoke / event               │
│  ┌───────────────────┴────────────────────┐  │
│  │ Tauri Rust host                        │  │
│  │ IPC · sidecar lifecycle · tray · update│  │
│  └───────────────────┬────────────────────┘  │
│              JSONL stdin / stdout            │
│  ┌───────────────────┴────────────────────┐  │
│  │ pi engine · pi --mode rpc (Node 22.19+)│  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

## 核心设计

**不重写 agent loop。** pi 官方提供 RPC 模式（`pi --mode rpc`），stdout/stdin 走严格 JSONL，官方文档明确说这个模式就是给 *IDE 和自定义 UI* 用的。APIX 只做三件事：起子进程、发命令、渲染事件。

| 层 | 选型 | 说明 |
|---|---|---|
| 桌面壳 | Tauri 2 | Windows 用系统 WebView2，无需打包浏览器内核 |
| 前端 | React 18 + TypeScript + Vite | 无 UI 框架依赖，纯手写深色密集布局 |
| 引擎 | pi（子进程） | 通过 `pi --mode rpc` 驱动，进程隔离 |
| 传输 | JSONL over stdio | 直用 pi 协议，不发明新协议 |
| Node | 复用系统 Node | 不打包运行时，安装包保持最小 |

## 环境要求

- **Node.js ≥ 22.19**（pi 的硬性要求）
- **pi CLI**：`npm install -g --ignore-scripts @earendil-works/pi-coding-agent`
- **Rust 工具链** + **MSVC C++ 生成工具**（Tauri 在 Windows 上必需）
- WebView2（Windows 11 / 较新的 Windows 10 自带）

安装 Rust：

```powershell
winget install --id Rustlang.Rustup
winget install --id Microsoft.VisualStudio.2022.BuildTools --override "--quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

装完重开终端，`rustc --version` 必须带 `-pc-windows-msvc` 才算通过。MSVC 那几个 G 是 Tauri 路线躲不掉的成本。

## 跑起来

```powershell
cd C:\projects\APIX

npm install
npm run icon        # 由 app-icon.png 生成 src-tauri/icons/，只需跑一次
npm run app:dev     # tauri dev：起 Vite + 编译 Rust + 开窗口
```

首次编译 Rust 依赖需要几分钟。之后改前端是热更新，改 Rust 会自动重编译。

## 打包成 exe

```powershell
npm run app:deploy
```

一条命令走完：release 构建 → 复制到桌面 → 复制到 `%LOCALAPPDATA%\APIX`。之后**双击桌面上的 APIX 图标即可启动**，不需要再碰 npm 或终端。

产物三份：

| 产物 | 路径 | 说明 |
|---|---|---|
| 免安装 exe | `src-tauri\target\release\apix.exe` | 构建原始产物 |
| 部署副本 ×2 | `<桌面>\APIX.exe`、`%LOCALAPPDATA%\APIX\APIX.exe` | 双击即用 |
| NSIS 安装包 | `src-tauri\target\release\bundle\nsis\APIX_0.1.0_x64-setup.exe` | 1.69 MB，含卸载器 |

不想用便携版、要正式的「开始菜单 + 卸载器」，就跑安装包（被动模式会自动建桌面快捷方式，因为 finish 页被跳过）：

```powershell
& "src-tauri\target\release\bundle\nsis\APIX_0.1.0_x64-setup.exe" /P
```

**为什么桌面放的是 exe 而不是快捷方式**：创建 `.lnk` 必须走 COM（`WScript.Shell` 或 `Shell.Application`），本机策略禁止脚本实例化 COM 对象。exe 自带图标和名称，摆在桌面上观感一样。要快捷方式就用上面那个安装包。

**关于 release 构建速度**：`Cargo.toml` 用 `lto = "thin"` + `codegen-units = 16`，整条链路约 6 分钟。要再压体积就换成 `lto = true` + `codegen-units = 1`，代价是构建时间涨到十几二十分钟。

**启动位置**：从图标启动时进程的工作目录是 exe 所在目录，对 pi 毫无意义。所以 APIX 把用户最后一次应用的工作区记在
`%APPDATA%\APIX\state.json`，下次启动直接回到那个项目。这个文件故意不放在 `~/.pi/agent`，免得让 pi 看到不属于它的键。

## 操作

| 动作 | 快捷键 / 位置 |
|---|---|
| 发送 | `Enter` |
| 换行 | `Shift + Enter` |
| 追加指令（插入当前运行轮次之后） | 工作中 `Enter` |
| 排队等待（等本轮完全结束后执行） | `Alt + Enter` |
| 中断当前运行 | `Esc` |
| 切换模型 | 输入框左下「模型」→ 搜索并点选 |
| 切换思考强度 | 输入框左下「思考」→ 点选 |
| 切换主题 / 字号 | 左侧栏底部「设置」→ 外观（即时生效，不用重启引擎） |
| 折叠工作区或会话列表 | 点分组标题行左侧的箭头 |
| 重启引擎 | 左侧栏底部「设置」右边的圆箭头 |
| 复制 / 修改 / 删除某一轮提问 | 鼠标移到该条提问气泡上，左侧浮出三个按钮 |
| 跳到某一轮提问 | 对话区右侧的刻度轨，点刻度或悬停看摘要 |

**关窗口 = 收进托盘**，会话不中断。真正退出用托盘菜单的「退出 APIX」。

### 提问的复制 / 修改 / 删除

pi 的 RPC **没有**改消息或删消息的命令，但它有 `get_fork_messages` 和 `fork`：

| 动作 | 实现 |
|---|---|
| **复制** | 纯前端，写剪贴板（`navigator.clipboard`，失败时退回 `execCommand`） |
| **修改** | `fork(entryId)` → pi 把会话**回退到这条提问之前**，并返回它的原文 → APIX 把原文灌回输入框，你改完重新发送 |
| **删除** | 同样 `fork(entryId)`，只是不回填输入框 |

三点必须说清楚，不然容易误解成「就地编辑」：

1. **回退会切出一条新会话**，不是原地修改。`fork` 之后的 `sessionFile` 变了，所以 APIX 会把工作区索引里的会话文件同步成新的那个。
2. **删除中间的提问会连带丢掉它之后的全部对话**——分支是从那里切断的。所以删除前有确认框，并且文案里会写明这次要不要丢尾巴。
3. **原分支不会消失**。pi 的会话文件是树，被切掉的分支仍在磁盘上，只是不属于当前对话了。

删除用的是 APIX 自己的确认框（`ui/kit.tsx` 的 `ConfirmDialog`），不是 `window.confirm`——系统弹窗用的是它自己的字体和按钮，和界面格格不入。

### 提问刻度轨

对话区右侧一列刻度，每轮提问一个。**位置按跳转后的滚动偏移分配**，所以刻度和滚动条是对齐的：80% 处的刻度就是快到底了。这一点和代码缩略图（minimap）的算法一致，也意味着刻度不会全挤在顶端——这个映射在 `TurnRail.tsx` 的 `measure()` 里。

- 悬停显示「第 N 轮」+ 提问摘要（截 160 字）
- 点击平滑滚动过去，`is-active` 的那个跟随滚动位置高亮

刻度只在**轮数 ≥ 2** 时出现。

### 工具栏

顶部只显示 `工作区 / 会话`。**所有操作都在左侧栏**——新会话是分组标题右侧的 `+`，设置和重启引擎在栏底。做法上这是把「目前在哪」和「能做什么」分开：标题栏只负责前者，后者集中在同一个地方。

### 队列

pi 正在工作时你继续发的消息会排队，它们显示在**输入框正上方**：

- 队列为空时整块不显示
- **只有 1 条**直接列出
- **多于 1 条自动折叠**成「N 条待处理」，点标题行展开

标签区分两种：`追加`（steering，插到当前轮次之后）和 `排队`（follow-up，等本轮完全结束）。

输入框上方这块区域以后会放常用指令，目前空着。

### 状态栏

底部状态栏**不重复界面上已有的信息**——工作区路径在左侧栏，模型在输入框里。它只显示那两处放不下的：

| 位置 | 内容 |
|---|---|
| 左 | **上下文用量** `167K / 1M`（来自 pi 的 `get_session_stats` → `contextUsage`），左边配一条进度条 |
| 左 | **缓存命中率** = `cacheRead / (input + cacheRead)`，越高越省 token、首字越快 |
| 右 | 本会话累计 `↑输入 ↓输出` token、费用（美元）、运行状态 |

**分子分母都是真实的。** `contextUsage.contextWindow` 取自**当前运行模型**的 `contextWindow`——也就是你在「设置 → 模型供应商」里填的那个值，填 `1M` 这里就显示 `1M`（pi 侧 `provider-composer.ts` 是 `definition.contextWindow ?? 128000`，models.json 的值确实会流进模型对象）。切换模型后会重新拉一次，不会残留上一个模型的窗口大小。

`contextUsage.tokens` 在**刚压缩完、下一次回复还没报 usage 时是 `null`**，这时显示 `—` 而不是 `0`——显示 0 会让人以为上下文空了。

数据在每轮结束时、会话切换时、模型切换时刷新（流式期间的数字是半成品）。

**上下文超过 70% 会变热**：进度条泛起琥珀→红的流动渐变、外发光和闪烁，同时右上角的「压缩上下文」按钮开始蓝色呼吸——一头在烧，一头在提示你按它降温。阈值是 `StatusBar.tsx` 里的 `CONTEXT_HEAT_THRESHOLD`。

动效全部在 CSS 里，`data-reduce-motion="true"` 会自动关掉。

### 思考强度

在输入框左下的「思考」里切换，**真的会写进 pi**。

这里修过一个实打实的 bug：`set_thinking_level` 的响应**不带任何 payload**，而旧代码发完就结束了——状态机里连 `set_thinking_level` 分支都没有，所以选完下拉框标签根本不变。现在发完会立刻 `get_state` 读回来，显示的是 pi 实际接受的值（不支持时 pi 会夹取而不是报错）。

**可选等级怎么算出来的**：pi 的 `get_available_thinking_levels` 回答的是「这个模型协议上接受哪些等级」，而 `models.json` 里模型的 `thinkingLevelMap` 才是细粒度的那一层——**映射到 `null` 的等级必须从选择器里去掉**，否则用户能选中一个静默无效的选项。两个集合的交集由 `usePi.ts` 的 `resolveThinkingLevels()` 计算，等级变化时会重新拉取（旧代码只在引擎启动时拉一次，换模型后列表是过期的）。

只有一个等级时选择器直接禁用，并说明原因。

## 上下文交接

右上角的「压缩上下文」**不是直接压缩**。直接压缩会把这一轮的工作全丢掉，什么都没留下。它走的是一条两阶段流程：

```
点击「压缩上下文」
  → APIX 发 /skill:apix-context-handoff
  → pi 按 skill 执行四步：
       ① 整理工作区（列出「原路径 → 新路径」表，不删任何文件）
       ② 写交接文档（编号文件 + LATEST.md）
       ③ 输出首轮提示词（可直接粘贴的代码块）
       ④ 最后一行输出哨兵 [[APIX-HANDOFF-READY]]
  → APIX 检测到哨兵、且本轮已结束
  → APIX 发 compact，才真正压缩
```

**哨兵是安全闸**：pi 报错、用完轮次、或者忘了输出哨兵，APIX 就**不压缩**，只弹一条提示，会话原样保留。宁可多留一轮，也不能在没有交接文档的情况下把上下文丢了。

**为什么不让 skill 自己压缩**：压缩是用户级操作（`/compact` 是斜杠命令），模型无权触发，所以必须由 APIX 在确认之后发 `compact` RPC。

### 内置 skill

`src-tauri/assets/skills/apix-context-handoff/SKILL.md` 用 `include_str!` 编进二进制，启动时由 `ensure_builtin_skills()` 写到 `~/.pi/agent/skills/`。

文件里带一行 `apix-managed` 归属标记：

- 标记在 → 内容与内置版本不一致时会被覆盖（升级跟得上）
- **标记被删掉 → APIX 永久不再碰它**，你的本地改动不会被升级冲掉

### 交接文档

写在 `<工作区>/.apix/handoff/`：

- `<N>-<YYYYMMDD-HHmm>.md` — 编号即「第几次压缩」，保留历史
- `LATEST.md` — 同样内容，路径稳定，下一轮不用去找编号

必须包含的章节：之前做了什么 / 当前状态 / 还有什么目标 / 暂定的后续计划 / **踩过的坑（现象 → 根因 → 下次怎么避免）** / 压缩后仍需记住的关键细节 / 未决问题。

### 首轮提示词

交接完成后 pi 会输出一个代码块，形如：

```
请仔细阅读 C:\projects\APIX\.apix\handoff\LATEST.md 文档，然后继续 <下一步要做的事>
```

**代码块上悬停会出现复制按钮**——因为这句话就是要被复制走的，不该让人手敲。

## 工作区与会话

左侧栏分两段：上面是**工作区**，下面是当前工作区的**会话**。

- **工作区就是一个目录**——pi 的 cwd。点右上角 `+` 用系统目录选择器添加，或点「手动输入路径」敲路径。**切换工作区会重启 pi 进程**（cwd 在 spawn 时确定，改不了）。
- **会话映射到 pi 的 session 文件**。新建会话走 pi 的 `new_session`，切换走 `switch_session`，改名走 `set_session_name`。
- 悬停任意一行出现操作图标：会话可**重命名**（`✎`）或**从列表移除**（`✕`，只移除索引，**不删 pi 的会话文件**）。

**为什么 APIX 要自己维护一份索引**：pi 的 RPC 没有 `list_sessions` 命令，而它自己的 session 文件是 zstd 压缩的，读不了。所以 APIX 在
`%APPDATA%\APIX\state.json` 里记一张目录表（工作区 → 会话 → pi 的 sessionFile）。消息内容仍然完全由 pi 掌握，APIX 只存目录。

### 索引写入必须是函数式的

`useWorkspaces` 的每个改动都走 `commit`，它从 **ref** 读最新列表，而不是从渲染闭包读。这一点是被一个大 bug 逼出来的：

```ts
const chat = ws.addChat(path);           // 写入 1
const info = await pi.newSession();      // 让出
ws.bindSession(path, chat.id, ...);      // 写入 2
```

调用方在两个写入之间必然要 `await` 一次引擎往返。而 `bindSession` 如果从闭包里的 `workspaces` 重建整个数组，那就是**基于写入 1 之前的快照**——**刚建好的会话当场被删掉**。症状就是「切到某工作区，会话列表是 0」。改成 ref + 函数式更新后，两个写入各自看到对方的结果，同时所有 mutator 的函数标识也变稳定了。

（修到这里还不够——**写入 2 的内容本身也可能是过期的**，见上一节。）

### 会话绑定为什么必须小心

每个会话在索引里记一个 `sessionFile`。这里有两个坑，都会让「点开会话」变成一片空白：

**① pi 先给路径，后写文件。** `new_session` 立刻返回一个路径，但 **pi 只在第一次真正发出消息时才把文件落盘**。所以「新建了会话、没说话、就切走」会留下一个指向不存在文件的指针。点它 → `switch_session` 失败。

现在的处理：**打不开就按新会话打开**，并且明确告诉用户「记录打不开（原因），已作为新会话打开。原来的记录文件仍保留在磁盘上」。因为这种情况下**确实没有东西可恢复**，开一个干净会话比留一个死胡同更有用；而重绑不会删任何文件，所以那句话是真的。

为此 `switchSession` 不再自己弹报错，而是返回结果（`opened` / `cancelled` / 失败原因）——**只有调用方知道它有没有兜底**。

**② 并发启动的竞态（已修）。** 切工作区会重启 pi，两次启动可能重叠。每次启动都会调 `newSession`，而每个 session 属于**创建它的那个进程**。如果较早的那条链最后才完成，它会把一个**所属进程已经死掉、文件永远不会被写入**的路径写进索引——而那个进程里创建的那个 session 才是 pi 正在用的。

现象就是：**磁盘上明明有对话文件，索引却指向另一个名字（同一毫秒级前缀、尾部不同）**。

修法：绑定前比较引擎代数（`engineGenerationRef`）。因为代数只在 `start` 成功时递增，**只有最新一次启动允许绑定**——结果与两条链的完成顺序无关。这也是 `engineGenerationRef` 存在的理由：`start` 递增它的同时还没触发重渲染，等待中的调用方读 state 会拿到旧值。

**`scripts/repair-state.mjs`** 用来修复历史上已经坏掉的绑定（先干跑，加 `--apply` 才写）：

- 绑定的文件不存在时，看该工作区的会话目录
- 目录里**恰好一个** `.jsonl`，且修改时间**不早于**会话创建时间 → 认定是它，接回去
- 否则（没有文件，或唯一那份比会话还老，属于更早的孤儿会话）→ 置为 `null`，让它按新会话处理
- **只动 `sessionFile`，其他字段原样保留**；写回保持 2 空格缩进 + 键名排序，与 APIX 自身的写出一致

### 每个工作区至少有一个会话

两层保证：`normalize()` 读盘时会**给没有会话的工作区补一个**（顺带修复早期版本写下的空 `chats`），`removeChat()` 删掉最后一个会话时会**在同一个写入里补一个新的**。

因为没有活跃会话时，引擎就不知道该恢复哪个 session，对话区会一直停留在上一个工作区留下的内容上——这正是「切了工作区，页面还显示着别的东西」的来源。

### 「这是不是一个新会话」

判断依据是 `hasConversation(items)`：**只要有一条 user / assistant / tool 消息就算有对话**，`notice` 不算。

`items` 里除了对话还混着通知（模型被自动切换、扩展请求被拒绝…）。如果拿 `items.length === 0` 判空，一条通知就会把整个空状态顶掉——新会话页的背景、标题和「给它一个任务」的提示全都消失，只剩一行灰字。这就是「显示的是聊天内的页面，然后啥也没有了」。

顺带把那条模型提示改成**每次运行只出现一次**（而不是每次引擎重启一次）：切工作区会重启 pi，按引擎周期计的话这条提示会变成聊天记录里的常驻噪音。文案也补了怎么永久消掉它。

**已知限制**：直接在终端用 `pi` 开的会话，不会出现在 APIX 的列表里——索引只记 APIX 自己创建的会话。

## 新聊天背景

空会话时，对话区背后会随机加载一个装饰性背景。**换一个会话会重新掷一次**，深浅两套主题各有一套配色。

源码在 `src/components/backdrops/`，是从「高级组件」那套里 vendor 进来的 React + canvas/WebGL 组件（**零外部依赖**）：

| 组件 | 内容 | 文字参数 |
|---|---|---|
| `GlobeStudy` | 球面由重复字形拼成 | `phrase` |
| `GlassIcon` | 液体玻璃形状后面的字 | `backdrop.text` |
| `CloudSky` | 漂移的云场 | — |
| `CursorRingField` | 跟随指针的环形力场 | — |

**原始素材 6 个，只接了 4 个**：`Predictive Arc` 和 `Reflect Shader` 下载时引号和冒号被吞了，语法不成立——

```
import  as React from react          ← 应为 import * as React from "react"
function compile(gl WebGLRenderingContext, type number, src string)   ← 冒号没了
```

重新下载这两个文件后可以直接丢进 `src/components/backdrops/`。

### 深浅主题适配

四个组件的**出厂默认都是给深色背景设计的**，浅色主题下直接用会整个看不见。所以 `backdrops/index.tsx` 里立了一张表：

```ts
const PALETTE: Record<BackdropTheme, Palette> = { dark: {…}, light: {…} }
```

每个变体每个主题一套色，**这是唯一的调参入口**——想改背景观感就改这里，别处都不读它。

`--apx-backdrop-veil` 是盖在画面上的那层薄纱，深色用黑、浅色用白，让画面可见的同时空态文案也看得清。

包装层用 `useMemo(roll, [])` 每次挂载随机选一个，调用方用 `key={chatId}` 保证换会话重新掷。四个组件都被 `style={{minWidth:0,minHeight:0}}` 拉满容器（`GlobeStudy` 自带 `minWidth:1200`，不覆盖会把对话区撑出滚动条）。

## 设置

工具栏点「设置」，整页切换到设置视图（左侧分区导航 + 右侧卡片）。**APIX 不维护自己的配置存储**——它直接读写 pi 的文件，所以 GUI 改的和 `pi` 命令行看到的永远一致。

| 分区 | 落到哪 | 能做什么 |
|---|---|---|
| **模型供应商** | `models.json` + `settings.json` | 供应商表格（默认标记 / 复制 / 设为新会话默认 / 编辑 / 删除）+ 右侧抽屉。抽屉内覆盖 pi 的**全部**字段，见下一节 |
| **MCP** | `mcp.json` | 服务器表格 + 抽屉编辑（stdio 与 http 两种传输、exposure、env、headers、timeout、启用开关）；单独的 codemode 开关 |
| **Skills** | `skills/<名>/SKILL.md` | 表格 + 抽屉；新建时填 name/description 后直接进正文编辑；同时展示 `~/.agents/skills`（只读） |
| **通用** | `settings.json` | shellPath、theme、httpProxy、defaultTools、enabledModels、两个显示开关 |
| **原始文件** | 上面三个 JSON | 手改全文，后端先校验 JSON 再落盘 |

布局参考 StackFerry 的设置页：**整页 + 左侧分区导航 + 卡片堆叠，列表用表格，编辑一律走右侧抽屉**而不是内联表单。UI 原语在 `src/components/ui/kit.tsx`（Card / Field / Drawer / EmptyState / Badge）与 `src/components/ui/form.tsx`（Switch / NumberInput / Select / KeyValueEditor / JsonField / Collapsible），图标在 `Icons.tsx`（内联 SVG，不引图标库），设置页样式单独放在 `src/settings.css`。

### 模型供应商：字段覆盖范围

对照 pi 自己的 schema（`dist/core/model-config.d.ts`）逐项接的，没有留给「去手改 JSON」的缺口。

**供应商级**

| 分组 | 字段 |
|---|---|
| 基本信息 | 标识、`baseUrl`、`api`（8 种协议）、`apiKey`（带显示/隐藏）、`oauth`（radius）、`authHeader` |
| 请求头 | `headers` 键值对（密钥值默认遮蔽） |
| 兼容性 | `compat`——按 OpenAI / Responses / Anthropic 三个 family 分组，19 个布尔/枚举开关 + `vllmPriority` 数值 |
| 模型 | `models` 表格 + 一键从 `{baseUrl}/models` 拉取 |
| 覆盖 | `modelOverrides`（改内置/扩展模型的元数据，不替换模型列表） |
| 逃生舱 | 整个供应商的原始 JSON 编辑器 |

**模型级**（点模型行右侧的滑杆图标内联展开）

| 分组 | 字段 |
|---|---|
| 基础 | `id`、`name`、`api`、`baseUrl`、`reasoning` |
| 容量与价格 | `contextWindow`、`maxTokens`、`cost.{input,output,cacheRead,cacheWrite}`、`cost.tiers[]` 阶梯价 |
| 输入形态 | `input`（text/image）、`inputLimits.maxRequestBytes`、`inputLimits.images.{maxPerMessage,maxPerRequest}`、`resize.{maxWidth,maxHeight,maxBytes,jpegQuality}` |
| 思考映射 | `thinkingLevelMap` 七档（空＝不设置，`null`＝该档不支持） |
| 采样 | `samplingParams`、`samplingParamsByThinkingLevel` 按等级覆盖 |
| 缓存 | `promptCache.{short,long}` |
| 请求头 | `headers` |
| 兼容性 | `compat`（与供应商级同一个编辑器） |
| 逃生舱 | 单条模型的原始 JSON |

**上下文窗口和最大输出可以直接填 `1M` / `256K` / `64k`**，也可以填完整数字。为什么值得单独做：这是个一眼看不出对错的数量级——`1000000` 和 `10000000` 差一个零，谁都得数。显示时也会还原成简写。

解析在 `protocol.ts` 的 `parseTokenShorthand()`：**按十进制算**（`1M` = 1000000，不是 1048576），LLM 的上下文一律这么记。输入框用本地缓冲，只在失焦或回车时提交，所以打到一半的 `1` 不会被写进配置。**留空 = 不设置**，让 pi 用自己的默认值（`contextWindow` 128000）；写 `0` 是不行的，pi 会对非正的 `contextWindow` 直接抛错。

预设库在 `src/lib/providerPresets.ts`：DeepSeek、InferAI、OpenAI、Anthropic、OpenRouter、Gemini、xAI、Mistral、Groq、Moonshot、智谱、百炼、火山方舟、硅基流动、Ollama、LM Studio、vLLM。选中预设只填表单，不落盘。模型 id 只在长期稳定的厂商上预置，其余留给「拉取模型列表」。

几个设计上的取舍：

- **apiKey 不做本地存储**。填的是 `$ENV` / `${ENV}` / `!command` 或明文，和 pi 的解析规则完全一致——凭据最终由 pi 的 `auth.json` 或环境变量负责。
- **校验抄的是 StackFerry 的 `editor-validation`**：`missingText` / `nonHttpUrl`，并且**首次提交前不显红**——新打开的表单不该一片报警。`$ENV` 和 `!command` 开头不会被当成坏 URL。
- **写入前丢空白值，但保留 `false` 和 `0`**（`pruneBlank`）。`models.json` 走的是严格 schema，空字符串不是「不设置」——它会判错，而省略才会回落到 catalog。
- **模型列表以 `models.json` 为准**。pi 的 `get_available_models` 会把自带 catalog 里的模型也返回，所以只要 `models.json` 声明了**任何** provider，就只显示这些 provider 里声明过的模型；`models.json` 为空时才回退到「pi 报什么显示什么」（保证纯 `/login` 场景可用）。
- **当前模型不在配置里时会自动切回来**。pi 的启动模型取自 `settings.json` 的 `defaultProvider` / `defaultModel`，而**新会话每次都回落到这个启动默认值**。如果它指向的 provider 你已经不配了（典型情况：`settings.json` 里还留着旧的 `deepseek`，而 `models.json` 只声明了你自己的网关），这里会自动切到 `models.json` 里第一个模型并提示一次——否则每次新开会话都会悄悄回到官方模型。
  - 供应商行上的星标按钮直接写 `defaultProvider` / `defaultModel`，不用再去手改 `settings.json`。
- **思考等级不做兜底**。每个模型支持的等级不同，静态列表会给出无效选项，所以只认 pi 的 `get_available_thinking_levels`；拿不到时选择器直接禁用。
- **「拉取模型列表」借用 Node 的 fetch**（Node 是 pi 的硬依赖，必然存在），所以 Rust 侧不引 HTTP 栈。apiKey 通过环境变量传给子进程，不拼进脚本字符串。
- **删除 skill 不是真删**：目录被移到 `<agent>/.trash/<时间戳>-<名称>`，随时可恢复。
- **改完要重载**。pi 不会自动重读配置，改完左侧导航底部会出现「重启引擎」提示。

## 视觉体系

配色、排版、圆角、动效全部按 **Apple HIG（Human Interface Guidelines）** 的**系统色（System Colors）**来做：深浅两套主题，值是 Apple 官方色号，所以 APIX 和系统里其它窗口放一起不打架。

| 角色 | 深色 | 浅色 |
|---|---|---|
| 窗口底 | `#000000` (systemBackground) | `#FFFFFF` |
| 侧栏 / 状态栏 | `#1C1C1E` (secondarySystemBackground) | `#F2F2F7` |
| 卡片 / 输入框 | `#1C1C1E` | `#FFFFFF` |
| 分组背景（设置页） | `#000000` | `#F2F2F7` (systemGroupedBackground) |
| 强调色 | `#0A84FF` (systemBlue dark) | `#007AFF` (systemBlue light) |
| 用户气泡 | `#0A84FF` + 白字 | `#007AFF` + 白字 |
| 成功 / 警告 / 危险 | `#30D158` / `#FF9F0A` / `#FF453A` | `#34C759` / `#FF9500` / `#FF3B30` |
| 分隔线 | `rgba(235,235,245, .08~.32)`，**0.5px** | `rgba(60,60,67, .10~.36)`，**0.5px** |

实现上的几个决定：

- **`data-theme` 只存解析后的值**（`light` / `dark`），挂在 `<html>` 上。「跟随系统」在 JS 里用 `matchMedia('(prefers-color-scheme: dark)')` 解析，所以 CSS 不需要媒体查询，也不用把 token 块复制一份。
- **首屏不闪**。`localStorage` 里存一份主题副本，`applyBootTheme()` 在 `createRoot()` **之前**同步执行；Rust 的 state 文件仍是唯一数据源，hydrate 之后再对账。
- **表单控件用系统填充色**（`rgba(120,120,128,.12/.24)`）而不是固定色。这样同一套值放在窗口底、卡片上、抽屉里都成立——Apple 自己也是这么做的。
- **代码字体栈故意不写裸 `monospace` 兜底**。Windows 会把裸 `monospace` 解析到 SimSun 去渲染中文，和旁边的拉丁字符完全不是一个字形。
- **token 名是 APIX 自己的（`--apx-*`）**。早先用的是 dsh 的名字，值换成 Apple 色号后名字会严重误导，所以整体重命名过一次（`scripts/rename-tokens.mjs` 做过 494 处替换）。
- `color-scheme` 必须跟着主题走，否则 `select` 下拉、输入框光标、内嵌滚动条会按 UA 默认渲染成另一个主题。

### 外观设置

设置 → **外观**，三张卡：

| 卡 | 内容 |
|---|---|
| 主题 | 跟随系统 / 浅色 / 深色 |
| 字体 | 字号四档：小 0.9 · 标准 1.0 · 大 1.12 · 特大 1.25 |
| 动效 | 「减少动效」开关 |

全部是纯 CSS，**改完即时生效，不需要重启引擎**。

「减少动效」映射到 `:root[data-reduce-motion="true"]`，关掉面板滑入、光标闪烁、背景动画这类装饰性动效；状态切换依然即时反映。

### 字号缩放

`--apx-font-scale` 是**唯一**的字号来源：样式表里全部 79 处 `font-size` 和 `line-height` 都写成
`calc(<n>px * var(--apx-font-scale))`，所以一个值就能缩放整个界面——正文、侧栏、设置页、工具输出、代码块一起变。

两个实现要点：

- **行高必须一起缩放**。只放大字号不放大行高，字会挤在一起、下缘被截断。
- **固定高度改成 `min-height`**（工具栏 48px、状态栏 30px），否则放大后会裁切。
- 间距、圆角、边框粗细**保持原样**——这是「字号设置」而不是「界面缩放」，布局比例不变。

`FONT_SCALES` 在 `src/lib/configBridge.ts`，加档位改那里；`normalizeUi` 会把非法值夹到 `[0.8, 1.6]`。

## 字体

字体文件在 `src/assets/fonts/`，共 **2.3 MB**，`src/fonts.css` 声明 `@font-face`：

| 文件 | 体积 | 用途 |
|---|---|---|
| `inter-latin-var.woff2` | 48 KB | 拉丁 UI 字（可变字体，一个字重轴覆盖 100–900） |
| `jetbrains-mono-latin-var.woff2` | 40 KB | 拉丁代码字（可变） |
| `noto-sans-sc-400.woff2` | 1.14 MB | 简体中文 |
| `noto-sans-sc-500.woff2` | 1.16 MB | 简体中文，中黑 |

**中文靠逐字形回退**：Inter 和 JetBrains Mono 都不含 CJK 字形，所以拉丁字符用 Inter、每个汉字自动落到 Noto Sans SC。这就是替换掉微软雅黑观感的机制。

`Noto Sans SC` 没有可变字体版本（`@fontsource-variable/noto-sans-sc` 是 404），所以只能两个静态字重。

**注意**：`-webkit-font-smoothing: antialiased` 这条规则**不能加回来**。它是 macOS 取向的，在 Windows 上会关掉 ClearType 次像素抗锯齿，文字变细发灰——这正是「字体发虚」的常见来源。

### Markdown 渲染

对话区的富文本由 `src/lib/rich.tsx` 自己实现（**不引 Markdown 库**）。原来只认围栏代码块、行内 `code` 和 `**粗体**`，所以**表格、列表、标题都会原样输出**——表格显示成一片裸管道符。

现在是逐行的块级解析：

| 支持 | 说明 |
|---|---|
| 表格 | GFM 风格，需要分隔行（`\|---\|`）才算表格；支持 `:--` / `:-:` / `--:` 对齐；`\|` 转义 |
| 列表 | 无序 / 有序，**按缩进递归嵌套**，`start` 属性正确 |
| 标题 | `#` ~ `######`，字号按对话场景缩小（h1 才 16px），不用文档级尺寸 |
| 引用 / 分隔线 | `>` 与 `---` |
| 代码块 | 带语言标记和复制按钮（原有） |
| 行内 | `` `code` `` / `**粗**` / `*斜*` / `~~删~~` / `[文字](url)` |

几个刻意的取舍：

- **逐行解析，不是字符级**：Agent 的输出本来就按行写，面向行的解析能覆盖实际会出现的构造，不必实现完整 CommonMark。
- **段落保留硬换行**（`white-space: pre-wrap`）。GFM 会把软换行并成空格，但模型常常一行一句，保留原样更符合预期——这也和改动前的行为一致。
- **`_` 不当斜体标记**。这是 Markdown 渲染器毁掉标识符的经典原因：`some_var_name` 会变成 `some<em>var</em>name`。`*斜*` 也加了防误伤的前后边界，所以 `2 * 3 * 4` 不会变成斜体。
- **垂直间距是一条 `.rich > * + *` 规则**，不是每种块各自设 margin——否则代码块和表格相邻时边距会叠加。
- **链接可以点开**，交给系统浏览器。实现上有个刻意的选择：**`<a>` 不带 `href`**。
  带 href 的锚点会把 WebView 自己的导航路径也留着——中键、Ctrl+点击、拖拽——**任何一条都会让整个应用被一个网页顶替**。
  不带 href 就没有任何导航机制，点击只能触发我们处理的那一件事；`role="link"` + `tabIndex` 把语义和键盘可达性补回来。
  只对 `http(s)` 生效：capability 把 `open_url` 限定在 http/https/mailto/tel，
  把 `file:` 或 `javascript:` 渲染成能点的链接等于承诺了权限层会拒绝的事。
- **裸 URL 自动成链**（`https://…` 不带 markdown 语法），因为模型这么写的频率远高于 `[文字](url)`。
  这里需要两个字符类：中间类**额外排除 CJK 标点**——中文没有词间空格，
  否则 `见 https://a.com/x。下一句` 会被读成一个超长 URL；而全角 `。` 和 `.` `/` 不同，它从不合法地出现在 URL 里。
  末尾类再排除 ASCII 句末标点和右括号，所以 `https://a.com/x.` 不会把句号吃进去。

**有回归测试**：`npm run check:rich`（`scripts/check-rich.mjs`）。手写解析器最容易在边界上悄悄退化——一个正则改动就能让表格退回成裸管道符。测试用 esbuild 把 `rich.tsx` 打成临时包，再用 `react-dom/server` 渲染，**对真实 HTML 做断言**（50 项），所以不需要为测试导出内部函数。

### 权限

Tauri 的插件按 capability 授权，改 `src-tauri/capabilities/default.json`：

| 权限 | 用途 |
|---|---|
| `core:default` | Tauri 核心 |
| `dialog:default` | 系统目录选择器 |
| `opener:allow-open-url` | 打开链接所需的命令 |
| `opener:allow-default-urls` | 把上一条**限定**在 `http/https/mailto/tel` |

**只取这两条，没要 `opener:default`**——那个集合会连带授予 `reveal-item-in-dir`，APIX 用不上（文件树里的「在资源管理器中显示」走的是自己的 `open_path` 命令）。授权范围和用途对齐，多一点都是多余的攻击面。

### 悬浮提示

**界面上没有一处用原生的 `title` 属性。** 原生 tooltip 由操作系统绘制：用它自己的系统字体（在 Inter + Noto 旁边显得分辨率很低）、无法跟随深浅主题、灰色方框无视设计系统里的圆角和发丝线。
全部走 `src/components/ui/Tooltip.tsx`：

| 做法 | 原因 |
|---|---|
| `createPortal` 到 `document.body` + `position: fixed` | 这是唯一能在滚动容器和 `overflow: hidden` 的抽屉里都不被裁掉的方式 |
| 测量后再定位（`useLayoutEffect`） | `useLayoutEffect` 在绘制前跑，所以气泡不会先在错误位置闪一帧 |
| 240ms 延迟 | 指针扫过工具栏时不会连闪一串气泡；刻度的 `delay={60}` 更快 |
| 位置夹取到视口边缘 | 气泡不会跑到屏幕外 |
| 显示时监听 `scroll`（capture）+ `resize` | 锚点在滚动容器里时气泡会跟着走 |

转换时 `IconButton` 和 `Popover` 内部各包了一层，所以 **21 处调用点零改动**；剩下的散落在 `CommandBar`、`StatusBar`、`WorkspaceRail`、`ProvidersTab` 的 chip 与默认标记上。

`Tooltip` 的可访问性由 `aria-label` 承担（`IconButton` 一直保留着），气泡本身 `pointer-events: none`，不会挡住点击。

**禁用按钮上的提示仍然有效**：浏览器不给禁用控件派发鼠标事件，但事件会在祖先上触发，而 `Tooltip` 的事件挂在包裹层 `<span>` 上——这是最常见的解法。

### 下拉框

原生 `<select>` 是**由平台绘制**的：它自己的方框、自己的三角箭头、自己定义「禁用」长什么样。原来的规则里写着 `appearance: auto`，等于把这一整套都留着——所以在一堆用了设计系统的输入框中间，它会突兀地像 Windows 组合框。

现在 `appearance: none` 接管外观，箭头换成主题化的背景图：

- **箭头为什么是 data URI 而不是 `currentColor`**：`currentColor` 传不进 data URI，所以只能按主题各写一份，做成 `--apx-select-arrow` 令牌（`styles.css` 的 `:root` 是暗色，`:root[data-theme="light"]` 覆盖）。
- **选择器写成 `select.input` 这种复合形式**：裸 `select` 的优先级低于 `.input` 类，`padding-right` 会被 `.input` 的 `padding` 简写盖掉，箭头就会压到文字上。
- **宽度故意不动**：`select.input` 继续吃 `.input` 的 `width: 100%`，所以在表单里它和旁边的文本输入框对齐；想要紧凑的用 `.input-select`（`width: auto`）。
- **下拉列表本身仍然是浏览器绘制的**，能控制的只有两点：`:root` 上的 `color-scheme`（决定弹层的深浅底）和 `option` / `optgroup` 的 `background` + `color`。这是平台限制，不是没做。

## 目录结构

```
APIX/
├─ app-icon.png              图标源文件（1024×1024）
├─ scripts/make-icon.py      重新生成图标源文件
├─ scripts/deploy.mjs        构建产物部署到桌面 / %LOCALAPPDATA%
├─ src/                      React 前端
│  ├─ fonts.css              @font-face（Inter / JetBrains Mono / Noto Sans SC）
│  ├─ assets/fonts/          字体文件，共 2.3 MB
│  ├─ lib/protocol.ts        pi RPC 协议类型
│  ├─ lib/bridge.ts          Tauri command / event 封装
│  ├─ lib/configBridge.ts    pi 配置文件与 APIX state 读写封装
│  ├─ lib/reducer.ts         事件流 → 对话记录 的状态机
│  ├─ lib/rich.tsx           无依赖的代码块 / 内联渲染
│  ├─ hooks/usePi.ts         引擎 + 会话生命周期、request/response 通道、会话统计
│  ├─ hooks/useWorkspaces.ts 工作区与会话索引（持久化）
│  ├─ hooks/useAppearance.ts 主题与动效偏好（解析 light/dark、防首屏闪烁）
│  ├─ hooks/useHandoff.ts    上下文交接的两阶段编排（哨兵校验后才压缩）
│  ├─ settings.css           设置页样式（styles.css 放 token 层 + 外壳 + 对话区）
│  └─ components/
│     ├─ WorkspaceRail       工作区 / 会话双列表（可折叠）
│     ├─ Composer            输入框 + 模型 / 思考选择器
│     ├─ CommandBar          自定义指令条（压缩上下文）
│     ├─ QueueDock           输入框上方的排队任务
│     ├─ Transcript / ToolCard / StatusBar / Toolbar
│     ├─ ui/                 Icons（内联 SVG）+ kit（Card / Field / Drawer / Popover / SegmentedControl）
│     ├─ backdrops/          新聊天背景（vendored，GlobeStudy / GlassIcon / CloudSky / CursorRingField）
│     └─ settings/           设置页六个分区（外观 / 供应商 / MCP / Skills / 通用 / 原始文件）
└─ src-tauri/                Rust 宿主
   ├─ assets/skills/         内置 skill（编译期嵌入）
   ├─ src/pi.rs              pi 定位 + 子进程 + 输出解析
   ├─ src/config.rs          pi 配置文件 + APIX state + skills 管理
   ├─ src/commands.rs        pi / 窗口相关命令
   ├─ src/lib.rs             托盘 / 单实例 / 窗口事件
   └─ tauri.conf.json        窗口与打包配置
```

## 实现上的两个关键点

1. **Windows 上不能直接 spawn `pi`。** npm 装出来的 `pi` 是 `.cmd` 壳，spawn 它拿到的是 `cmd.exe` 的句柄，杀进程时会漏掉真正的 node。`src-tauri/src/pi.rs` 会解析出 `node.exe` 和 `.../pi-coding-agent/dist/cli.js`，直接起 node，并带上 `CREATE_NO_WINDOW` 防止弹黑框。

2. **按 LF 切行，别用会切 Unicode 的行读取器。** pi 的文档专门警告过：`U+2028` / `U+2029` 在 JSON 字符串里合法，Node 的 `readline` 会错误地拿它们当换行。这里用 `tokio` 的 `lines()`，只按 `\n` 切并剥掉尾随 `\r`。

另外，流式文本**必须**被终值覆盖：`message_update` 是纯增量的，`text_end` / `message_end` 才带权威内容。`reducer.ts` 里所有流式字段在结束时都会被整体替换，而不是累加。

## 当前进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | 环境准备 | ✅ |
| P1 | Tauri 2 骨架：窗口 / 托盘 / 单实例 | ✅ |
| P2 | 最小闭环：spawn pi → 流式对话 / 工具卡片 / 中断 | ✅ |
| P3 | 设置面板：模型供应商 / Skills / MCP / 通用 / 原始文件 | ✅ |
| P4 | 会话管理（`get_tree` / fork / 导出 HTML）、模型切换器、扩展 UI 弹窗 | ⬜ |
| P5 | 自动更新、代码签名、开启路径 | ⬜ |

## 排错

| 症状 | 处理 |
|---|---|
| `schemars 0.8.22` 报 `E0107`，`IndexMap<K, V>` 少一个泛型参数 | `indexmap 1.9.3` 没有 `default` feature，靠 autocfg 现场探测 sysroot 来决定 `has_std`；探测失败（受限/沙箱化构建环境）就静默不发该 cfg。已在 `src-tauri/Cargo.toml` 里对 indexmap 显式开启 `std` feature 绕开探测。若仍复现，检查 `target/debug/build/indexmap-*/stderr` 是否有 `autocfg could not probe for 'std'` |
| 「Unable to locate the pi CLI」 | 确认 `pi --version` 能跑；或设环境变量 `APIX_PI_ENTRY` 直接指向 `dist/cli.js` |
| 引擎显示「已退出」，事件流里 stderr 报未登录 | 在终端跑一次 `pi` 完成 `/login` |
| 设置面板里的改动不生效 | pi 不会自动重读配置。点面板顶部的「重启引擎」 |
| 「拉取模型列表」失败 | 报错会原样显示（HTTP 状态码 + 响应片段）。检查 baseUrl 是否要带 `/v1`、apiKey 是否解析得到 |
| pi 的 agent 目录不在 `~/.pi/agent` | 设环境变量 `APIX_AGENT_DIR` 指过去 |
| 窗口关了但进程还在 | 这是设计行为（收进托盘）。托盘右键 → 退出 APIX |
| `tauri dev` 报找不到图标 | 先跑 `npm run icon` |
