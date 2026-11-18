// 积木定义（Blockly JSON 格式）。这是积木的单一来源：
//   - WebUI（ui/blocks/editor.mjs）用它渲染积木；
//   - 服务端 compile.mjs 用它校验积木程序：类型白名单、字段取值、输入口种类。
// 这里只有数据，没有可执行逻辑；积木的行为全部写在 interpreter.mjs 里。
// 颜色由 WebUI 主题按 style 名称提供（oq_events 等），所以这里不写颜色。

const scope = [['任意', 'any'], ['私聊', 'private'], ['群聊', 'group']];
const memoryScope = [['当前会话', 'chat'], ['整个 Bot', 'bot']];
const text = (name = 'TEXT') => ({ type: 'input_value', name });
const bool = (name, checked = false) => ({ type: 'field_checkbox', name, checked });

const hat = (type, message0, args0, tooltip) => ({ type, message0, args0, nextStatement: null, style: 'oq_events', tooltip });
const stmt = (type, message0, args0, style, tooltip, extra = {}) => ({ type, message0, args0, previousStatement: null, nextStatement: null, style, tooltip, ...extra });
const value = (type, message0, args0, style, tooltip, output = null, extra = {}) => ({ type, message0, args0, output, style, tooltip, ...extra });

export const eventInfo = [
  ['消息文本', 'text'], ['发送者 QQ', 'sender_id'], ['发送者昵称', 'sender_name'], ['群号', 'group_id'],
  ['机器人 QQ', 'self_id'], ['消息 ID', 'message_id'], ['命令参数', 'args'],
];
export const eventFlags = [['是群聊', 'group'], ['是私聊', 'private'], ['我被 @ 了', 'mentioned'], ['含图片', 'image']];
export const timeParts = [['小时（0-23）', 'hour'], ['分钟', 'minute'], ['星期几（周一=1）', 'weekday'], ['日期（年-月-日）', 'date'], ['时间（时:分）', 'clock']];

