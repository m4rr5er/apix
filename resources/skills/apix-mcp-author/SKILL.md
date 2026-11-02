---
name: apix-mcp-author
description: 给 APIX 添加、安装或排查 MCP 服务器：读取当前 pi mcp.json、按官方文档写配置、验证连接、处理 OAuth 登录和常见失败。当用户说「加个 MCP」「装个 MCP」「接一下某个服务」「为什么 MCP 连不上」时使用。
metadata:
  managed-by: apix
  version: 2
---

<!-- apix-managed: APIX rewrites this file when this marker is present. Remove it to take ownership of it. -->

# 加 / 装 / 排查 MCP 服务器

MCP（Model Context Protocol）让 APIX 的 pi 会话使用外部工具和数据。这里负责：**找到官方接入方式 → 写进当前 APIX 的 mcp.json → 验证真正连上 → 告诉用户怎么生效/撤销**。

## 何时使用

- 「加一个 MCP」「接一下 XX 服务」「装个 MCP」
- 用户给了 npm 包名、远程 URL、`mcp.json` 片段或官方文档链接
- 「这个 MCP 怎么连不上」「MCP 报错了」→ 走「排查」一节
- 用户想配置 OAuth 登录、API Key、工具暴露方式

**不适用**：只是调用已经接好的 MCP 工具——那直接调。

## 铁律

1. **不要编造包名、URL 或命令。** MCP 服务器会被真的执行。来源不明就先查官方文档；查不到就向用户确认，绝不能凭印象拼一个看起来合理的包名。
2. **先读后写，合并而非覆盖。** 修改前完整读取 mcp.json；只新增/替换本次服务器条目，其他内容原样保留。解析失败立即停手，绝不猜着覆盖。
3. **一个服务器只能有 `command` 或 `url` 其中之一**，不能两个都有。
4. **改完必须验证。** 写完不验证等于没装；静默失败时用户只会看到「MCP servers need attention」。
5. **令牌不要回显到对话或日志。** 能通过环境变量引用就不要把明文写进配置；必须写明文时（pi 的 mcp.json 本身是明文存储）也要在汇报时打码。
6. **写文件不会立刻生效。** MCP 在会话启动时读取；改完要让用户开新会话（或重启运行时），不能声称「现在就能用」。

## 当前 APIX / pi 的配置位置

全局：

```text
Windows: %USERPROFILE%\.pi\agent\mcp.json
macOS/Linux: ~/.pi/agent/mcp.json
```

项目级（只影响当前项目）：

```text
<项目根>/.pi/mcp.json
```

- 项目级同名条目会遮蔽全局定义。
- 只在用户明确要项目级配置时才写项目文件，避免让其他项目意外继承。

当前 APIX 也有图形入口：

```text
设置 → 配置管理 → Pi 配置管理 → MCP
```

旧版 APIX 的「设置 → MCP」如果还能看到，是同一个后端配置；以实际界面为准。服务行里的「登录」按钮用于 OAuth。

## 首选方式：用 pi 的 MCP CLI

pi 自带专用命令，能校验参数并复用同一份配置。先确认可用：

```bash
pi --version
```

### stdio（本地进程）

```bash
pi mcp add <名字> --env KEY=VALUE --description "它提供什么" -- npx -y <包名>
```

### streamable HTTP（远程）

```bash
pi mcp add <名字> --url https://example.com/mcp --header X-Foo=bar
```

需要 Bearer 令牌时，**优先传环境变量名**：

```bash
pi mcp add <名字> --url https://example.com/mcp --bearer-token-env-var MY_TOKEN
```

### 其他常用参数

```bash
pi mcp add <名字> --cwd <dir> --exposure codemode|deferred|direct|hidden --timeout 30 ...
pi mcp add <名字> -l ...          # 写项目级 .pi/mcp.json
pi mcp list                       # 状态 + 工具数；失败非 0 退出
pi mcp list --json                # 程序化结果
pi mcp login <名字>               # OAuth 浏览器登录
pi mcp logout <名字>
pi mcp remove <名字> [-l]
```

不确定参数就运行 `pi mcp --help`，不要试错式乱传。

## 备选方式：直接改 mcp.json

CLI 不可用，或需要精确控制字段时：

