import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import sessionModule from '../native/session.cjs';
import { createMessageConverter } from '../src/onebot.mjs';

const self = { uin: '123456', uid: 'u_self' };
const poke = (chatType = 2, users = ['u_actor', 'u_self']) => ({
  chatType, msgId: '9007199254740993', msgTime: '1794470400', senderUin: '0', senderUid: '',
  peerUid: chatType === 2 ? '987654' : 'u_actor', peerUin: chatType === 2 ? '987654' : '654321',
  elements: [{ elementType: 8, grayTipElement: { jsonGrayTipElement: {
    busiId: '1061', jsonStr: JSON.stringify({ items: [{ txt: '任意自定义文案' }, ...users.map(uid => ({ uid }))] }),
  } } }],
});
const enriched = (chatType = 2) => ({ ...poke(chatType), poke: { userUin: '654321', targetUin: self.uin } });

async function fixture(t, services = {}) {
  const events = [];
  let listener;
  const service = { addKernelMsgListener(value) { listener = value; return 1; }, removeKernelMsgListener() {} };
  const session = { init(_config, _a, _b, callbacks) { callbacks.onSessionInitComplete({ result: 0 }); },
    getMsgService: () => service, ...services };
  const hook = sessionModule.createSessionHook(event => events.push(event));
  t.after(() => hook.dispose());
  const wrapper = hook.hookWrapper({ NodeIQQNTWrapperSession: { get: () => session } });
  const init = () => wrapper.NodeIQQNTWrapperSession.get().init({ selfUin: self.uin, selfUid: self.uid }, {}, {}, {});
  init();
  await setImmediate();
  return { events, init, hook, listener: () => listener };
}

test('converts group/private pokes before sender validation, deduplicates and retains self-initiated pokes', () => {
  const convert = createMessageConverter();
  assert.deepEqual(convert(self, enriched()), {
    time: 1794470400, self_id: 123456, post_type: 'notice', notice_type: 'notify', sub_type: 'poke',
    user_id: 654321, target_id: 123456, group_id: 987654,
  });
  assert.equal(convert(self, enriched()), null);
  const privatePoke = convert(self, { ...enriched(1), poke: { userUin: self.uin, targetUin: '654321' } });
  assert.equal(privatePoke.user_id, 123456);
  assert.equal(privatePoke.target_id, 654321);
  assert.equal('group_id' in privatePoke, false);
  assert.equal('message_id' in privatePoke, false);
  const text = convert(self, { ...poke(), msgId: '9007199254740994', senderUin: '654321',
    elements: [{ elementType: 1, textElement: { content: '戳一戳' } }] });
  assert.equal(text.post_type, 'message');
  assert.equal(text.message_id, 1);
});

test('rejects unresolved or malformed notices without poisoning deduplication', () => {
  const convert = createMessageConverter();
  assert.throws(() => convert(self, poke()), /灰条通知/);
  assert.throws(() => convert(self, { ...enriched(), poke: { userUin: '654321', targetUin: 'u_self' } }), /target_id/);
  assert.throws(() => convert(self, { ...enriched(), elements: [{ elementType: 1, textElement: { content: 'fake' } }] }), /灰条标识/);
  assert.equal(convert(self, enriched()).sub_type, 'poke');
});

test('resolves group participants through native UID conversion and preserves actor/target order', async t => {
  const f = await fixture(t, { getUixConvertService() { return { async getUin(uids) {
    assert.equal(uids.length, 1);
    assert.ok(['u_actor', 'u_target'].includes(uids[0]));
    return { uinInfo: new Map([['u_actor', '654321'], ['u_target', '456789']]) };
  } }; } });
  f.listener().onRecvMsg([poke(2, ['u_actor', 'u_target'])]);
  await setImmediate();
  const raw = f.events.at(-1);
  assert.equal(raw.type, 'message');
  const event = createMessageConverter()(raw.self, raw.message);
  assert.equal(event.user_id, 654321);
  assert.equal(event.target_id, 456789);
  assert.equal(event.group_id, 987654);
});

test('private pokes use known peer and self identifiers without calling conversion services', async t => {
  const f = await fixture(t);
  f.listener().onRecvMsg([poke(1)]);
  await setImmediate();
  const raw = f.events.at(-1);
  assert.equal(raw.type, 'message');
  assert.deepEqual(raw.message.poke, { userUin: '654321', targetUin: self.uin });
});

test('falls back to profile conversion when the primary service has no mapping', async t => {
  const f = await fixture(t, {
    getUixConvertService: () => ({ getUin: async () => ({ uinInfo: new Map() }) }),
    getProfileService: () => ({ getUinByUid(store, uids) {
      assert.equal(store, 'FriendsServiceImpl');
      assert.deepEqual(uids, ['u_actor']);
      return new Map([['u_actor', '654321']]);
    } }),
  });
  f.listener().onRecvMsg([poke()]);
  await setImmediate();
  assert.equal(f.events.at(-1).message.poke.userUin, '654321');
});

test('bad poke data and unresolved UIDs produce event errors while later messages still work', async t => {
  const f = await fixture(t, { getProfileService: () => ({ getUinByUid: () => new Map([['u_actor', '0']]) }) });
  const invalidJson = poke();
  invalidJson.elements[0].grayTipElement.jsonGrayTipElement.jsonStr = '{private-body';
  const missingTarget = poke(1, ['u_actor']);
  assert.doesNotThrow(() => f.listener().onRecvMsg([invalidJson, missingTarget, poke(2, ['u_unknown', 'u_self']), poke(1)]));
  await setImmediate();
  assert.equal(f.events.filter(event => event.type === 'event_error').length, 3);
  assert.equal(JSON.stringify(f.events).includes('private-body'), false);
  assert.equal(f.events.filter(event => event.type === 'message').length, 1);
});

test('lookup timeout neither blocks text delivery nor starts a late profile fallback', async t => {
  let resolve;
  const f = await fixture(t, {
    getUixConvertService: () => ({ getUin: () => new Promise(done => { resolve = done; }) }),
    getProfileService() { assert.fail('late fallback'); },
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  f.listener().onRecvMsg([poke(), { chatType: 1, senderUin: '456789', elements: [{ elementType: 1, textElement: { content: 'hi' } }], marker: 'later message' }]);
  await setImmediate();
  assert.equal(f.events.at(-1).message.marker, 'later message');
  t.mock.timers.tick(5000);
  await setImmediate();
  assert.match(f.events.at(-1).error, /超时/);
  const count = f.events.length;
  resolve({ uinInfo: new Map() });
  await setImmediate();
  assert.equal(f.events.length, count);
});

test('late lookup results and old callbacks cannot emit after account reinitialization or disposal', async t => {
  const pending = [];
  const f = await fixture(t, { getUixConvertService: () => ({ getUin: () => new Promise(resolve => pending.push(resolve)) }) });
  const oldListener = f.listener();
  oldListener.onRecvMsg([poke()]);
  f.init();
  await setImmediate();
  f.listener().onRecvMsg([poke()]);
  f.hook.dispose();
  oldListener.onRecvMsg([poke(1)]);
  const count = f.events.length;
  for (const resolve of pending) resolve({ uinInfo: new Map([['u_actor', '654321']]) });
  await setImmediate();
  assert.equal(f.events.length, count);
});
