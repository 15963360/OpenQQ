'use strict';

function fail(message, retcode = 1400) { return Object.assign(new Error(message), { retcode }); }
function identifier(value, name) {
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
    throw fail(`${name} 必须是有效的 QQ 数值标识`);
  }
  return String(value);
}

function validateAction(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request) || typeof request.action !== 'string') throw fail('需要 {action, params, echo?} 动作对象');
  const params = request.params ?? {};
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw fail('params 必须为对象');
  if (['get_login_info', 'get_status'].includes(request.action)) return { kind: request.action };
  if (request.action === 'set_input_status') {
    if (!Number.isInteger(params.event_type) || params.event_type < 0 || params.event_type > 0x7fffffff) throw fail('event_type 必须是非负 int32');
    return { kind: 'input', target: identifier(params.user_id, 'user_id'), eventType: params.event_type };
  }
  if (!['send_private_msg', 'send_group_msg', 'send_msg'].includes(request.action)) throw fail('尚未支持动作: ' + request.action, 1404);
  let type = request.action === 'send_private_msg' ? 'private' : request.action === 'send_group_msg' ? 'group' : params.message_type;
  if (!type) {
    if ((params.user_id !== undefined) === (params.group_id !== undefined)) throw fail('send_msg 需要明确 message_type 或唯一的目标');
    type = params.user_id !== undefined ? 'private' : 'group';
  }
  if (!['private', 'group'].includes(type)) throw fail('message_type 仅支持 private/group');
  const target = identifier(type === 'private' ? params.user_id : params.group_id, type === 'private' ? 'user_id' : 'group_id');
  if (params.auto_escape !== undefined && typeof params.auto_escape !== 'boolean') throw fail('auto_escape 必须为布尔值');
  let texts;
  if (typeof params.message === 'string') {
    if (!params.auto_escape && params.message.includes('[CQ:')) throw fail('当前发送仅支持文本；CQ 字面量请指定 auto_escape:true 或使用 text 数组段');
    texts = [params.message];
  } else if (Array.isArray(params.message) && params.message.length <= 100) {
    texts = params.message.map(segment => {
      if (segment?.type !== 'text' || typeof segment.data?.text !== 'string') throw fail('当前发送仅支持 text 消息段');
      return segment.data.text;
    });
  } else throw fail('message 必须为文本或最多 100 个 text 段');
  if (!texts.length || !texts.some(text => text.length) || Buffer.byteLength(texts.join('')) > 65536) throw fail('消息不能为空或超过 64 KiB');
  return { kind: 'send', chatType: type === 'private' ? 1 : 2, target, texts };
}

function createActionHandler(session, self, current) {
  const operations = new Set();
  const waiting = new Map();
  let disposed = false;

  function observe(name, args) {
    const records = name === 'onMsgInfoListUpdate' ? args[0] : name === 'onAddSendMsg' ? [args[0]] : [];
    if (!Array.isArray(records)) return;
    for (const record of records) {
      if (!record || (String(record.senderUin) !== self.uin && !(self.uid && record.senderUid === self.uid))) continue;
      const task = waiting.get(String(record.guildId)) ?? waiting.get(String(record.msgId));
      if (!task || record.chatType !== task.peer.chatType || String(record.peerUid) !== task.peer.peerUid || ![0, 2].includes(record.sendStatus)) continue;
      task.resolve(record);
    }
  }

  async function execute(request) {
    const action = validateAction(request);
    const operation = { active: true };
    const ensure = () => { if (disposed || !current() || !operation.active) throw fail('原生会话已失效，动作未继续执行', 1502); };
    ensure();
    let timer;
    let tag;
    const cancelled = new Promise((_, reject) => {
      operation.cancel = () => { operation.active = false; reject(fail('会话或连接已关闭；已提交的发送结果未确认，请先查看 QQ，勿自动重试', 1502)); };
      timer = setTimeout(() => { operation.active = false; reject(fail('动作超时，已提交的发送结果未确认；请先查看 QQ，勿自动重试', 1501)); }, 15000);
    });
    operations.add(operation);
    try {
      return await Promise.race([cancelled, (async () => {
        if (action.kind === 'get_login_info') return { user_id: Number(self.uin), nickname: '' };
        if (action.kind === 'get_status') return { online: true, good: true };
        let peerUid = action.target;
        if (action.chatType !== 2) {
          try { peerUid = (await session.getUixConvertService().getUid([action.target]))?.uidInfo?.get(action.target); } catch { peerUid = undefined; }
          if (!/^u_[\w-]+$/.test(peerUid ?? '')) {
            ensure();
            try { peerUid = (await session.getProfileService().getUidByUin('FriendsServiceImpl', [action.target]))?.get(action.target); } catch { peerUid = undefined; }
          }
          if (!/^u_[\w-]+$/.test(peerUid ?? '')) {
            // Non-friends (group members, temp-chat peers) are often only known to the group service.
            ensure();
            try { peerUid = (await session.getGroupService().getUidByUins([action.target]))?.uids?.get(action.target); } catch { peerUid = undefined; }
          }
          if (!/^u_[\w-]+$/.test(peerUid ?? '')) throw fail('无法把目标 QQ 号转换为 UID；未调用发送', 1500);
        }
        ensure();
        const service = session.getMsgService();
        if (action.kind === 'input') {
          const result = await service.sendShowInputStatusReq(1, action.eventType, peerUid);
          ensure();
          if (result?.result !== undefined && result.result !== 0) throw fail('QQ 拒绝输入状态通知: ' + (result.errMsg ?? result.result), 1500);
          return null;
        }
        const time = session.getMSFService().getServerTime();
        if (typeof time !== 'string' || !/^[1-9]\d{0,19}$/.test(time)) throw fail('原生服务器时间无效，未调用发送', 1500);
        tag = service.generateMsgUniqueId(action.chatType, time);
        if (typeof tag !== 'string' || !/^[1-9]\d*$/.test(tag) || waiting.has(tag)) throw fail('原生发送关联标识无效或重复，未调用发送', 1500);
        // QQ preserves the caller's guildId tag on ordinary-chat send updates.
        const peer = { chatType: action.chatType, peerUid, guildId: tag };
        const acknowledged = new Promise(resolve => waiting.set(tag, { peer, resolve }));
        const elements = action.texts.filter(text => text.length).map(content => ({ elementType: 1, elementId: '',
          textElement: { content, atType: 0, atUid: '', atTinyId: '', atNtUid: '' },
        }));
        ensure();
        const result = await service.sendMsg('0', peer, elements, new Map());
        ensure();
        if (result?.result !== 0) throw fail('QQ 未接受发送: ' + (result?.errMsg ?? result?.result ?? '缺少结果'), 1500);
        const record = await acknowledged;
        ensure();
        if (record.sendStatus !== 2) throw fail('QQ 报告发送失败', 1500);
        if (!/^\d+$/.test(String(record.msgId)) || (typeof record.msgId === 'number' && !Number.isSafeInteger(record.msgId))) throw fail('QQ 回执消息 ID 无效，发送结果需在客户端确认', 1500);
        return { self, message: { chatType: peer.chatType, peerUid, msgId: String(record.msgId) } };
      })()]);
    } finally {
      operation.active = false;
      clearTimeout(timer);
      operations.delete(operation);
      if (tag && waiting.has(tag)) { waiting.get(tag).resolve({ sendStatus: 0 }); waiting.delete(tag); }
    }
  }
  function dispose() {
    disposed = true;
    for (const operation of operations) operation.cancel();
  }
  return { execute, observe, dispose };
}

module.exports = { validateAction, createActionHandler };
