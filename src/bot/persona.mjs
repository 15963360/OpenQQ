// 人设（养鱼）：每个 Bot 独立的系统提示词和性格，以及把「人设 + 记忆 + 近期对话」拼成模型请求的逻辑。

export const personalityPresets = {
  gentle: { label: '温柔', text: '温柔体贴，说话耐心，会照顾对方的情绪。' },
  lively: { label: '活泼', text: '活泼开朗，语气轻松，偶尔用一点颜文字或表情。' },
  sharp: { label: '毒舌', text: '爱调侃、嘴上不饶人，但从不真正伤人，也不骂脏话。' },
  serious: { label: '严谨', text: '严谨专业，条理清晰，少闲聊，给出可靠的信息。' },
  calm: { label: '佛系', text: '淡定随和，不急不躁，说话平和。' },
  custom: { label: '自定义', text: '' },
};
export const replyStyles = {
  short: { label: '简短', text: '回答尽量简短，一般不超过两三句话。' },
  normal: { label: '适中', text: '回答长度适中，说清楚就好。' },
  detailed: { label: '详细', text: '需要时可以展开详细回答，但仍要条理清楚。' },
};

export const defaultPersona = () => ({
  name: '小鱼',
  systemPrompt: '你是一条住在 QQ 里的小鱼，陪大家聊天。回答要自然、简洁；不确定的事情就直说不知道，不要编造。',
  personality: 'lively',
  traits: '',
  style: 'short',
  temperature: null,
});
export const defaultMemorySettings = () => ({ enabled: true, contextTurns: 12, summary: 'rule' });

const fail = message => { throw new Error(message); };
function limited(value, max, label, { allowEmpty = true } = {}) {
  if (typeof value !== 'string') fail(`${label}必须是文字`);
  const result = value.trim();
  if (result.length > max) fail(`${label}最多 ${max} 个字符`);
  if (!allowEmpty && !result) fail(`${label}不能为空`);
  return result;
}

export function normalizePersona(input, current = defaultPersona()) {
  if (input === undefined) return current;
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('人设格式无效');
  const merged = { ...current, ...input };
  if (!Object.hasOwn(personalityPresets, merged.personality)) fail('性格预设无效');
  if (!Object.hasOwn(replyStyles, merged.style)) fail('回复风格无效');
  let temperature = merged.temperature;
  if (temperature !== null && temperature !== undefined && temperature !== '') {
    temperature = Number(temperature);
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) fail('温度需要在 0–2 之间');
  } else temperature = null;
  return {
    name: limited(merged.name, 20, '名字', { allowEmpty: false }),
    systemPrompt: limited(merged.systemPrompt, 4000, '系统提示词'),
    personality: merged.personality,
    traits: limited(merged.traits, 500, '性格补充'),
    style: merged.style,
    temperature,
  };
}

export function normalizeMemorySettings(input, current = defaultMemorySettings()) {
  if (input === undefined) return current;
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('记忆设置格式无效');
  const merged = { ...current, ...input };
  if (typeof merged.enabled !== 'boolean') fail('记忆开关必须是布尔值');
  const turns = Number(merged.contextTurns);
  if (!Number.isInteger(turns) || turns < 0 || turns > 40) fail('带入模型的对话条数需要在 0–40 之间');
  if (!['rule', 'ai'].includes(merged.summary)) fail('摘要方式无效');
  return { enabled: merged.enabled, contextTurns: turns, summary: merged.summary };
}

/**
 * 拼出发给模型的 messages：
 *   system：系统提示词 + 名字/性格/风格 + 更早对话的摘要 + 笔记 + 会话信息；
 *   然后是最近的对话原文（群聊里用户消息前带昵称），最后是本次提问。
 * 提示词里只有人设、记忆和对话，没有别的内容。
 */
export function buildMessages({ persona, memorySettings, memory, chatKey, chat, sender, prompt, now = new Date() }) {
  const parts = [persona.systemPrompt.trim()];
  const traits = [personalityPresets[persona.personality].text, persona.traits, replyStyles[persona.style].text].filter(Boolean);
  parts.push(`你的名字是「${persona.name}」。${traits.join('')}`);
  const summary = memorySettings.enabled ? memory.summary(chatKey) : '';
  if (summary) parts.push(`以下是你们更早之前聊天的摘要（每行一句，旧的在前）：\n${summary}`);
  const notes = memory.notesFor(chatKey);
  if (notes.length) parts.push('你记住的信息：\n' + notes.map(([key, value]) => `- ${key}：${value}`).join('\n'));
  parts.push(`现在是 ${now.toLocaleString('zh-CN', { hour12: false })}，你在${chat.type === 'group' ? `群聊（群号 ${chat.id}）里，发言的人很多，每条用户消息前面带有发言人的昵称` : '私聊里'}。`);
  const messages = [{ role: 'system', content: parts.join('\n\n') }];
  if (memorySettings.enabled && memorySettings.contextTurns > 0) {
    for (const turn of memory.recent(chatKey, memorySettings.contextTurns)) {
      messages.push({ role: turn.role, content: turn.role === 'user' && turn.name ? `${turn.name}：${turn.text}` : turn.text });
    }
  }
  const name = chat.type === 'group' && sender ? sender + '：' : '';
  messages.push({ role: 'user', content: name + prompt });
  return messages;
}
