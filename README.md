# APIX

![Status](https://img.shields.io/badge/status-stable-green)
![Version](https://img.shields.io/badge/version-1.0.5-blue)
![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)
![Electron](https://img.shields.io/badge/Electron-43-47848f)
![React](https://img.shields.io/badge/React-19-61dafb)

**APIX 是一个基于 [pi](https://pi.dev) 的本地 AI 编码工作台。** 它把 pi Agent 的会话、项目、模型配置、Git、终端和扩展资源收进一个原生桌面应用，适合长期在多个本地仓库之间工作的开发者。

> **最新版本 v1.0.5**（2026-11-04）

下载安装包：[GitHub Releases](https://github.com/m4rr5er/apix/releases)

---

## APIX 是什么

APIX 不是另一个 Agent 引擎，也不是浏览器套壳。Agent 行为、工具调用、模型请求和会话文件仍由 pi 原生负责；APIX 负责桌面工作台这一层：

- 多项目工作区与会话 Tab
- pi 会话历史浏览、恢复、导入与跨会话搜索
- `models.json` / `auth.json` / `settings.json` 可视化管理
- Git 面板、内置终端、文件抽屉与内置浏览器
- 提示词、技能、扩展、MCP 与智能体管理
- 供应商登录、连接测试、用量查询与本地用量统计

核心通信仍然只有一条：**stdio JSON-RPC**。APIX 不发明第二套 Agent 协议。

## 主要能力

| 能力 | 说明 |
|---|---|
| 多项目会话 | 一个项目一个工作区，会话按项目组织；支持会话 Tab、预览与分屏 |
| 会话历史 | 浏览、恢复、Fork、编辑/删除消息、重发与回退；支持导入 Codex / Claude 等本地会话 |
| 模型与供应商 | 可视化编辑 pi 配置；供应商登录、连接测试、模型能力刷新、代理设置 |
| Qoder Provider | 使用 Qoder PAT 登录，模型由 Qoder Provider 扩展自动加载 |
| 用量查询 | 支持 AI-AAA（aibvv.cn）与 Qoder；在设置中配置并打开开关后，左下角「今日用量」展示余额或 Credits |
| Git 与终端 | 工作区状态、分支、提交、Diff、worktree；内置终端与常用命令 |
| 资源管理 | 提示词库、技能商店、扩展管理、宿主插件与 MCP 服务 |
| 会话内工具 | 文件引用、斜杠命令、Shell 执行、上下文用量、压缩、智能体调用 |
| 桌面体验 | 深色主题、APIX 字标、新会话动态背景、托盘、任务栏图标与窗口状态恢复 |

## 快速开始

### 环境要求

- **pi CLI**：`npm install -g --ignore-scripts @earendil-works/pi-coding-agent`
- 确认 `pi --version` 可用；APIX 使用你系统中的 pi，不会内置或替换它
- 首次启动后，在「设置 → 配置管理」中配置至少一个模型供应商

### 安装

从 [Releases](https://github.com/m4rr5er/apix/releases) 下载：

- `APIX-1.0.5-setup.exe`：Windows 安装版
- `APIX-1.0.5-portable.exe`：Windows 便携版

安装版与便携版共用 APIX 数据目录；升级不会删除你的 pi 配置和会话。

## 用量查询

进入：

```text
设置 → 系统设置 → 用量查询
```

支持两个内置来源：

- **AI-AAA（aibvv.cn）**：先在「配置管理 → 模型」中配置好 API Key，再回到用量查询打开开关。
- **Qoder**：完成 Qoder Provider 登录后，打开开关即可。

只有打开开关且已配置的供应商会出现在左下角「今日用量」；两个都关闭时入口保留，点开后可直接跳转到用量查询设置。

## 应用内更新

APIX 的更新源是 **APIX 自己的 GitHub Release**：

```text
https://github.com/m4rr5er/apix/releases
```

在 `设置 → 开发设置 → 版本与更新` 中可以手动检查。APIX 只检查自己的 Release 更新。

## 开发

```bash
npm install
npm run dev          # Electron + Vite 开发模式
npm run typecheck    # TypeScript 检查
npm test             # node --test
npm run check:format # biome 格式检查
npm run build        # 生成 out/
npm run dist:win     # Windows NSIS + portable
```

也可以直接运行：

```bash
npm run preflight -- --skip unit-tests
```

## 目录

```text
src/main/       Electron 主进程：pi RPC、配置、会话、Git、终端、更新
src/preload/    contextBridge 暴露的最小桌面 API
src/renderer/   React 工作台、会话时间线、设置与配置界面
src/shared/     主进程 / 渲染层共享类型与 IPC 契约
resources/      内置扩展、技能、提示词、MCP 与 sidecar 资源
docs/           开发、发版与领域维护文档
```

## 许可

MIT。APIX 基于开源桌面工作台思路与 pi 生态构建；上游项目与贡献者信息见 [CONTRIBUTORS.md](CONTRIBUTORS.md) 与仓库历史。
