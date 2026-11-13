# 接收事件覆盖

接收和终端动作输入现已接上；动作边界见 [发送说明](actions.md)。这里区分已写转换、已通过自动测试和已由用户日志确认；“有监听回调”不等于全部字段已经适配。

## 已实现

| 事件 | 输出 | 验证与边界 |
| --- | --- | --- |
| 私聊、群聊文本 | `message` | 用户实机确认 |
| 群临时会话 | `message/private/group` | 自动测试；待实机 |
| 图片、表情、混合消息 | `image`、`face` 等消息段 | 用户日志确认图片、表情；图片下载尚未实现 |
| @、语音、视频、回复、JSON/XML 卡片 | 标准消息段 | 自动测试；待实机；回复 ID 与消息/撤回共用映射 |
| 文件、商城表情、Markdown | 扩展消息段 | 不自动下载；待实机 |
| 群内戳一戳 | `notice/notify/poke` | 业务 `1061`；按 UID 解析操作者和目标；待实机 |
| 私聊戳一戳 | `notice/notify/poke`，省略 `group_id` | OpenQQ 扩展；`user_id` 始终为操作者；待实机 |
| 群聊/私聊撤回 | `group_recall`、`friend_recall` | 读取消息更新里的撤回元素；与原消息关联 ID；更新回调忽略启动前的历史撤回，保留 5 秒时钟容差 |
| 成员加入、退出、被踢、机器人被踢 | `group_increase`、`group_decrease` | 系统推送类型 `33`、`34`；待实机字段验证 |
| 管理员设置/取消 | `group_admin` | 系统推送 `44`；待实机 |
| 禁言、解禁、全员禁言 | `group_ban` | 灰条群事件；全员禁言 `user_id=0`；待实机 |
| 群文件上传 | `group_upload` | 保留客户端文件 UUID、名称、大小、业务 ID；待实机 |
| 好友新增 | `friend_add` | 灰条业务 `19324` 或同步结束后的完整列表变化；待实机 |
| 好友删除 | `friend_delete` 扩展 | 同步结束后的完整列表差异；本版本列表完整性仍需验证 |
| 群名片、头衔变化 | `group_card`、`notify/title` 扩展 | 成员信息更新需先有旧值基线，不把首次加载当作变化 |
| 群名称变化 | `group_name` 扩展 | 群灰条类型 `5`；待实机 |
| 好友申请 | `request/friend` | 过滤已读、已处理和自己发起的记录；保留请求时间为 flag |
| 入群申请、邀请机器人入群 | `request/group` | 群通知 `1`、`5`、`7`，未处理状态 `1`；保留原始 seq 为 flag；已接 V2 通知入口，待实机申请验证 |
| 对方输入状态 | `notify/input_status` 扩展 | 接收 `onInputStatusPush`；不主动发送输入状态 |
| 被踢下线 | `bot_offline` 扩展 | 接收下线回调并更新运行状态 |

缺少操作者的成员系统事件使用 `operator_id=0`，附 `openqq_operator_unknown=true`；不会猜测为群主或机器人。解散群使用 `kick_me`，附 `openqq_reason=disband`。这些退化字段属于 OpenQQ 扩展，需使用方识别。

## 尚未完成标准化

红包运气王、群荣誉、精华消息、表情回应、个人资料点赞、公告、群待办、音视频通话、在线文件传输进度、频道事件及其他客户端内部变化尚未逐项适配。

未识别的聊天灰条输出 `openqq_gray_tip` 扩展，保留原始元素；未识别的消息段输出 `openqq_element`。未知服务回调只在标准错误输出一次 `native_callback` 参数结构摘要，不代表已经实现对应事件。
频道等未适配的聊天类型也只输出结构摘要，不承诺完整内容接收。

## 实机检查

代码变化需要重启 OpenQQ 和 QQ。先 Ctrl+C 停止 OpenQQ，再手动退出 QQ，执行 `npm start`。`session_ready.services` 应包含 `msg`、`buddy`、`group`。

使用测试账号依次验证私聊/群聊戳一戳、撤回、@、媒体、入群与退出、管理员设置/取消、禁言/解禁、好友申请及入群申请。接收事件不会自动回复或批准请求；只有明确输入发送动作才会调用 QQ 发送。

启动同步期间不应出现批量 `friend_add`。出现 `sync_state` 且 `syncing=false` 后再观察真实变化。QQ 的原始控制台输出写入 `.runtime/qq.log`，默认不再显示；需要排查时输入 `/verbose` 或查看该文件。

## 本轮实机反馈修正

2026-11-12 用户日志确认三个监听成功，文本、图片和表情均有输出，也暴露了同步期间误报好友新增及系统通知入口字节校验错误。
已用同步阶段建立好友基线，并兼容原生有符号字节数组 `-128..127` 与无符号数组 `0..255`；日志没有包含原始字节，所以系统通知的实机解码仍需复验。

## 后续动作输入

已接基础账号状态查询、私聊/群聊文本发送和输入状态通知，提供 CLI/WebUI 初始化及 OneBot 正反向 WebSocket，见 [机器人接入](connect.md)。后续完善好友/群查询、媒体/回复发送、戳一戳、主动撤回、申请处理及群管理；HTTP、SDK 和 MCP 尚未实现。

协议依据：[OneBot v11 通知](https://github.com/botuniverse/onebot-11/blob/master/event/notice.md)、[请求](https://github.com/botuniverse/onebot-11/blob/master/event/request.md)、[消息段](https://github.com/botuniverse/onebot-11/blob/master/message/segment.md)。原生接口参考已有项目的声明与字段布局；本项目没有引入或执行其运行时，转换逻辑独立实现。
