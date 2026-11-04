# APIX

![Status](https://img.shields.io/badge/status-stable-green)
![Version](https://img.shields.io/badge/version-1.0.5-blue)
![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)
![Electron](https://img.shields.io/badge/Electron-43-47848f)
![React](https://img.shields.io/badge/React-19-61dafb)

**APIX is a local AI coding workbench built on [pi](https://pi.dev).** It brings pi Agent sessions, projects, model configuration, Git, terminal and extension resources into one native desktop app for developers who work across multiple local repositories.

> **Latest: v1.0.5** (2026-11-04)

Download: [GitHub Releases](https://github.com/m4rr5er/apix/releases)

---

## What is APIX

APIX is not another agent engine, and it is not a browser wrapper. Agent behavior, tool calls, model requests and session files remain owned by pi; APIX provides the desktop workbench layer:

- Multi-project workspaces and session tabs
- pi session history, restore, import and cross-session search
- Visual management of `models.json` / `auth.json` / `settings.json`
- Git panel, built-in terminal, file drawer and built-in browser
- Prompts, skills, extensions, MCP servers and agent profiles
- Provider sign-in, connection tests, usage queries and local usage statistics

There is still exactly one agent communication channel: **stdio JSON-RPC**. APIX does not invent a second agent protocol.

## Highlights

| Area | What it does |
|---|---|
| Projects and sessions | One workspace per project, organized sessions, preview tabs and split panes |
| Session history | Browse, restore, fork, edit/delete messages, resend and rewind; import local Codex / Claude sessions |
| Models and providers | Visual pi config editing, provider sign-in, connection tests, model refresh and proxies |
| Qoder Provider | Sign in with a Qoder PAT; Qoder models are loaded by the Qoder provider extension |
| Usage query | AI-AAA (aibvv.cn) and Qoder balances/credits in Today's usage after configuration and a per-provider switch |
| Git and terminal | Working tree, branches, commits, diffs, worktrees, built-in terminal |
| Resources | Prompt store, skill store, extension manager, host plugins and MCP servers |
| In-session tools | File references, slash commands, shell execution, context usage, compaction and agent invocation |
| Desktop | Dark theme, APIX wordmark, new-session backdrop, tray, taskbar identity and window restore |

## Quick start

### Requirements

- **pi CLI**: `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`
- Verify `pi --version`; APIX uses your system pi and never embeds or replaces it
- On first launch, configure at least one model provider in **Settings → Config Management**

### Install

Download from [Releases](https://github.com/m4rr5er/apix/releases):

- `APIX-1.0.5-setup.exe` — Windows installer
- `APIX-1.0.5-portable.exe` — Windows portable build

Stable and portable builds share the APIX data directory; upgrading never removes your pi configuration or sessions.

## Usage query

Open:

```text
Settings → System Settings → Usage Query
```

Two built-in sources are available:

- **AI-AAA (aibvv.cn)**: configure the API key in **Config Management → Models**, then turn on its switch here.
- **Qoder**: sign in through Qoder Provider, then turn on its switch.

Only enabled and configured providers appear in **Today's usage** at the bottom-left. When both are off, the entry stays visible and opens a direct link to Usage Query settings.

## In-app updates

APIX checks **its own GitHub Releases**:

```text
https://github.com/m4rr5er/apix/releases
```

You can check manually under **Settings → Development → Version & Updates**. APIX checks only its own release feed.

## Development

```bash
npm install
npm run dev          # Electron + Vite development mode
npm run typecheck    # TypeScript check
npm test             # node --test
npm run check:format # biome format check
npm run build        # build out/
npm run dist:win     # Windows NSIS + portable
```

Or run:

```bash
npm run preflight -- --skip unit-tests
```

## Layout

```text
src/main/       Electron main process: pi RPC, config, sessions, Git, terminal, updates
src/preload/    Minimal contextBridge desktop API
src/renderer/   React workbench, session timeline, settings and config UI
src/shared/     Shared types and IPC contracts
resources/      Built-in extensions, skills, prompts, MCP and sidecar resources
docs/           Development, release and domain maintenance docs
```

## License

MIT. APIX is built on the pi ecosystem and open-source desktop workbench ideas; upstream project and contributor information is available in [CONTRIBUTORS.en.md](CONTRIBUTORS.en.md) and the repository history.
