import { convertSegment, cqString } from './segments.mjs';

function integer(value, field, min = 0) {
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^-?\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < min) {
    throw new Error(field + ' 不是有效的 OneBot 数值标识');
  }
  return Number(value);
}
const id = (value, field) => integer(value, field, 1);

export function createEventConverter() {
  const ids = new Map();
  const seen = new Map();
  let nextId = 1;
  const keyOf = (selfId, message, nativeId = message.msgId) => {
    if (!/^\d+$/.test(String(nativeId)) || (typeof nativeId === 'number' && !Number.isSafeInteger(nativeId))) {
      throw new Error('原生消息标识无效或已丢失精度');
    }
    return [selfId, message.chatType, message.peerUid, nativeId].join(':');
  };
  function messageId(key) {
    if (!ids.has(key)) ids.set(key, nextId++);
    // shortcut: correlation and deduplication retain 10000 entries in memory, persist before adding history APIs.
    if (ids.size > 10000) ids.delete(ids.keys().next().value);
    return ids.get(key);
  }
  function messageEvent(self, message) {
    if (![1, 2, 100].includes(message.chatType)) return null;
    const selfId = id(self.uin, 'self_id');
    if (!Array.isArray(message.elements) || !message.elements.length) throw new Error('原生消息元素为空');
    const grayTips = message.elements.filter(element => element.elementType === 8);
    if (grayTips.length && !message.poke) throw new Error('尚未支持的灰条通知');
    const time = id(message.msgTime, 'time');
    const groupId = message.chatType === 2 ? id(message.peerUin ?? message.peerUid, 'group_id') : undefined;
    const key = keyOf(selfId, message);
    let event;
    if (message.poke) {
      if (message.elements.length !== 1 || grayTips.length !== 1 || String(grayTips[0].grayTipElement?.jsonGrayTipElement?.busiId) !== '1061') throw new Error('戳一戳缺少原生灰条标识');
      event = { post_type: 'notice', notice_type: 'notify', sub_type: 'poke',
        user_id: id(message.poke.userUin, 'user_id'), target_id: id(message.poke.targetUin, 'target_id') };
    } else {
      const senderId = id(message.senderUin, 'user_id');
      if (senderId === selfId) return null;
      const segments = message.elements.map(element => convertSegment(element, original => messageId(keyOf(selfId, message, original))));
      event = { post_type: 'message', message_type: message.chatType === 2 ? 'group' : 'private',
        sub_type: message.chatType === 2 ? 'normal' : message.chatType === 100 ? 'group' : 'other',
        message_id: messageId(key), user_id: senderId, message: segments, raw_message: cqString(segments),
        font: 0, sender: { user_id: senderId, nickname: String(message.sendNickName ?? '') },
      };
      if (message.chatType === 2) {
        event.sender.card = String(message.sendMemberName ?? '');
        event.anonymous = null;
      }
    }
    if (groupId !== undefined) event.group_id = groupId;
    return { event: { time, self_id: selfId, ...event }, key: key + ':' + event.post_type };
  }
  function convert(raw) {
    let result;
    if (raw.type === 'message') result = messageEvent(raw.self, raw.message);
    else if (raw.type === 'notice' || raw.type === 'request') {
      const selfId = id(raw.self.uin, 'self_id');
      const event = { ...raw.event };
      const type = event.notice_type ?? event.request_type;
      if (!type) throw new Error('事件缺少类型');
      if (['group_admin', 'group_increase', 'group_decrease', 'group_ban', 'group_recall', 'group_upload', 'group_card', 'group_name', 'group'].includes(type)) event.group_id = id(event.group_id, 'group_id');
      if (!['openqq_native', 'openqq_gray_tip', 'bot_offline'].includes(type)) event.user_id = integer(event.user_id, 'user_id', type === 'group_ban' ? 0 : 1);
      if ('target_id' in event) event.target_id = id(event.target_id, 'target_id');
      if ('operator_id' in event) event.operator_id = integer(event.operator_id, 'operator_id');
      if (['group_increase', 'group_decrease', 'group_ban', 'group_recall'].includes(type) && !('operator_id' in event)) throw new Error('通知缺少 operator_id');
      const subtypes = { group_admin: ['set', 'unset'], group_increase: ['approve', 'invite'], group_decrease: ['leave', 'kick', 'kick_me'], group_ban: ['ban', 'lift_ban'], group: ['add', 'invite'] };
      if (Object.hasOwn(subtypes, type) && !subtypes[type].includes(event.sub_type)) throw new Error('事件 sub_type 无效');
      if (type === 'group_ban') event.duration = integer(event.duration, 'duration', -1);
      if (type === 'group_recall' || type === 'friend_recall') event.message_id = messageId(keyOf(selfId, raw.message));
      if (type === 'group_upload') {
        if (typeof event.file?.id !== 'string' || !event.file.id || typeof event.file.name !== 'string') throw new Error('群文件标识无效');
        event.file = { ...event.file, size: integer(event.file.size, 'file.size'), busid: integer(event.file.busid, 'file.busid') };
      }
      if (raw.type === 'request' && (!['friend', 'group'].includes(event.request_type) || typeof event.flag !== 'string' || !event.flag)) throw new Error('请求类型或 flag 无效');
      result = { event: { time: id(raw.time ?? Math.floor(Date.now() / 1000), 'time'), self_id: selfId, post_type: raw.type, ...event },
        key: raw.key ? [selfId, raw.type, raw.key].join(':') : undefined };
    } else return null;
    if (!result) return null;
    if (result.key) {
      if (seen.has(result.key)) return null;
      seen.set(result.key, true);
      if (seen.size > 10000) seen.delete(seen.keys().next().value);
    }
    return result.event;
  };
  convert.messageId = (self, message) => messageId(keyOf(id(self.uin, 'self_id'), message));
  return convert;
}

export function createMessageConverter() {
  const convert = createEventConverter();
  return (self, message) => convert({ type: 'message', self, message });
}
