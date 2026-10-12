---
name: apix-mcp-author
description: 给 APIX 添加或安装 MCP 服务器：写 mcp.json、验证能连上、登录 OAuth、排查连不上的服务器。当用户说「加个 MCP」「装个 mcp」「接一下某个服务」，或某个 MCP 报失败时使用。
metadata:
  managed-by: apix
  version: 1
---

<!-- apix-managed: APIX rewrites this file when this marker is present. Remove the marker to take ownership of it. -->

# 加 / 装 MCP 服务器

MCP 服务器让 APIX 能用到外部的工具和数据。这里只管**配置**：把服务器写进配置文件、确认它连得上、需要登录时把登录流程带起来。

## 何时使用

- 「加一个 MCP」「接一下 XX 服务」「装个 mcp」
- 「这个 MCP 怎么连不上」「MCP 报错了」（→ 走「排查」一节）
- 用户给了一个 npm 包名、一个 URL，或者一段 `.mcp.json` 想搬进 APIX

**不适用**：只是想调用某个已经接好的工具——那直接调。

## 铁律

1. **不要编造包名和 URL。** MCP 服务器的命令会被真的执行。用户没给来源时，要么向他确认，要么去查——**绝不能凭印象拼一个看起来合理的包名**。
2. **装之前说清来源并征得同意。** MCP 服务器能执行任意命令、能拿到你写进配置里的令牌。凡是用户没提过的服务器，先说「它是什么、来自哪里、会拿到什么」，再动手。
3. **一个服务器只能有 `command` 或 `url` 其中之一**，不能两个都有。两者都写会被校验拒绝。
4. **改完必须验证。** 写完不验证等于没装——配置文件写错的典型表现是启动后静默失败，用户只看到一条「MCP servers need attention」。
5. **令牌不要直接写进 `mcp.json`。** 优先用 `--bearer-token-env-var NAME`，或者让用户在系统里设好环境变量。写死了就会跟着配置文件一起被备份、被截图、被分享出去。

## 配置在哪、长什么样

`~/.pi/agent/mcp.json`（Windows 上 `%USERPROFILE%\.pi\agent\mcp.json`）：

```json
{
  "mcpServers": {
    "<服务器名>": { "...": "..." }
  }
}
```

- **服务器名**：只允许字母、数字、`_`、`-`。
- **两种形态，二选一**：

**stdio**（本地进程，走 stdin/stdout）

```json
{
  "command": "npx",
  "args": ["-y", "some-mcp-server"],
  "env": { "API_KEY": "${SOME_VAR}" },
  "cwd": "C:\\some\\dir"
}
```

**streamable HTTP**（远程）

```json
{
  "url": "https://example.com/mcp",
  "headers": { "X-Foo": "bar" }
}
```

- **通用字段**：
  - `exposure`：`codemode`（默认）/ `deferred` / `direct` / `hidden`。`hidden` 表示连上但不把工具暴露出来。
  - `description`：这个服务器提供什么。**它会进系统提示词**，写清楚模型才知道什么时候该用它。
  - `enabled`：`false` 先别连。`timeout`：超时秒数（正数）。
  - `type`：`"stdio"` 或 `"http"`。**老的 `"sse"` 已经不支持了**，遇到 sse 就换成 streamable HTTP 的 `url`。
- OAuth 的服务器：用下面的 `pi mcp login`，不要去手写 `oauth` 字段。

## 首选做法：用 `pi mcp`

pi 自带一个专门给 agent 用的命令，比手写 JSON 稳。**先确认它能用**：

```bash
pi --version
```

能跑就走这条；不能跑（提示找不到命令）就跳到「手写配置」。

```bash
# stdio：`--` 之后的都是服务器的命令和参数
pi mcp add <名字> --env KEY=VALUE --description "它提供什么" -- npx -y <包名>

# HTTP：用 --url
pi mcp add <名字> --url https://example.com/mcp --header X-Foo=bar

# 需要 Bearer 令牌时，传环境变量名而不是令牌本身
pi mcp add <名字> --url https://example.com/mcp --bearer-token-env-var MY_TOKEN

# 检查（连不上会以非 0 退出，并打印原因）
pi mcp list
pi mcp list --json

# OAuth 服务器：需要用户在浏览器里点同意
pi mcp login <名字>

# 卸载
pi mcp remove <名字>
```

其他可用选项：`--cwd <dir>`、`--exposure <模式>`、`--oauth-client-id`、`--oauth-client-secret`、`--oauth-callback-port`、`--oauth-client-name`、`--timeout <秒>`、`-l/--local`（写进项目里的 `.pi/mcp.json` 而不是全局）。完整列表用 `pi mcp --help`。

不确定参数怎么写就 `--help` 查，不要试错式乱传。

## 手写配置

`pi mcp` 用不了，或者你想精确控制字段，就直接改 `~/.pi/agent/mcp.json`：

1. 先**读一遍现有文件**（可能已经有别的服务器），不要整个覆盖掉。
2. 按上面的结构加一项，保留原有内容。
3. 写完**自己读回来核对一次**——JSON 少个逗号，整份配置就全废了。

用户也可以完全走界面：**设置 → MCP → 新增服务器**。如果用户更习惯点界面，就把填什么念给他听，不要非要替他改文件。

## 生效方式（这一节必须告诉用户）

写进文件**不会立刻生效**。MCP 服务器是在会话开始时读取和连接的。所以：

| 想让它生效 | 怎么做 |
|---|---|
| **推荐**：开一个新会话 | 新会话会重新读 `mcp.json` 并连接——最省事 |
| 重启引擎 | 也行，只是慢一些、当前会话会重新装配 |
| 只是想让界面刷新 | 设置 → MCP 里的「重新加载」**只刷新界面**，不会让 pi 连上它 |

所以收尾时明确告诉用户：**「开个新会话就生效了」**。

## 排查

1. **看状态**：`pi mcp list`。它会打印每个服务器的状态、暴露出来的工具和错误原因，连不上时以非 0 退出。
2. **看日志**：`~/.pi/agent/mcp.log`。
3. **界面**：APIX 会用一条通知告诉你哪个服务器失败了，原话形如 `MCP servers need attention: <名字>: failed: ...`。
4. 常见的几类原因：
   - **命令不存在**：`npx` / `uvx` / 具体的可执行文件没装，或者不在 PATH 上。stdio 服务器找不到命令时通常只报「connection closed」，看不出根因——**这时候要主动去确认那个命令真的能跑**。
   - **需要令牌但没给**：检查 `env`（stdio）或 `headers`（HTTP）里的变量名有没有配错。
   - **HTTP 地址写成 sse 的**：换成 streamable HTTP 的 `url`。
   - **同时写了 `command` 和 `url`**：删掉一个。
   - **OAuth 没登录**：`pi mcp login <名字>`，让用户在浏览器里点同意。

## 反模式

| 别这么做 | 为什么 |
|---|---|
| 凭印象编一个包名或 URL | MCP 服务器会被真的执行；装错东西的代价是安全和时间 |
| 把 API key 直接写进 `mcp.json` | 明文、会被备份和分享；用环境变量名 |
| 整个覆盖 `mcp.json` | 用户原有的服务器会一起消失，先读后改 |
| 又写 `command` 又写 `url` | 校验直接拒绝 |
| 写完不验证 | 配错时是静默失败，用户只会觉得「装了没用」 |
| 告诉用户「已经生效了」 | 不重启或不开新会话就不会生效，说了就是误导 |
| 让用户自己去猜命令的全路径 | 先自己确认命令能跑通，再把结论给他 |
