# 机器人接入指南

OpenQQ 通过 OneBot v11 正向 WebSocket 与反向 WebSocket 对外提供事件推送与动作调用接口，同时附带一个最小化的机器人客户端示例（`examples/bot.mjs`）。

## 1. 初始化配置

支持以下两种配置方式，最终均会原子写入 `config/openqq.json`（或通过 `--config <路径>` 指定的配置文件，已加入 `.gitignore` 避免泄露密钥）：

### 方式 A：Web 配置向导（推荐）

执行 `npm run webui`（首次无配置直接运行 `npm start` 也会自动进入），访问终端打印的完整 `#token=...` 地址完成配置：

1. 在「环境概览 / 本地路径」步骤确认自动探测到的 QQ NT 目录和已安装 `frida>=17.8` 的 Python 路径，可点击「校验当前路径」实时检查 PE64 导出表与 Frida 版本。
2. 选择 OneBot 连接模式：
   - **正向 WebSocket**：OpenQQ 监听本地端口（默认 `127.0.0.1:3001`），机器人客户端主动接入。
   - **反向 WebSocket**：OpenQQ 主动连接到最多 8 个外部服务端（`ws://` 或 `wss://`）。
   - **同时启用双向**：同时开放正向监听并连接反向目标地址。
3. 设置 `OneBot Access Token`（16–256 位非空格 ASCII 字符）以及 WebUI 端口（仅绑定 `127.0.0.1`，默认 `17860`）。
4. 保存后点击「启动 QQ 桥接」，或回到终端运行 `npm start`。

### 方式 B：命令行交互 / 模板复制

```powershell
npm run init
```

或复制 `config/openqq.example.json` 为 `config/openqq.json` 后自行修改 `qqRoot`、`python` 和随机生成的 `accessToken`。

> 如果将正向监听绑定到 `0.0.0.0` 允许局域网其他设备连接，请务必使用高强度 `accessToken` 并配合防火墙控制来源网段；WebUI 本身始终仅监听 `127.0.0.1`。

## 2. OneBot v11 连接规范

### 正向 WebSocket

- 默认地址：`ws://127.0.0.1:3001/`
- 鉴权方式（满足其一即可）：
  - HTTP Header：`Authorization: Bearer <accessToken>`
  - URL 查询参数：`?access_token=<accessToken>`
- 元事件与心跳：连接成功且账号就绪后会推送 `lifecycle` (`connect`)；QQ 登录成功后发送 `meta_event` / `heartbeat`。
- 限流保护：同一来源 IP 在 60 秒内连续鉴权失败超过 20 次将返回 `429 Too Many Requests`。

### 反向 WebSocket

- 请求头包含：`X-Self-ID`、`X-Client-Role: Universal`，配置了独立连接密钥时附加 `Authorization: Bearer <token>`。
- 至少需要启用正向或反向任一接入模式；若反向节点连接断开，会自动执行指数退避重连。

## 3. 运行示例机器人

先在一个终端保持 `npm start` 运行并登录 QQ，然后在另一个终端设置环境变量并启动 `npm run bot`：

```powershell
$env:ONEBOT_TOKEN = "<你在 config/openqq.json 中配置的 accessToken>"
# 可选：自定义连接地址（默认为 ws://127.0.0.1:3001/）
# $env:ONEBOT_URL = "ws://127.0.0.1:3001/"
# 可选：仅允许特定 QQ 号触发回复（逗号分隔）
# $env:BOT_ALLOW_USERS = "123456789"
npm run bot
```

若需要接入 OpenAI 兼容的聊天补全接口实现 `/ai <问题>` 命令，可额外设置：

```powershell
$env:BOT_API_URL = "https://api.example.com/v1/chat/completions"
$env:BOT_API_KEY = "<你的模型 API Key>"
$env:BOT_MODEL   = "<模型名称>"
```

示例机器人内置私聊测试指令 `/ping`（回复 `pong`）与 `/ai <内容>`。

## 相关参考

- [OneBot v11 正向 WebSocket](https://github.com/botuniverse/onebot-11/blob/master/communication/ws.md)
- [OneBot v11 反向 WebSocket](https://github.com/botuniverse/onebot-11/blob/master/communication/ws-reverse.md)
- [OneBot v11 鉴权规范](https://github.com/botuniverse/onebot-11/blob/master/communication/authorization.md)
- [OneBot v11 元事件](https://github.com/botuniverse/onebot-11/blob/master/event/meta.md)
- [Chat Completions API 参考](https://developers.openai.com/api/reference/resources/chat)
