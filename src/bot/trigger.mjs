// OneBot 消息事件 → 解释器使用的精简事件，以及触发积木的匹配规则。

/**
 * 只处理私聊和群聊的消息事件；其他事件（通知、请求、元事件）返回 null。
 * text 只含文字段（@、图片等不算），已去掉首尾空白，用来匹配关键词和命令。
 */
export function normalizeEvent(raw) {
  if (!raw || raw.post_type !== 'message' || !['private', 'group'].includes(raw.message_type)) return null;
  const segments = typeof raw.message === 'string' ? [{ type: 'text', data: { text: raw.message } }]
    : Array.isArray(raw.message) ? raw.message.filter(segment => segment && typeof segment === 'object') : [];
  const selfId = String(raw.self_id ?? '');
  const userId = Number(raw.user_id);
  const chatId = raw.message_type === 'group' ? Number(raw.group_id) : userId;
  if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isSafeInteger(chatId) || chatId <= 0) return null;
  if (selfId && String(userId) === selfId) return null;
  const at = segment => segment.type === 'at' ? String(segment.data?.qq ?? '') : null;
  return {
    selfId,
    userId,
    nickname: String(raw.sender?.card || raw.sender?.nickname || ''),
    messageId: raw.message_id === undefined ? '' : String(raw.message_id),
    chat: { type: raw.message_type, id: chatId },
    chatKey: (raw.message_type === 'group' ? 'g:' : 'p:') + chatId,
    text: segments.filter(segment => segment.type === 'text').map(segment => String(segment.data?.text ?? '')).join('').trim(),
    atSelf: Boolean(selfId) && segments.some(segment => at(segment) === selfId),
    hasImage: segments.some(segment => segment.type === 'image'),
  };
}

const inScope = (scope, event) => scope === 'any' || scope === event.chat.type;

/** 触发积木是否匹配；匹配时返回 { args }（命令后面的文字），否则返回 null。 */
export function matchTrigger(hat, event) {
  const { fields } = hat;
  const lower = event.text.toLowerCase();
  switch (hat.type) {
    case 'oq_on_message': return inScope(fields.SCOPE, event) ? { args: '' } : null;
    case 'oq_on_mention': return event.chat.type === 'group' && event.atSelf ? { args: '' } : null;
    case 'oq_on_keyword': {
      if (!inScope(fields.SCOPE, event)) return null;
      const words = fields.TEXT.split('|').map(word => word.trim().toLowerCase()).filter(Boolean);
      const hit = words.some(word => fields.MODE === 'equals' ? lower === word : fields.MODE === 'starts' ? lower.startsWith(word) : lower.includes(word));
      return hit ? { args: '' } : null;
    }
    case 'oq_on_command': {
      const name = fields.NAME.trim().toLowerCase();
      if (!inScope(fields.SCOPE, event) || !name || !lower.startsWith(name)) return null;
      const next = event.text[name.length];
      if (next !== undefined && !/\s/.test(next)) return null;
      return { args: event.text.slice(name.length).trim() };
    }
    default: return null;
  }
}
