import { test } from 'node:test';
import assert from 'node:assert/strict';
import sessionModule from '../native/session.cjs';

const tick = () => new Promise(resolve => queueMicrotask(resolve));

function fixture() {
  const events = [];
  const removed = [];
  let listener;
  let originalCalls = 0;
  const originalListener = { marker: 42, onSessionInitComplete() { assert.equal(this.marker, 42); originalCalls++; } };
  const service = {
    addKernelMsgListener(value) { listener = value; return 'listener-id'; },
    removeKernelMsgListener(id) { removed.push(id); },
  };
  const session = {
    init(config, depends, dispatcher, callbacks) {
      assert.equal(config.a2, 'do-not-export');
      callbacks.onSessionInitComplete({ result: 0 });
      return 17;
    },
    getMsgService() { return service; },
  };
  const factory = { getNTWrapperSession() { assert.equal(this, factory); return session; } };
  const originalFactory = factory.getNTWrapperSession;
  const originalInit = session.init;
  const hook = sessionModule.createSessionHook(event => events.push(event));
  const wrapped = hook.hookWrapper({ NodeIQQNTWrapperSession: factory });
  return { events, removed, session, factory: wrapped.NodeIQQNTWrapperSession, nativeFactory: factory, originalFactory, originalInit, hook, originalListener,
    listener: () => listener, originalCalls: () => originalCalls };
}

test('preserves factory result identity and callback this/return, and waits for init completion', async () => {
  const f = fixture();
  const native = f.factory.getNTWrapperSession('account');
  assert.equal(native, f.session);
  assert.equal(f.listener(), undefined);
  assert.equal(native.init({ selfUin: '123456', selfUid: 'u_self', a2: 'do-not-export' }, {}, {}, f.originalListener), 17);
  assert.equal(f.listener(), undefined);
  await tick();
  assert.equal(f.originalCalls(), 1);
  assert.equal(f.events.at(-1).type, 'session_ready');
  const message = { chatType: 1, msgId: '9007199254740993', senderUin: '654321', elements: [{ elementType: 1, textElement: { content: 'hi' } }] };
  f.listener().onRecvMsg([message]);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.events.at(-1), { type: 'message', self: { uin: '123456', uid: 'u_self' }, message });
  assert.equal(JSON.stringify(f.events).includes('do-not-export'), false);
  f.hook.dispose();
  assert.deepEqual(f.removed, ['listener-id']);
  assert.equal(f.nativeFactory.getNTWrapperSession, f.originalFactory);
  assert.equal(f.session.init, f.originalInit);
});

test('does not call native services if the session has not completed initialization', () => {
  const f = fixture();
  f.factory.getNTWrapperSession('account');
  assert.equal(f.listener(), undefined);
  assert.equal(f.events.some(event => event.type === 'session_ready'), false);
  f.hook.dispose();
});

test('unhooks old listeners when a session is reinitialized', async () => {
  const f = fixture();
  const session = f.factory.getNTWrapperSession('account');
  for (const selfUin of ['123456', '654321']) {
    session.init({ selfUin, a2: 'do-not-export' }, {}, {}, f.originalListener);
    await tick();
  }
  assert.deepEqual(f.removed, ['listener-id']);
  assert.equal(f.events.at(-1).self_id, '654321');
  f.hook.dispose();
});

test('wraps non-configurable native factory exports without changing original descriptors', () => {
  const events = [];
  const hook = sessionModule.createSessionHook(event => events.push(event));
  const session = { init() {} };
  const factory = Object.freeze({ getNTWrapperSession() { assert.equal(this, factory); return session; } });
  const original = Object.freeze({ NodeIQQNTWrapperSession: factory, untouched: 'value' });
  const descriptors = Object.getOwnPropertyDescriptors(factory);
  const wrapped = hook.hookWrapper(original);
  assert.notEqual(wrapped, original);
  assert.equal(wrapped.untouched, 'value');
  assert.equal(wrapped.NodeIQQNTWrapperSession.getNTWrapperSession(), session);
  assert.deepEqual(Object.getOwnPropertyDescriptors(factory), descriptors);
  assert.equal(original.NodeIQQNTWrapperSession, factory);
  assert.equal(events.some(event => event.type === 'hook_error'), false);
  assert.equal(events.some(event => event.type === 'wrapper_loaded'), true);
  hook.dispose();
});

test('preserves constructor behavior and native receiver for a read-only static factory', () => {
  const hook = sessionModule.createSessionHook(() => {});
  const session = { init() {} };
  class NativeFactory {}
  Object.defineProperty(NativeFactory, 'getNTWrapperSession', { value() { assert.equal(this, NativeFactory); return session; } });
  const wrapped = hook.hookWrapper(Object.freeze({ NodeIQQNTWrapperSession: NativeFactory }));
  const factory = wrapped.NodeIQQNTWrapperSession;
  assert.equal(typeof factory, 'function');
  assert.equal(new factory() instanceof NativeFactory, true);
  assert.equal(factory.prototype, NativeFactory.prototype);
  assert.equal(factory.getNTWrapperSession(), session);
  hook.dispose();
});

test('inactive factory facades delegate without reinstalling session hooks', () => {
  const f = fixture();
  f.hook.dispose();
  assert.equal(f.factory.getNTWrapperSession(), f.session);
  assert.equal(f.session.init, f.originalInit);
  assert.equal(f.events.some(event => event.type === 'session_captured'), false);
});

test('preserves exceptions from QQ callbacks and prevents observer errors from reaching QQ', async () => {
  const f = fixture();
  const session = f.factory.getNTWrapperSession('account');
  assert.throws(() => session.init({ selfUin: '123456', a2: 'do-not-export' }, {}, {}, {
    onSessionInitComplete() { throw new Error('QQ callback failure'); },
  }), /QQ callback failure/);
  await tick();
  assert.equal(f.events.at(-1).type, 'session_ready');
  f.hook.dispose();
  const hook = sessionModule.createSessionHook(() => { throw new Error('observer'); });
  assert.doesNotThrow(() => hook.hookWrapper({}));
  hook.dispose();
});

test('disposing before the init microtask prevents listener registration', async () => {
  const f = fixture();
  f.factory.getNTWrapperSession('account').init({ selfUin: '123456', a2: 'do-not-export' }, {}, {}, f.originalListener);
  f.hook.dispose();
  await tick();
  assert.equal(f.listener(), undefined);
});

test('does not attach an obsolete account if initialization callbacks arrive in one tick', async () => {
  const f = fixture();
  const session = f.factory.getNTWrapperSession('account');
  session.init({ selfUin: '123456', a2: 'do-not-export' }, {}, {}, f.originalListener);
  session.init({ selfUin: '654321', a2: 'do-not-export' }, {}, {}, f.originalListener);
  await tick();
  assert.deepEqual(f.events.filter(event => event.type === 'session_ready').map(event => event.self_id), ['654321']);
  f.hook.dispose();
});

test('reports failed native initialization without registering a message listener', async () => {
  const events = [];
  const session = { init(_config, _a, _b, listener) { listener.onSessionInitComplete({ result: 5 }); } };
  const factory = { create: () => session };
  const hook = sessionModule.createSessionHook(event => events.push(event));
  const wrapped = hook.hookWrapper({ NodeIQQNTWrapperSession: factory });
  wrapped.NodeIQQNTWrapperSession.create().init({ selfUin: '123456' }, {}, {}, {});
  await tick();
  assert.equal(events.at(-1).stage, 'session_init_result');
  assert.equal(events.some(event => event.type === 'session_ready'), false);
  hook.dispose();
});
