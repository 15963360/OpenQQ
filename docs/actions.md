# 终端动作输入与发送

修改代码后，需要 Ctrl+C 停止 OpenQQ、手动退出 QQ，再执行 `npm start`。正常登录，等待「QQ 会话就绪」后，在同一终端底部的提示符输入动作并回车。输入过程中收到的事件会打印在提示符上方，不会打断正在输入的内容。

当前入口包括终端标准输入、本机 WebUI、OneBot v11 正向和反向 WebSocket。初始化与网络配置见 [机器人接入](connect.md)。尚无 OneBot HTTP 动作服务。

## 快捷命令

以下号码都是示例，请替换为你准备测试的账号或群。

```text
/private 123456789 你好，发送测试
/group 987654321 群消息测试
/input 123456789 1
/login
/status
/verbose
/clear
/help
/quit
```

`/verbose` 开关调试信息与 QQ 原始日志的显示，`/clear` 清屏。终端中可用 Tab 补全命令、↑↓ 翻历史。

`/private`、`/group` 把后面的内容当作纯文本，包含 CQ 码样式的内容也会原样发送。`/input` 提交私聊输入状态通知，默认事件码为 `1`；其他事件码原样传入 QQ，不推测其含义。
`/quit` 解除挂接并退出 OpenQQ，QQ 可以继续运行。

## OneBot 动作

支持 `send_private_msg`、`send_group_msg`、`send_msg`、`get_login_info`、`get_status`，以及扩展动作 `set_input_status`。

```json
{"action":"send_private_msg","params":{"user_id":123456789,"message":"你好","auto_escape":true},"echo":"send-1"}
{"action":"send_group_msg","params":{"group_id":987654321,"message":[{"type":"text","data":{"text":"群消息测试"}}]},"echo":"send-2"}
{"action":"set_input_status","params":{"user_id":123456789,"event_type":1},"echo":"typing-1"}
{"action":"get_login_info","echo":"login-1"}
```

每个 JSON 对象占一行；文本换行可写为 JSON 的 `\n`。`send_msg` 可指定 `message_type`，或只提供 `user_id`、`group_id` 中的一种来确定目标。
目前发送只接受纯文本或最多 100 个 `text` 段，总内容不超过 64 KiB。字符串包含 `[CQ:` 且未指定 `auto_escape:true` 时会拒绝；图片、语音、@、回复等发送段尚未接入。

发送成功回执示例：

```json
{"status":"ok","retcode":0,"data":{"message_id":1},"echo":"send-1"}
```

`message_id` 与接收事件、撤回通知共用同一进程内的映射；原生 64 位 ID 不会转成丢失精度的 JavaScript 数字。`echo` 按原值返回。
发送成功表示收到匹配目标、当前账号和请求标识的 QQ 成功回调，不表示对方已读。
输入状态成功只表示原生通知调用完成，未验证对方客户端是否显示。

## 失败与当前边界

| retcode | 含义 |
| --- | --- |
| `1400` | 参数或输入格式无效，未提交发送 |
| `1404` | 动作尚未支持 |
| `1500` | 原生调用失败或回执无效 |
| `1501` | 超时，已提交的发送结果可能未确认 |
| `1502` | 会话未就绪、重新初始化或 IPC 断开 |
| `1503` | 动作队列已满，未提交 |

动作等待上限约 15 秒，IPC 另有兜底超时。不会自动重发；超时或断线后，应先在 QQ 中确认是否已发送。重新登录、会话重建或退出 OpenQQ 会阻止尚未提交的旧动作，已经交给 QQ 的发送无法由断开 IPC 撤销。

`get_login_info` 当前返回账号 QQ 号，昵称为空字符串。`get_status` 当前反映原生会话是否可用，未接入完整网络连通性探测。

支持的参数校验规则、UID 转换、并发回执匹配、超时与断线保护均有对应测试覆盖。若在未经过完整基准验证的新版本 QQ NT 上运行，请结合终端 `/verbose` 日志或 WebUI 运行诊断核对发送回调字段。

后续再接媒体/回复发送、主动撤回、戳一戳、申请处理及群管理。

协议字段参考 [OneBot v11 公开 API](https://github.com/botuniverse/onebot-11/blob/master/api/public.md)。输入状态是扩展能力。
