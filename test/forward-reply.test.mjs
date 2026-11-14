import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import nativeEvents from '../native/events.cjs';
import nativeActions from '../native/actions.cjs';
import { createEventConverter } from '../src/onebot.mjs';
import { dispatchAction } from '../src/actions.mjs';
import { segmentPreview } from '../src/console.mjs';
import { segmentText } from '../ui/format.mjs';

const self = { uin: '123456', uid: 'u_self' };
const text = content => ({ elementType: 1, textElement: { content } });
const forwardElement = () => ({ elementType: 16, multiForwardMsgElement: { resId: 'res', xmlContent: '<msg/>' } });
const group = (overrides = {}) => ({ chatType: 2, msgId: '7001', msgSeq: '55', clientSeq: '9', msgTime: '1794470400',
  peerUid: '987654', peerUin: '987654', senderUid: 'u_actor', senderUin: '654321', sendNickName: 'actor',
  elements: [text('hi')], ...overrides });
const inner = (msgId, elements, senderUin = '456789') => ({ msgId, msgTime: '1794470300', senderUid: senderUin ? 'u_other' : 'u_ghost', senderUin,
  sendNickName: 'other', elements });

function harness(sessionOverrides = {}) {
  const raw = [];
  const calls = [];
  const sends = [];
  const session = {
    getUixConvertService: () => ({ getUin: async () => ({ uinInfo: new Map() }) }),
    getMsgService: () => ({
      async getMultiMsg(peer, root, parent) {
        calls.push([peer.chatType, peer.peerUid, root, parent]);
        if (parent === '7001') return { result: 0, msgList: [inner('8001', [text('first')]), inner('8002', [forwardElement()])] };
        if (parent === '8002') return { result: 0, msgList: [inner('9001', [text('nested')], '')] };
        return { result: 1, errMsg: 'gone' };
      },
      async getMsgsByMsgId() { return { msgList: [] }; },
      generateMsgUniqueId: () => String(9007199254740993n + BigInt(sends.length)),
      async sendMsg(id, peer, elements) { sends.push({ peer, elements }); return { result: 0 }; },
    }),
    getMSFService: () => ({ getServerTime: () => '1794470400' }),
    ...sessionOverrides,
  };
  const receive = nativeEvents.createEventReceiver(session, self, event => raw.push(event), () => true);
  const handler = nativeActions.createActionHandler(session, self, () => true,
    { expandForward: receive.expandForward, lookupRecent: receive.lookupRecent, record: receive.record });
  const convert = createEventConverter();
  const channel = { request: request => handler.execute(request).then(data => ({ status: 'ok', retcode: 0, data }), error => ({ status: 'failed', retcode: error.retcode ?? 1500, data: null, message: error.message })) };
  const ack = () => handler.observe('onMsgInfoListUpdate', [[{ ...sends.at(-1).peer, msgId: '7999', msgSeq: '56', senderUin: self.uin, sendStatus: 2 }]]);
  return { raw, calls, sends, receive, handler, convert, channel, ack };
}