```json
{
  "mcpServers": {
    "linear": { "url": "https://mcp.linear.app/mcp" },
    "brave-search": {
      "command": "npx",
      "args": ["-y", "@brave/brave-search-mcp-server"],
      "env": { "BRAVE_API_KEY": "${BRAVE_API_KEY}" }
    }
  }
}
```

字段规则：

- **远程**：`url` 必填（http/https）、`headers` 可选；新版 streamable HTTP 不写 `type`，**旧的 `"sse"` 不要再写**。
- **本地 stdio**：`command` 必填，`args`、`env`、`cwd` 可选。
- 通用：`enabled`（false 先不连）、`description`（会进入系统提示词，写清楚它能做什么）、`timeout`（秒）、`exposure` / `toolExposure`（`codemode` 默认 / `deferred` / `direct` / `hidden`）。
- OAuth：默认零配置；只有服务商明确要求预注册客户端时才写 `oauth` 字段。不要手写一堆猜测的 OAuth 配置。
- `auth.provider` 是复用 pi 模型供应商凭据的高级能力，仅全局配置可用；除非用户明确要求，不要写。

写入步骤：

1. 读完整文件，解析 JSON；解析失败就停手，让用户先修。
2. 只合并本次条目，保持其他服务器原样。
3. 2 空格缩进写回；写完读回来确认 JSON 可解析。
4. 不把 API Key 回显到对话。

## 认证形态判定（按官方文档，不猜）

| 官方文档说 | 写法 |
|---|---|
| OAuth / 浏览器登录 / 无需 token | 只写 `url`；连接后若 needs-auth，引导用户在 APIX MCP 页面点「登录」或 `pi mcp login <名字>` |
| API Key / PAT 放请求头 | `headers: {"Authorization": "Bearer <key>"}`（或文档规定的头名） |
| API Key 放环境变量 | stdio 用 `env: {"<变量名>": "<key>"}`；能引用系统变量时优先 `${NAME}` |
| 无认证 | 只写传输字段 |
| 需要 Docker | `command: "docker"`，先确认用户有 Docker；不要替用户安装 Docker |

## 验证与收尾

```bash
pi mcp list
pi mcp list --json
```

- `connected` + 工具数 → 成功；告诉用户工具在新会话里可通过 tool_search / codemode 发现。
- `needs-auth` → 让用户在 APIX 的 MCP 页面点「登录」，或运行 `pi mcp login <名字>`。
- `error` → 按错误定位：URL / 密钥 / npx 包名 / Node / 命令路径。
- stdio 首次连接 npx 拉包稍慢是正常的。

收尾必须说清：

1. 加了什么服务器、写到哪个文件（密钥打码）
2. 验证结果
3. **开新会话才生效**
4. 如何撤销（`pi mcp remove <名字>` 或删掉对应键）

## 排查

1. `pi mcp list` 看状态和错误。
2. 看日志：`~/.pi/agent/mcp.log`。
3. APIX 会提示类似 `MCP servers need attention: <名字>: failed: ...`。
4. 常见原因：
   - **命令不存在**：`npx` / `uvx` / 可执行文件没装，或不在 PATH；stdio 常只报 connection closed，要主动验证命令能跑。
   - **令牌缺失/变量名错**：检查 `env` 或 `headers` 的键名。
   - **把 streamable HTTP 写成 `"sse"`**：改成 `url`。
   - **同时写 `command` 和 `url`**：删掉一个。
   - **OAuth 未登录**：`pi mcp login <名字>`，让用户在浏览器同意。
   - **配置对但当前会话没变**：MCP 只在会话启动时加载，开新会话。

## 反模式

| 别这么做 | 为什么 |
|---|---|
| 凭印象编包名或 URL | MCP 会被真的执行，装错代价是安全和时间 |
| 整个覆盖 mcp.json | 用户原有服务器会一起消失 |
| 又写 command 又写 url | 校验直接拒绝 |
| 把 API key 回显到对话/日志 | 泄露凭据 |
| 写完不验证 | 配错时静默失败 |
| 告诉用户「已经生效」 | 不启动新会话就不会加载 |
| 让用户自己猜全路径 | 先确认命令真的能跑，再给结论 |
| 为了装 MCP 自动执行 npm/pip 安装 | 依赖变更必须由用户明确同意 |

## 最小验收

```bash
pi mcp list --json
```

至少确认：

- 目标服务器名存在
- 状态为 connected 或明确 needs-auth（需要登录）
- 工具列表/数量符合预期
- 配置文件中其他服务器没有被改掉