// 新建 Bot 时可以选的示例积木程序（Blockly 序列化格式）。每个模板都会被测试编译，保证保存得进去、跑得起来。
const wrap = input => Object.fromEntries(Object.entries(input).map(([name, block]) => [name, { block }]));
const b = (type, fields = {}, inputs = {}, next) => ({ type, fields, inputs: wrap(inputs), ...(next ? { next: { block: next } } : {}) });
const text = value => b('oq_text', { TEXT: value });
const info = field => b('oq_event_info', { FIELD: field });
const stack = (x, y, hat, ...rest) => {
  // 把一串语句从后往前接成 next 链。
  let next;
  for (const block of rest.reverse()) next = { ...block, ...(next ? { next: { block: next } } : {}) };
  return { ...hat, x, y, ...(next ? { next: { block: next } } : {}) };
};
const program = (...blocks) => ({ blocks: { languageVersion: 0, blocks }, variables: [] });

// 供测试和脚本拼装积木程序用的小工具。
export const build = { b, text, info, stack, program };

export const templates = [
  {
    id: 'ai-mention',
    name: '被 @ 时用 AI 回复',
    description: '群里有人 @ 机器人，就带着人设和记忆请 AI 回答，并引用原消息。',
    program: () => program(stack(40, 40, b('oq_on_mention'),
      b('oq_ai_reply', { REMEMBER: true, QUOTE: true }, { PROMPT: info('text') }))),
  },
  {
    id: 'ai-private',
    name: '私聊用 AI 聊天',
    description: '任何人私聊机器人都由 AI 回复，每个人的对话记忆互相独立。',
    program: () => program(stack(40, 40, b('oq_on_message', { SCOPE: 'private' }),
      b('oq_ai_reply', { REMEMBER: true, QUOTE: false }, { PROMPT: info('text') }))),
  },
  {
    id: 'keyword',
    name: '关键词自动回复 + 掷骰子',
    description: '群里提到「你好」就打招呼；发送 /roll 掷一个 1–6 的骰子。',
    program: () => program(
      stack(40, 40, b('oq_on_keyword', { SCOPE: 'group', MODE: 'contains', TEXT: '你好|hello' }),
        b('oq_reply', { AT: true, QUOTE: false }, { TEXT: b('oq_join', {}, { A: text('你好呀，'), B: info('sender_name') }) })),
      stack(40, 220, b('oq_on_command', { SCOPE: 'any', NAME: '/roll' }),
        b('oq_reply', { AT: false, QUOTE: true }, { TEXT: b('oq_join', {}, { A: text('🎲 你掷出了 '), B: b('oq_random', {}, { FROM: b('oq_number', { NUM: 1 }), TO: b('oq_number', { NUM: 6 }) }) }) })),
    ),
  },
  {
    id: 'memory-notes',
    name: '记住名字（记忆示例）',
    description: '发送「/记住 小明」让机器人记下你的名字，再发「/我是谁」让它回忆。',
    program: () => program(
      stack(40, 40, b('oq_on_command', { SCOPE: 'any', NAME: '/记住' }),
        b('oq_mem_set', { SCOPE: 'chat' }, { KEY: text('名字'), VALUE: info('args') }),
        b('oq_reply', { AT: false, QUOTE: false }, { TEXT: text('好的，我记住了。') })),
      stack(40, 240, b('oq_on_command', { SCOPE: 'any', NAME: '/我是谁' }),
        b('oq_reply', { AT: false, QUOTE: false }, { TEXT: b('oq_join', {}, { A: text('你是：'), B: b('oq_mem_get', { SCOPE: 'chat' }, { KEY: text('名字') }) }) })),
    ),
  },
];
