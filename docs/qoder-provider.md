# Qoder 接入（Pi Provider）

APIX 不再维护 Qoder CLI / QoderHost / Session Pool 一等后端。Qoder 现在通过 Pi provider 扩展接入，Qoder 会话就是普通 pi 会话：

- 历史：本地 pi JSONL
- 模型目录：Pi provider 模型选择器
- 启动与预热：沿用 pi / standby
- 不再启动 `qodercli --acp`

## 安装

```bash
pi install npm:@jischeng/pi-provider-qoder
```

扩展源码：<https://github.com/jischeng/pi-provider-qoder>
npm：<https://www.npmjs.com/package/@jischeng/pi-provider-qoder>

## APIX 内配置（推荐）

设置 → 配置管理 → Pi 配置管理 → 模型 → **Qoder Provider**：

1. 选择国际版 / 中国版
2. 填写 PAT
3. 获取模型列表
4. 保存

APIX 会把 PAT 只传给一次性 `pi --list-models` 子进程；扩展完成 PAT → Job Token 交换并把凭据写入 Pi 自己的 `auth.json`，不会把 PAT 写进 models.json 或 APIX 设置。登录成功后 APIX 会立即刷新带扩展的模型能力快照，**不需要重启 APIX**；新建会话即可选择 Qoder 模型。PAT 出于安全不会回显，已配置状态会在弹窗里显示。

WSL 模式暂不支持这个表单，请在 WSL 终端执行 `pi` 后 `/login qoder`。

## 终端登录

Qoder provider 使用自己的 OAuth/PAT 凭据，不复用 Qoder CLI 的登录：

```text
pi
/login qoder
```

中国版账号：

```text
/login qoder-cn
```

也可按扩展文档设置 `QODER_PERSONAL_ACCESS_TOKEN` / `QODER_PAT`（中国版对应 `QODERCN_*`）。

登录后确认：

```bash
pi --list-models | findstr qoder
```

然后重启 APIX，新建 pi 会话即可在模型选择器中选 Qoder 模型。

## 旧数据

- 旧 `backend=qoder` / `qoderSessionId` 的 Qoder CLI 会话不再有 runtime，侧栏不再展示；catalog 数据保留，不主动删除。
- 旧 `settings.acpTools` 中的 Qoder CLI 行在启动时清理。
- 旧 Qoder CLI 独立配置字段（命令、池、预热、默认模型等）在启动时清掉。

## 注意

这是第三方 Pi provider 扩展，不是 Qoder 官方 SDK；使用前请确认账号与合规要求。APIX 不读取或保存 Qoder 密码/PAT，凭据由 Pi 写入自己的 `~/.pi/agent/auth.json`。
