'use strict';

const { readSystemEvent } = require('./system.cjs');
const validUin = value => /^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value));
const now = () => Math.floor(Date.now() / 1000);

function createEventReceiver(session, self, report, current) {
  const cache = new Map();
  const seenShapes = new Set();
  const members = new Map();
  const started = now();
  let friends;
  let syncing = true;
  const remember = (uid, uin) => {
    if (uid && validUin(uin)) cache.set(uid, String(uin));
    if (cache.size > 10000) cache.delete(cache.keys().next().value);
  };
  remember(self.uid, self.uin);

  const inflight = new Map();
  async function uin(uid, hint) {
    if (!current()) throw new Error('会话已失效');
    if (validUin(hint)) { remember(uid, hint); return String(hint); }
    if (validUin(uid)) return String(uid);
    if (typeof uid !== 'string' || !uid) throw new Error('事件缺少用户 UID');
    if (cache.has(uid)) return cache.get(uid);
    // NT UIDs are always "u_"-prefixed; anything else (e.g. the "0" placeholder) can never convert,
    // so fail fast instead of spending the 5-second lookup budget.
    if (!/^u_[\w-]+$/.test(uid)) throw new Error(`UID 格式无效：${uid.slice(0, 40)}`);
    // Bursts (a message with several @, a member leaving several groups) share one native lookup.
    if (inflight.has(uid)) return inflight.get(uid);
    const pending = lookup(uid).finally(() => inflight.delete(uid));
    inflight.set(uid, pending);
    return pending;
  }
  // Optional identities (operators, @ targets) degrade instead of discarding the whole event.
  async function optionalUin(uid, stage, hint) {
    try { return await uin(uid, hint); }
    catch (error) {
      if (!current()) throw error;
      emit({ type: 'event_error', stage, error: error.message + '，已按未知处理并继续上报' });
      return undefined;
    }
  }

  async function lookup(uid) {
    let timer;
    let finished = false;
    // Same fallback order as mature NTQQ bridges: strangers and members who just left a group
    // are often missing from the friend/profile store but still known to the group service.
    const lookups = [
      async () => (await session.getUixConvertService().getUin([uid]))?.uinInfo?.get(uid),
      async () => (await session.getProfileService().getUinByUid('FriendsServiceImpl', [uid]))?.get(uid),
      async () => (await session.getGroupService().getUinByUids([uid]))?.uins?.get(uid),
    ];
    const timeout = Symbol('timeout');
    let result;
    try {
      result = await Promise.race([
        (async () => {
          for (const lookup of lookups) {
            if (!current() || finished) return undefined;
            let value;
            try { value = await lookup(); } catch {}
            if (validUin(value)) return value;
          }
          return undefined;
        })(),
        new Promise(resolve => { timer = setTimeout(() => resolve(timeout), 5000); }),
      ]);
    } finally { finished = true; clearTimeout(timer); }
    if (result === timeout) throw new Error(`UID ${uid} 转 QQ 号超时（5 秒）`);
    if (!validUin(result)) throw new Error(`UID ${uid} 未能转换为 QQ 号（UixConvert/Profile/Group 均无映射）`);
    remember(uid, result);
    return String(result);
  }

  function emit(event) { if (current()) report(event); }
  function notice(event, key, time = now(), message) {
    emit({ type: 'notice', self, event, key, time, message });
  }
  async function batch(values, action, stage) {
    if (!Array.isArray(values)) throw new Error('事件列表必须为数组');
    await Promise.all(values.map(value => Promise.resolve().then(() => current() ? action(value) : undefined).catch(error => {
      emit({ type: 'event_error', stage, error: error.message });
    })));
  }
  function native(source, name, args) {
    // Unknown callbacks report structure once, never opaque network buffers or credentials.
    const key = `${source}/${name}`;
    if (seenShapes.has(key)) return;
    if (seenShapes.size >= 500) seenShapes.delete(seenShapes.values().next().value);
    seenShapes.add(key);
    const shape = value => value === null ? 'null' : Array.isArray(value) ? `array(${value.length})`
      : value instanceof Map ? `map(${value.size})` : typeof value === 'object' ? Object.keys(value).slice(0, 50) : typeof value;
    emit({ type: 'native_callback', source, event: name, argument_shapes: args.map(shape) });
  }

  async function message(input, update = false) {
    if (![1, 2, 100].includes(input.chatType)) { native('msg', 'unsupported_chat', [input]); return; }
    remember(input.senderUid, input.senderUin);
    if (input.chatType !== 2) remember(input.peerUid, input.peerUin);
    const gray = input.elements?.find(element => element.elementType === 8)?.grayTipElement;
    const key = `${input.chatType}:${input.peerUid}:${input.msgId}`;
    const time = input.recallTime && Number(input.recallTime) > 0
      ? Math.floor(Number(input.recallTime) / (Number(input.recallTime) > 1e11 ? 1000 : 1)) : input.msgTime;
    if (gray?.revokeElement) {
      if (update && (!Number(input.recallTime) || Number(time) < started - 5)) return;
      const user = await uin(input.senderUid, input.senderUin);
      // Only group recalls carry an operator; a friend recall must not fail on an unused lookup.
      const operator = input.chatType === 2 ? await optionalUin(gray.revokeElement.operatorUid, 'msg/recall/operator',
        gray.revokeElement.isSelfOperate ? self.uin : undefined) : undefined;
      notice({ notice_type: input.chatType === 2 ? 'group_recall' : 'friend_recall', user_id: user,
        ...(input.chatType === 2 ? { group_id: input.peerUin ?? input.peerUid, operator_id: operator ?? 0,
          ...(operator ? {} : { openqq_operator_unknown: true }) } : {}),
      }, `recall:${key}`, time, input);
      return;
    }
    if (update) return;
    // Offline sync replays placeholder records with no elements; there is nothing to report.
    // Note each msgType once at debug level (type numbers only, never content) instead of warning per record.
    if (!Array.isArray(input.elements) || !input.elements.length) {
      native('msg', `empty_message(msgType=${Number(input.msgType)},subMsgType=${Number(input.subMsgType)})`, []);
      return;
    }
    if (String(gray?.jsonGrayTipElement?.busiId) === '1061') {
      if (input.elements.length !== 1) throw new Error('戳一戳包含非预期的混合元素');
      let data;
      try { data = JSON.parse(gray.jsonGrayTipElement.jsonStr); } catch { throw new Error('戳一戳 JSON 无效'); }
      const users = Array.isArray(data?.items) ? data.items.filter(item => item?.uid) : [];
      if (users.length !== 2 || users.some(item => typeof item.uid !== 'string')) throw new Error('戳一戳缺少操作者或被戳者 UID');
      const [userUin, targetUin] = await Promise.all(users.map(item => uin(item.uid)));
      emit({ type: 'message', self, message: { ...input, poke: { userUin, targetUin } } });
      return;
    }
    if (input.chatType !== 2 && String(gray?.jsonGrayTipElement?.busiId) === '19324') {
      if (friends) friends.set(input.peerUid, input.peerUin);
      notice({ notice_type: 'friend_add', user_id: await uin(input.peerUid, input.peerUin) }, `friend-add:${key}`, input.msgTime);
      return;
    }
    if (gray?.groupElement && input.chatType === 2) {
      const group = gray.groupElement;
      const group_id = input.peerUin ?? input.peerUid;
      if (group.shutUp) {
        const ban = group.shutUp;
        const duration = Number(ban.duration);
        // user_id 0 means "whole group" in OneBot, so an unresolved member must still fail loudly;
        // only the operator may degrade.
        const operator = await optionalUin(ban.admin?.uid, 'msg/ban/operator');
        notice({ notice_type: 'group_ban', group_id,
          user_id: ban.member?.uid ? await uin(ban.member.uid) : 0,
          operator_id: operator ?? 0, ...(operator ? {} : { openqq_operator_unknown: true }), duration,
          sub_type: duration > 0 ? 'ban' : 'lift_ban',
        }, `ban:${key}`, input.msgTime);
        return;
      }
      if (group.type === 5) {
        notice({ notice_type: 'group_name', group_id, user_id: await uin(group.memberUid), group_name: String(group.groupName ?? '') }, key, input.msgTime);
        return;
      }
      // Membership changes use authoritative system pushes, which include the subtype and operator.
      if (group.type === 1) return;
    }
    if (gray) {
      notice({ notice_type: 'openqq_gray_tip', chat_type: input.chatType, peer_id: input.peerUin ?? input.peerUid,
        element: gray }, `gray:${key}`, input.msgTime);
      return;
    }
    const senderUin = await uin(input.senderUid, input.senderUin);
    const elements = await Promise.all((input.elements ?? []).map(async element => {
      const text = element.textElement;
      if (element.elementType === 1 && Number(text?.atType) === 2 && !validUin(text.atUid)) {
        // An unresolvable @ target keeps the native element (delivered as openqq_element) rather than losing the message.
        const target = await optionalUin(text.atNtUid, 'msg/at');
        return target ? { ...element, textElement: { ...text, atUid: target } } : element;
      }
      return element;
    }));
    emit({ type: 'message', self, message: { ...input, senderUin, elements } });
    if (input.chatType === 2) for (const element of elements) {
      const file = element.fileElement;
      if (element.elementType === 3 && file?.fileUuid) notice({ notice_type: 'group_upload', group_id: input.peerUin ?? input.peerUid,
        user_id: senderUin, file: { id: String(file.fileUuid), name: file.fileName, size: file.fileSize, busid: file.fileBizId ?? 0 },
      }, `upload:${key}:${element.elementId ?? file.fileUuid}`, input.msgTime);
    }
  }

  async function groupNotifies(notifies) {
    await batch(notifies, async item => {
      const group_id = item.group?.groupCode;
      const key = `group-notify:${item.seq}:${item.type}`;
      const rawTime = /^\d+$/.test(String(item.seq)) ? Number(BigInt(item.seq) / 1000000n) : 0;
      const time = rawTime > 0 ? rawTime : now();
      if ([1, 5, 7].includes(item.type) && item.status === 1) {
        emit({ type: 'request', self, key, time, event: { request_type: 'group', group_id,
          sub_type: item.type === 1 ? 'invite' : 'add', user_id: await uin(item.type === 1 ? item.user2?.uid : item.user1?.uid),
          comment: String(item.postscript ?? ''), flag: String(item.seq),
        } });
      } else native('group', 'onGroupNotifiesUpdated', [item]);
    }, 'group/notifies');
  }

  async function receive(source, name, args) {
    if (source === 'msg') {
      if (name === 'onNtMsgSyncStart' || name === 'onNtMsgSyncEnd') {
        syncing = name === 'onNtMsgSyncStart';
        emit({ type: 'sync_state', syncing });
        return;
      }
      if (['onRecvMsg', 'onRecvOnlineFileMsg', 'onMsgInfoListUpdate'].includes(name)) {
        await batch(args[0], value => message(value, name === 'onMsgInfoListUpdate'), name);
        return;
      }
      if (name === 'onRecvSysMsg') {
        const event = readSystemEvent(args[0]);
        if (!event) { native(source, name, args); return; }
        const { user_uid, operator_uid, ...fields } = event.event;
        if (!user_uid && fields.openqq_reason !== 'disband') throw new Error('系统通知缺少成员 UID');
        fields.user_id = await uin(user_uid || self.uid);
        if (operator_uid) {
          // A missing operator mapping must not discard the membership change itself.
          const operator = await optionalUin(operator_uid, `${source}/${name}/operator`);
          fields.operator_id = operator ?? 0;
          if (!operator) fields.openqq_operator_unknown = true;
        } else if (fields.notice_type === 'group_decrease' && fields.sub_type === 'leave') fields.operator_id = fields.user_id;
        if (fields.notice_type === 'group_decrease' && fields.sub_type === 'kick' && fields.user_id === self.uin) fields.sub_type = 'kick_me';
        notice(fields, event.key, event.time);
        return;
      }
      if (name === 'onInputStatusPush') {
        const value = args[0];
        if (!value || typeof value !== 'object') return;
        notice({ notice_type: 'notify', sub_type: 'input_status', user_id: await uin(value.fromUin),
          status_text: String(value.statusText ?? ''), event_type: value.eventType }, undefined);
        return;
      }
      if (name === 'onKickedOffLine') {
        emit({ type: 'offline', self_id: self.uin });
        notice({ notice_type: 'bot_offline', reason: String(args[0]?.tipsDesc ?? '') });
        return;
      }
    }
    if (source === 'group') {
      if (name === 'onGroupNotifiesUpdated') return groupNotifies(args[1]);
      if (name === 'onGroupNotifiesUpdatedV2') return groupNotifies(args[2]);
      if (name === 'onGroupSingleScreenNotifies') return groupNotifies(args[2]);
      if (name === 'onMemberInfoChange') {
        for (const [uid, info] of args[2] instanceof Map ? args[2] : []) {
          remember(uid, info.uin);
          const key = `${args[0]}:${uid}`;
          const previous = members.get(key);
          members.set(key, { cardName: info.cardName, memberSpecialTitle: info.memberSpecialTitle });
          if (members.size > 10000) members.delete(members.keys().next().value);
          if (previous && info.cardName !== undefined && previous.cardName !== undefined && info.cardName !== previous.cardName) {
            notice({ notice_type: 'group_card', group_id: args[0], user_id: await uin(uid, info.uin), card_old: previous.cardName, card_new: info.cardName });
          }
          if (previous && info.memberSpecialTitle !== undefined && previous.memberSpecialTitle !== undefined && info.memberSpecialTitle !== previous.memberSpecialTitle) {
            notice({ notice_type: 'notify', sub_type: 'title', group_id: args[0], user_id: await uin(uid, info.uin), title: info.memberSpecialTitle });
          }
        }
        return;
      }
    }
    if (source === 'buddy') {
      if (name === 'onBuddyReqChange') {
        await batch(args[0]?.buddyReqs, async req => {
          if (req.isInitiator || !req.isUnread || (req.isDecide && req.reqType !== 13)) return;
          emit({ type: 'request', self, time: req.reqTime, key: `friend:${req.friendUid}:${req.reqTime}`, event: {
            request_type: 'friend', user_id: await uin(req.friendUid), comment: String(req.extWords ?? ''), flag: String(req.reqTime),
          } });
        }, 'buddy/requests');
        return;
      }
      if (name === 'onBuddyListChange') {
        if (!Array.isArray(args[0]) || args[0].some(category => !Array.isArray(category.buddyList))) throw new Error('好友列表回调结构未适配');
        const next = new Map();
        for (const category of args[0] ?? []) for (const buddy of category.buddyList ?? []) {
          remember(buddy.uid, buddy.uin);
          next.set(buddy.uid, buddy.uin);
        }
        if (friends && !syncing) {
          for (const [uid, hint] of next) if (!friends.has(uid)) notice({ notice_type: 'friend_add', user_id: await uin(uid, hint) });
          for (const [uid, hint] of friends) if (!next.has(uid)) notice({ notice_type: 'friend_delete', user_id: await uin(uid, hint) });
        }
        // The first complete list establishes a baseline; it is not a wave of new friends.
        friends = next;
        return;
      }
    }
    native(source, name, args);
  }
  return receive;
}

module.exports = { createEventReceiver };