test('merged forwards expand into OneBot nodes, including nested forwards keyed by their root message', async () => {
  const h = harness();
  await h.receive('msg', 'onRecvMsg', [[group({ elements: [forwardElement()] })]]);
  assert.deepEqual(h.calls, [[2, '987654', '7001', '7001'], [2, '987654', '7001', '8002']]);
  const event = h.convert(h.raw.find(item => item.type === 'message'));
  const [segment] = event.message;
  assert.equal(segment.type, 'forward');
  assert.equal(event.raw_message, `[CQ:forward,id=${segment.data.id}]`);
  assert.deepEqual(segment.data.content.map(node => [node.user_id, node.sender.nickname, node.message[0].type]),
    [[456789, 'other', 'text'], [456789, 'other', 'forward']]);
  const nested = segment.data.content[1].message[0].data.content;
  assert.equal(nested[0].message[0].data.text, 'nested');
  assert.equal(nested[0].user_id, 0, 'an unresolved forwarded author keeps its nickname with user_id 0');
  assert.match(segmentPreview(segment), /合并转发 #\d+ · 2 条/);
  assert.equal(segmentText(event.message), '[合并转发 2 条]');

  const fetched = await dispatchAction(h.channel, h.convert, { action: 'get_forward_msg', params: { id: segment.data.id }, echo: 1 });
  assert.equal(fetched.status, 'ok');
  assert.equal(fetched.echo, 1);
  assert.deepEqual(fetched.data.messages.map(node => node.content[0].type), ['text', 'forward']);
  // The id of the carrying message is accepted too, as NapCat does.
  const byMessage = await dispatchAction(h.channel, h.convert, { action: 'get_forward_msg', params: { message_id: event.message_id } });
  assert.equal(byMessage.data.messages.length, 2);
  const unknown = await dispatchAction(h.channel, h.convert, { action: 'get_forward_msg', params: { id: 99999 } });
  assert.equal(unknown.retcode, 1404);
});

test('a failed forward fetch still delivers the message with a forward id and a diagnostic', async () => {
  const h = harness();
  await h.receive('msg', 'onRecvMsg', [[group({ msgId: '7002', elements: [text('see: '), forwardElement()] })]]);
  const event = h.convert(h.raw.find(item => item.type === 'message'));
  assert.deepEqual(event.message.map(segment => segment.type), ['text', 'forward']);
  assert.equal(event.message[1].data.content, undefined);
  assert.match(h.raw.find(item => item.type === 'event_error').error, /gone.*get_forward_msg/);
});

test('reply segments quote a received message in the same chat and are refused otherwise', async () => {
  const h = harness();
  await h.receive('msg', 'onRecvMsg', [[group()]]);
  const event = h.convert(h.raw.find(item => item.type === 'message'));
  const pending = dispatchAction(h.channel, h.convert, { action: 'send_group_msg', params: { group_id: 987654,
    message: [{ type: 'reply', data: { id: String(event.message_id) } }, { type: 'text', data: { text: 'pong' } }] } });
  await setImmediate();
  const [quote, body] = h.sends[0].elements;
  assert.deepEqual(quote, { elementType: 7, elementId: '', replyElement: { replayMsgSeq: '55', replayMsgId: '7001',
    senderUin: '654321', senderUinStr: '654321', replyMsgClientSeq: '9' } });
  assert.equal(body.textElement.content, 'pong');
  h.ack();
  const sent = await pending;
  assert.equal(sent.status, 'ok');
  // Our own sent message can be quoted afterwards without a native lookup.
  const again = dispatchAction(h.channel, h.convert, { action: 'send_group_msg', params: { group_id: 987654,
    message: [{ type: 'reply', data: { id: sent.data.message_id } }, { type: 'text', data: { text: 'again' } }] } });
  await setImmediate();
  assert.equal(h.sends[1].elements[0].replyElement.replayMsgSeq, '56');
  h.ack();
  assert.equal((await again).status, 'ok');

  const count = h.sends.length;
  const missing = await dispatchAction(h.channel, h.convert, { action: 'send_group_msg', params: { group_id: 987654,
    message: [{ type: 'reply', data: { id: 424242 } }, { type: 'text', data: { text: 'x' } }] } });
  assert.equal(missing.retcode, 1404);
  const elsewhere = await dispatchAction(h.channel, h.convert, { action: 'send_group_msg', params: { group_id: 111111,
    message: [{ type: 'reply', data: { id: event.message_id } }, { type: 'text', data: { text: 'x' } }] } });
  assert.match(elsewhere.message, /同一会话/);
  assert.equal(h.sends.length, count, 'refused replies never reach sendMsg');
});

test('ark app messages convert to json segments with a readable preview and can be sent on their own', async () => {
  const h = harness();
  const card = JSON.stringify({ app: 'com.tencent.miniapp', prompt: '[QQ小程序]哔哩哔哩', meta: {} });
  await h.receive('msg', 'onRecvMsg', [[group({ msgId: '7003', elements: [{ elementType: 10, arkElement: { bytesData: card } }] })]]);
  const event = h.convert(h.raw.find(item => item.type === 'message'));
  assert.deepEqual(event.message[0], { type: 'json', data: { data: card } });
  assert.equal(segmentPreview(event.message[0]), '[应用 [QQ小程序]哔哩哔哩]');
  assert.equal(segmentText(event.message), '[应用 [QQ小程序]哔哩哔哩]');

  const pending = dispatchAction(h.channel, h.convert, { action: 'send_group_msg', params: { group_id: 987654, message: [{ type: 'json', data: { data: JSON.parse(card) } }] } });
  await setImmediate();
  assert.deepEqual(h.sends[0].elements, [{ elementType: 10, elementId: '', arkElement: { bytesData: card, linkInfo: null, subElementType: null } }]);
  h.ack();
  assert.equal((await pending).status, 'ok');
  for (const message of [[{ type: 'json', data: { data: card } }, { type: 'text', data: { text: 'x' } }], [{ type: 'json', data: { data: 'not json' } }]]) {
    const refused = await dispatchAction(h.channel, h.convert, { action: 'send_group_msg', params: { group_id: 987654, message } });
    assert.equal(refused.status, 'failed');
  }
  assert.equal(h.sends.length, 1);
});