export const blockDefinitions = [
  // ---- 触发（每个积木堆以一个触发积木开头；条件满足时运行它下面的积木）----
  hat('oq_on_message', '当收到 %1 消息', [{ type: 'field_dropdown', name: 'SCOPE', options: scope }], '每收到一条符合范围的消息就运行'),
  hat('oq_on_mention', '当群里有人 @我', [], '群消息里 @ 了机器人时运行'),
  hat('oq_on_keyword', '当收到 %1 消息 %2 %3', [
    { type: 'field_dropdown', name: 'SCOPE', options: scope },
    { type: 'field_dropdown', name: 'MODE', options: [['包含', 'contains'], ['等于', 'equals'], ['开头是', 'starts']] },
    { type: 'field_input', name: 'TEXT', text: '你好' },
  ], '关键词可以用 | 分隔多个，匹配其中任意一个，不区分大小写'),
  hat('oq_on_command', '当收到 %1 命令 %2', [
    { type: 'field_dropdown', name: 'SCOPE', options: scope },
    { type: 'field_input', name: 'NAME', text: '/ask' },
  ], '消息以这个命令开头时运行，命令后面的内容是「命令参数」'),

  // ---- 控制 ----
  stmt('oq_if', '如果 %1 那么 %2', [{ type: 'input_value', name: 'COND', check: 'Boolean' }, { type: 'input_statement', name: 'DO' }], 'oq_control', '条件成立才执行里面的积木'),
  stmt('oq_if_else', '如果 %1 那么 %2 否则 %3', [{ type: 'input_value', name: 'COND', check: 'Boolean' }, { type: 'input_statement', name: 'THEN' }, { type: 'input_statement', name: 'ELSE' }], 'oq_control', '条件成立执行「那么」，否则执行「否则」'),
  stmt('oq_repeat', '重复 %1 次 %2', [{ type: 'input_value', name: 'TIMES' }, { type: 'input_statement', name: 'DO' }], 'oq_control', '最多重复 100 次'),
  stmt('oq_while', '当 %1 时重复 %2', [{ type: 'input_value', name: 'COND', check: 'Boolean' }, { type: 'input_statement', name: 'DO' }], 'oq_control', '条件成立时一直重复，最多 100 次；步数过多会被强制停止'),
  { type: 'oq_stop', message0: '停止本次运行', previousStatement: null, style: 'oq_control', tooltip: '结束当前积木堆，后面的积木不再执行' },

  // ---- 消息信息 ----
  value('oq_event_info', '%1', [{ type: 'field_dropdown', name: 'FIELD', options: eventInfo }], 'oq_sensing', '当前这条消息的信息；没有的信息为空'),
  value('oq_event_flag', '%1', [{ type: 'field_dropdown', name: 'FLAG', options: eventFlags }], 'oq_sensing', '判断当前消息的特征', 'Boolean'),
  value('oq_time', '当前 %1', [{ type: 'field_dropdown', name: 'PART', options: timeParts }], 'oq_sensing', '运行 OpenQQ 的这台电脑的本地时间'),

  // ---- 运算 ----
  value('oq_text', '%1', [{ type: 'field_input', name: 'TEXT', text: '' }], 'oq_operator', '一段文字'),
  value('oq_number', '%1', [{ type: 'field_number', name: 'NUM', value: 0 }], 'oq_operator', '一个数字'),
  value('oq_bool', '%1', [{ type: 'field_dropdown', name: 'BOOL', options: [['真', 'true'], ['假', 'false']] }], 'oq_operator', '真或假', 'Boolean'),
  value('oq_join', '连接 %1 和 %2', [text('A'), text('B')], 'oq_operator', '把两段文字接在一起；需要更多段就嵌套'),
  value('oq_text_contains', '%1 包含 %2', [text('TEXT'), text('SUB')], 'oq_operator', '不区分大小写', 'Boolean'),
  value('oq_text_length', '%1 的长度', [text('TEXT')], 'oq_operator', '字符个数'),
  value('oq_text_replace', '把 %1 中的 %2 替换为 %3', [text('TEXT'), text('FROM'), text('TO')], 'oq_operator', '替换所有出现的位置'),
  value('oq_text_sub', '%1 的第 %2 到 %3 个字符', [text('TEXT'), text('FROM'), text('TO')], 'oq_operator', '从 1 开始数，包含两端'),
  value('oq_arith', '%1 %2 %3', [text('A'), { type: 'field_dropdown', name: 'OP', options: [['+', 'add'], ['−', 'sub'], ['×', 'mul'], ['÷', 'div'], ['取余', 'mod']] }, text('B')], 'oq_operator', '四则运算', null, { inputsInline: true }),
  value('oq_compare', '%1 %2 %3', [text('A'), { type: 'field_dropdown', name: 'OP', options: [['=', 'eq'], ['≠', 'neq'], ['<', 'lt'], ['≤', 'lte'], ['>', 'gt'], ['≥', 'gte']] }, text('B')], 'oq_operator', '两边都是数字时按数字比较，否则按文字比较', 'Boolean', { inputsInline: true }),
  value('oq_logic', '%1 %2 %3', [{ type: 'input_value', name: 'A', check: 'Boolean' }, { type: 'field_dropdown', name: 'OP', options: [['且', 'and'], ['或', 'or']] }, { type: 'input_value', name: 'B', check: 'Boolean' }], 'oq_operator', '逻辑与 / 或', 'Boolean', { inputsInline: true }),
  value('oq_not', '不满足 %1', [{ type: 'input_value', name: 'A', check: 'Boolean' }], 'oq_operator', '取反', 'Boolean'),
  value('oq_random', '随机整数 从 %1 到 %2', [text('FROM'), text('TO')], 'oq_operator', '包含两端'),
  value('oq_random_pick', '随机选一个 %1', [{ type: 'field_input', name: 'TEXT', text: '是|否|再想想' }], 'oq_operator', '用 | 分隔候选项'),

  // ---- 变量（每次运行从空开始，不会保存；要长期保存请用「记忆」积木）----
  value('oq_var_get', '%1', [{ type: 'field_variable', name: 'VAR', variable: '变量' }], 'oq_variable', '读取变量'),
  stmt('oq_var_set', '把 %1 设为 %2', [{ type: 'field_variable', name: 'VAR', variable: '变量' }, text('VALUE')], 'oq_variable', '变量只在本次运行内有效'),
  stmt('oq_var_change', '把 %1 增加 %2', [{ type: 'field_variable', name: 'VAR', variable: '变量' }, text('DELTA')], 'oq_variable', '变量按数字加上一个数'),

  // ---- 发送 ----
  stmt('oq_reply', '回复 %1 @发送者 %2 引用原消息 %3', [text('TEXT'), bool('AT'), bool('QUOTE')], 'oq_send', '发到收到消息的那个会话', { inputsInline: true }),
  stmt('oq_send_to', '发送到 %1 号码 %2 内容 %3', [
    { type: 'field_dropdown', name: 'TARGET', options: [['私聊', 'private'], ['群', 'group']] }, text('ID'), text('TEXT'),
  ], 'oq_send', '发给指定的 QQ 号或群；会受发送频率限制', { inputsInline: true }),
  stmt('oq_send_media', '发送 %1 来源 %2', [
    { type: 'field_dropdown', name: 'TYPE', options: [['图片', 'image'], ['语音', 'record'], ['视频', 'video'], ['文件', 'file']] }, text('SRC'),
  ], 'oq_send', '来源必须是 http(s):// 链接或 base64:// 数据，不能是本机路径', { inputsInline: true }),
  stmt('oq_send_fun', '发送 %1', [{ type: 'field_dropdown', name: 'TYPE', options: [['骰子', 'dice'], ['猜拳', 'rps']] }], 'oq_send', '发送到收到消息的会话'),
  stmt('oq_send_face', '发送 QQ 表情 编号 %1', [text('ID')], 'oq_send', '发送到收到消息的会话', { inputsInline: true }),

  // ---- AI ----
  stmt('oq_ai_reply', 'AI 回复 %1 记住对话 %2 引用原消息 %3', [text('PROMPT'), bool('REMEMBER', true), bool('QUOTE')], 'oq_ai',
    '带上人设、记忆和最近的对话请求 AI，并把回答原样发到当前会话', { inputsInline: true }),
  value('oq_ai_ask', '询问 AI %1 记住对话 %2', [text('PROMPT'), bool('REMEMBER', true)], 'oq_ai',
    '返回 AI 的回答文字，不会自动发送', null, { inputsInline: true }),

  // ---- 记忆 ----
  stmt('oq_mem_set', '记住 %1 为 %2 范围 %3', [text('KEY'), text('VALUE'), { type: 'field_dropdown', name: 'SCOPE', options: memoryScope }], 'oq_memory', '长期保存一条笔记，也会写进 AI 的提示词', { inputsInline: true }),
  value('oq_mem_get', '回忆 %1 范围 %2', [text('KEY'), { type: 'field_dropdown', name: 'SCOPE', options: memoryScope }], 'oq_memory', '没有记过时为空', null, { inputsInline: true }),
  stmt('oq_mem_forget', '忘记 %1 范围 %2', [text('KEY'), { type: 'field_dropdown', name: 'SCOPE', options: memoryScope }], 'oq_memory', '删除一条笔记', { inputsInline: true }),
  stmt('oq_mem_clear_chat', '清空当前会话的记忆', [], 'oq_memory', '删除当前会话的对话记录、摘要和笔记；整个 Bot 的笔记不受影响'),
];

export const blockTypes = new Map(blockDefinitions.map(definition => [definition.type, definition]));

/** hat：触发积木；statement：可连接的语句；value：有输出的积木。 */
export function blockKind(definition) {
  if (definition.output !== undefined) return 'value';
  if (definition.previousStatement !== undefined) return 'statement';
  return 'hat';
}
