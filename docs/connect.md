# 机器人接入

OpenQQ 通过 OneBot v11 的正向和反向 WebSocket 推送事件、接收动作。`examples/bot.mjs` 是一个最小的机器人客户端示例。

## 配置

配置会原子写入 `config/openqq.json`，也可以用 `--config <路径>` 指定别的文件。`config/openqq.json` 已在 `.gitignore` 里，里面有密钥，不要提交。

### 方式 A：Web 配置向导（推荐）

执行 `npm run webui`；没有配置时直接 `npm start` 也会进入向导。打开终端里打印的完整地址（带 `#token=...`），然后：

1. 在「环境概览 / 本地路径」一步确认探测到的 QQ NT 目录和 C++ 原生启动器的状态。点「重新检测」会重新检查 PE64 导出表和原生组件。
2. 选择 OneBot 连接模式：
   - 正向 WebSocket：OpenQQ 监听本地端口（默认 `127.0.0.1:3001`），机器人客户端主动连上来。
   - 反向 WebSocket：OpenQQ 主动连到最多 8 个外部服务端（`ws://` 或 `wss://`）。
   - 两者同时启用。
3. 设置 `OneBot Access Token`（16–256 位、不含空格的 ASCII 字符）和 WebUI 端口（只绑定 `127.0.0.1`，默认 `17860`）。
4. 保存后点「启动 QQ 桥接」，或者回终端运行 `npm start`。

### 方式 B：命令行

```powershell
npm run init
```

或者把 `config/openqq.example.json` 复制成 `config/openqq.json`，自己改 `qqRoot` 和随机生成的 `accessToken`。

> 如果把正向监听绑到 `0.0.0.0` 让局域网里的其他设备连接，请用足够强的 `accessToken`，并用防火墙限制来源网段。WebUI 始终只监听 `127.0.0.1`。令牌还决定谁能让 OpenQQ 发送本机文件，见 [actions.md](actions.md) 的「媒体来源」。

## 连接方式

### 正向 WebSocket

- 默认地址：`ws://127.0.0.1:3001/`
- 鉴权，二选一：
  - HTTP Header：`Authorization: Bearer <accessToken>`
  - URL 查询参数：`?access_token=<accessToken>`
- 路径：`/` 同时收事件、发动作；`/api` 只处理动作，不推送事件；`/event` 只推送事件，会忽略收到的动作。
- 连接成功且账号就绪后会推送 `lifecycle`（`connect`）；QQ 登录成功后会发送 `meta_event` / `heartbeat`。心跳间隔固定 15 秒（`interval: 15000`），正向和反向连接都一样，目前不能配置。
- 限流：同一来源 IP 在 60 秒内连续鉴权失败超过 20 次，会返回 `429 Too Many Requests`。

### 反向 WebSocket

- 请求头带 `X-Self-ID` 和 `X-Client-Role: Universal`；如果给这个连接单独配了密钥，还会带 `Authorization: Bearer <token>`。
- 正向和反向至少要启用一个。反向连接断开后，只要 QQ 会话仍然就绪，就每隔 3 秒自动重连，直到成功；QQ 未就绪时只等待，就绪后再连。这个间隔目前不能配置。

## 运行示例机器人

先在一个终端里保持 `npm start` 运行并登录 QQ，再在另一个终端设置环境变量并启动：

```powershell
$env:ONEBOT_TOKEN = "<config/openqq.json 里的 accessToken>"
# 可选：连接地址，默认 ws://127.0.0.1:3001/
# $env:ONEBOT_URL = "ws://127.0.0.1:3001/"
# 可选：只允许这些 QQ 号触发回复，逗号分隔
# $env:BOT_ALLOW_USERS = "123456789"
npm run bot
```

要让 `/ai <问题>` 命令走 OpenAI 兼容的 chat completions 接口，再设置：

```powershell
$env:BOT_API_URL = "https://api.example.com/v1/chat/completions"
$env:BOT_API_KEY = "<你的 API Key>"
$env:BOT_MODEL   = "<模型名称>"
```

示例机器人在私聊里支持 `/ping`（回复 `pong`）和 `/ai <内容>`。

## 参考

- [OneBot v11 正向 WebSocket](https://github.com/botuniverse/onebot-11/blob/master/communication/ws.md)
- [OneBot v11 反向 WebSocket](https://github.com/botuniverse/onebot-11/blob/master/communication/ws-reverse.md)
- [OneBot v11 鉴权](https://github.com/botuniverse/onebot-11/blob/master/communication/authorization.md)
- [OneBot v11 元事件](https://github.com/botuniverse/onebot-11/blob/master/event/meta.md)
- [Chat Completions API 参考](https://developers.openai.com/api/reference/resources/chat)
