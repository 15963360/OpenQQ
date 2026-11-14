// OneBot actions implemented by src/actions.mjs (see docs/actions.md). Keep in sync when adding actions.
export interface ParamSpec { name: string; type: string; required?: boolean; description: string }
export interface ActionSpec {
  action: string;
  group: '消息' | '账号' | '扩展';
  summary: string;
  description: string;
  params: ParamSpec[];
  example: Record<string, unknown>;
  /** Performs a real send through the logged-in QQ account. */
  sends?: boolean;
}

const message: ParamSpec = { name: 'message', type: 'string | segment[]', required: true, description: '纯文本，或最多 100 个消息段（text、reply、json），总长不超过 64 KiB' };
const autoEscape: ParamSpec = { name: 'auto_escape', type: 'boolean', description: '字符串消息含 [CQ: 时必须为 true，按纯文本原样发送' };

export const catalog: ActionSpec[] = [
  { action: 'send_private_msg', group: '消息', sends: true, summary: '发送私聊消息', description: '向好友发送一条消息。成功表示收到 QQ 的发送回调，不代表对方已读。',
    params: [{ name: 'user_id', type: 'number', required: true, description: '对方 QQ 号' }, message, autoEscape],
    example: { user_id: 123456789, message: '你好', auto_escape: true } },
  { action: 'send_group_msg', group: '消息', sends: true, summary: '发送群消息', description: '向群聊发送一条消息；reply 段只能引用同一会话的消息。',
    params: [{ name: 'group_id', type: 'number', required: true, description: '群号' }, message, autoEscape],
    example: { group_id: 987654321, message: [{ type: 'text', data: { text: '群消息测试' } }] } },
  { action: 'send_msg', group: '消息', sends: true, summary: '发送消息（自动判断）', description: '指定 message_type，或只提供 user_id / group_id 其中之一来确定目标。',
    params: [{ name: 'message_type', type: "'private' | 'group'", description: '会话类型，可省略' }, { name: 'user_id', type: 'number', description: '私聊目标 QQ 号' },
      { name: 'group_id', type: 'number', description: '群号' }, message, autoEscape],
    example: { message_type: 'private', user_id: 123456789, message: '你好', auto_escape: true } },
  { action: 'get_forward_msg', group: '消息', summary: '获取合并转发', description: '按 forward 段的 id，或携带转发的那条消息的 message_id 获取转发内容。',
    params: [{ name: 'id', type: 'string', required: true, description: '合并转发 id 或 message_id，仅限本次运行期间收到的消息' }],
    example: { id: '15' } },
  { action: 'get_login_info', group: '账号', summary: '获取登录信息', description: '返回当前账号的 QQ 号；昵称暂为空字符串。', params: [], example: {} },
  { action: 'get_status', group: '账号', summary: '获取运行状态', description: '反映原生会话是否可用，未包含完整的网络连通性探测。', params: [], example: {} },
  { action: 'set_input_status', group: '扩展', summary: '设置输入状态', description: '向私聊对象提交「正在输入」等状态通知；成功只表示原生调用完成。',
    params: [{ name: 'user_id', type: 'number', required: true, description: '对方 QQ 号' }, { name: 'event_type', type: 'number', required: true, description: '事件码，1 为正在输入；其他值原样传给 QQ' }],
    example: { user_id: 123456789, event_type: 1 } },
];

export const retcodes: Record<number, string> = {
  0: '成功',
  1400: '参数或输入格式无效，未提交发送',
  1404: '动作尚未支持，或引用 / 转发的 id 不存在、已过期',
  1500: '原生调用失败或回执无效',
  1501: '超时，已提交的发送结果可能未确认',
  1502: '会话未就绪、重新初始化或 IPC 断开',
  1503: '动作队列已满，未提交',
};

export function requestTemplate(spec: ActionSpec) {
  return JSON.stringify({ action: spec.action, ...(spec.params.length ? { params: spec.example } : {}), echo: 'webui' }, null, 2);
}
