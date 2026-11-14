export function segmentText(message) {
  if (typeof message === 'string') return message;
  const labels = { image: '图片', face: '表情', record: '语音', video: '视频', file: '文件', reply: '回复', json: '应用', xml: '卡片', markdown: 'Markdown', mface: '商城表情', forward: '合并转发' };
  const app = raw => { try { const card = typeof raw === 'string' ? JSON.parse(raw) : raw; return String(card?.prompt || card?.app || '').slice(0, 60); } catch { return ''; } };
  return (Array.isArray(message) ? message : []).map(item => item?.type === 'text' ? String(item.data?.text ?? '')
    : item?.type === 'at' ? '@' + String(item.data?.qq ?? '')
    : item?.type === 'json' && app(item.data?.data) ? `[应用 ${app(item.data.data)}]`
    : item?.type === 'forward' && Array.isArray(item.data?.content) ? `[合并转发 ${item.data.content.length} 条]`
    : '[' + (labels[item?.type] || item?.type || '消息') + ']').join('');
}

export function describeEntry(entry) {
  const value = entry.data || {};
  const source = value.group_id ? '群 ' + value.group_id : value.user_id ? 'QQ ' + value.user_id : 'OpenQQ';
  if (entry.kind === 'action') return { kind: 'action', title: String(value.request?.action || '动作'),
    text: value.response?.status === 'ok' ? '执行成功' : String(value.response?.message || '执行失败'), source: 'OneBot', failed: value.response?.status === 'failed' };
  if (entry.kind === 'diagnostic') return { kind: 'diagnostic', title: String(value.type || '运行日志'),
    text: String(value.error || value.event || value.stage || '运行状态更新'), source: String(value.source || 'OpenQQ'), failed: ['event_error', 'hook_error'].includes(value.type) };
  if (value.post_type === 'message') return { kind: 'message', title: String(value.sender?.card || value.sender?.nickname || value.user_id || '消息'), text: segmentText(value.message), source };
  if (value.post_type === 'request') return { kind: 'request', title: value.request_type === 'friend' ? '好友申请' : '群申请', text: String(value.comment || '没有验证留言'), source };
  const names = { group_recall: '群消息撤回', friend_recall: '私聊撤回', group_increase: '成员加入', group_decrease: '成员离开', group_admin: '管理员变更', group_ban: '禁言变更', group_upload: '文件上传', friend_add: '新增好友', group_card: '群名片变更', bot_offline: 'QQ 已掉线' };
  return { kind: 'notice', title: value.sub_type === 'poke' ? '戳一戳' : names[value.notice_type] || String(value.sub_type || value.notice_type || '通知'),
    text: value.sub_type === 'poke' ? value.user_id + ' 戳了戳 ' + value.target_id : String(value.file?.name || value.status_text || value.reason || value.group_name || '查看事件详情'), source };
}

export function identifier(value) {
  const text = String(value ?? '').trim();
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text))) throw new Error('请输入有效的 QQ 号或群号');
  return Number(text);
}

export function messageRequest(values) {
  if (!['private', 'group'].includes(values.targetType)) throw new Error('请选择会话类型');
  const target = identifier(values.target);
  if (typeof values.message !== 'string' || !values.message.length || new TextEncoder().encode(values.message).length > 65536) throw new Error('消息不能为空或超过 64 KiB');
  const group = values.targetType === 'group';
  return { action: group ? 'send_group_msg' : 'send_private_msg', params: { [group ? 'group_id' : 'user_id']: target, message: values.message, auto_escape: true } };
}

export function boundedHistory(entries) {
  const result = []; let bytes = 0;
  for (let i = entries.length - 1; i >= 0 && result.length < 200; i--) {
    const size = new TextEncoder().encode(JSON.stringify(entries[i])).length;
    if (bytes + size > 2 * 1024 * 1024) break;
    bytes += size; result.push(entries[i]);
  }
  return result.reverse();
}
