import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runHat, BotRunError, defaultBudget } from '../src/bot/interpreter.mjs';
import { normalizeEvent, matchTrigger } from '../src/bot/trigger.mjs';
import { compileProgram } from '../src/bot/compile.mjs';
import { b, text, info, stack, program, hatOf, event, onebotEvent, mention, fakeServices } from './bot-support.mjs';

const num = value => b('oq_number', { NUM: value });
const reply = (value, fields = {}) => b('oq_reply', { AT: false, QUOTE: false, ...fields }, { TEXT: value });
const run = (hat, { ev = event(), args = '', budget, ...overrides } = {}) => {
  const fake = fakeServices(overrides);
  return runHat(hat, { event: ev, args, services: fake.services, budget }).then(result => ({ result, ...fake }));
};
const texts = sent => sent.map(item => item.segments.filter(segment => segment.type === 'text').map(segment => segment.data.text).join(''));

test('trigger events are normalized and matched: scope, mention, keyword alternatives, commands', () => {
  const group = normalizeEvent(mention('今天天气怎么样'));
  assert.deepEqual({ chat: group.chat, key: group.chatKey, text: group.text, at: group.atSelf, nick: group.nickname }, { chat: { type: 'group', id: 30001 }, key: 'g:30001', text: '今天天气怎么样', at: true, nick: '小明' });
  assert.equal(normalizeEvent({ post_type: 'notice' }), null);
  assert.equal(normalizeEvent(onebotEvent({ user_id: 10000 })), null, '自己发的消息不处理');
  assert.equal(normalizeEvent(onebotEvent({ message: 'plain text' })).text, 'plain text');
  const hatFor = (type, fields) => ({ type, fields, body: [] });
  const priv = normalizeEvent(onebotEvent({ message_type: 'private', group_id: undefined }));
  assert.equal(priv.chatKey, 'p:20001');
  assert.ok(matchTrigger(hatFor('oq_on_message', { SCOPE: 'private' }), priv));
  assert.equal(matchTrigger(hatFor('oq_on_message', { SCOPE: 'group' }), priv), null);
  assert.ok(matchTrigger(hatFor('oq_on_mention', {}), group));
  assert.equal(matchTrigger(hatFor('oq_on_mention', {}), priv), null);
  const keyword = (mode, words) => matchTrigger(hatFor('oq_on_keyword', { SCOPE: 'any', MODE: mode, TEXT: words }), normalizeEvent(onebotEvent({ message: [{ type: 'text', data: { text: 'Hello World' } }] })));
  assert.ok(keyword('contains', '你好|WORLD'));
  assert.ok(keyword('equals', 'hello world'));
  assert.equal(keyword('equals', 'hello'), null);
  assert.ok(keyword('starts', 'hel'));
  assert.equal(keyword('contains', ' | '), null, '空关键词不匹配任何消息');
  const command = (name, message) => matchTrigger(hatFor('oq_on_command', { SCOPE: 'any', NAME: name }), normalizeEvent(mention(message)));
  assert.deepEqual(command('/ask', '/ask  天气 如何 '), { args: '天气 如何' });
  assert.deepEqual(command('/ASK', '/ask'), { args: '' });
  assert.equal(command('/ask', '/asking'), null);
  assert.equal(command('/ask', '问 /ask'), null);
});

test('replies, conditions, text and math blocks run against the event', async () => {
  const hat = hatOf(stack(0, 0, b('oq_on_mention'),
    b('oq_if_else', {}, { COND: b('oq_compare', { OP: 'gt' }, { A: num(2), B: num(10) }) },
      undefined),
    reply(b('oq_join', {}, { A: text('你好，'), B: info('sender_name') }), { AT: true, QUOTE: true }),
    reply(b('oq_arith', { OP: 'add' }, { A: text('2'), B: num(3) })),
    reply(b('oq_text_replace', {}, { TEXT: text('a-b-c'), FROM: text('-'), TO: text('$&') })),
    reply(b('oq_text_sub', {}, { TEXT: text('abcdef'), FROM: num(2), TO: num(4) })),
    reply(b('oq_arith', { OP: 'div' }, { A: num(1), B: num(0) })),
    reply(b('oq_random', {}, { FROM: num(1), TO: num(6) })),
    reply(b('oq_random_pick', { TEXT: '甲|乙|丙' })),
  ));
  const { sent, result } = await run(hat, { ev: event({ ...mention('hi') }), budget: { messages: 20 } });
  assert.equal(result.messages, 7);
  assert.deepEqual(sent[0].segments, [{ type: 'reply', data: { id: '7' } }, { type: 'at', data: { qq: '20001' } }, { type: 'text', data: { text: ' 你好，小明' } }]);
  assert.deepEqual(texts(sent).slice(1), ['5', 'a$&b$&c', 'bcd', '0', '4', '乙']);
  assert.deepEqual(sent[0].target, { type: 'group', id: 30001 });
});

test('conditions short-circuit, compare numerically or by text, and honor the else branch', async () => {
  const hat = hatOf(stack(0, 0, b('oq_on_message'),
    b('oq_if_else', {}, { COND: b('oq_logic', { OP: 'and' }, { A: b('oq_bool', { BOOL: 'false' }), B: b('oq_compare', { OP: 'eq' }, { A: b('oq_ai_ask', { REMEMBER: false }, { PROMPT: text('x') }), B: text('x') }) }) }),
    reply(b('oq_not', {}, { A: b('oq_bool', { BOOL: 'false' }) })),
  ));
  // 手工往两个分支里各放一条回复（builder 只管 next 链，不管语句输入口）。
  const say = value => [{ type: 'oq_reply', fields: { AT: false, QUOTE: false }, inputs: { TEXT: { type: 'oq_text', fields: { TEXT: value }, inputs: {} } } }];
  hat.body[0].inputs.THEN = say('那么');
  hat.body[0].inputs.ELSE = say('否则');
  let asks = 0;
  const { sent } = await run(hat, { ai: { ask: async () => { asks++; return 'x'; } } });
  assert.deepEqual(texts(sent), ['否则', 'true']);
  assert.equal(asks, 0, 'and 左边为假时不再计算右边（没有调用 AI）');
  const compare = async (a, op, c) => (await run(hatOf(stack(0, 0, b('oq_on_message'), reply(b('oq_compare', { OP: op }, { A: text(a), B: text(c) })))))).sent[0].segments[0].data.text;
  assert.equal(await compare('10', 'gt', '9'), 'true', '两边是数字按数字比较');
  assert.equal(await compare('10', 'lt', '9a'), 'true', '有一边不是数字就按文字比较');
  assert.equal(await compare('abc', 'neq', 'abd'), 'true');
  assert.equal(await compare('1.0', 'eq', '1'), 'true');
});

test('variables are per run; repeat is capped; while with an endless condition is stopped', async () => {
  const state = program(stack(0, 0, b('oq_on_message'),
    b('oq_var_set', { VAR: { id: 'n' } }, { VALUE: num(0) }),
    b('oq_repeat', {}, { TIMES: num(500) }),
    reply(b('oq_var_get', { VAR: { id: 'n' } })),
  ));
  state.blocks.blocks[0].next.block.next.block.inputs.DO = { block: { type: 'oq_var_change', fields: { VAR: { id: 'n' } }, inputs: { DELTA: { block: { type: 'oq_number', fields: { NUM: 1 } } } } } };
  state.variables = [{ id: 'n', name: '计数' }];
  const hat = compileProgram(state).hats[0];
  const { sent } = await run(hat);
  assert.deepEqual(texts(sent), ['100'], 'repeat 次数上限是 100');
  assert.deepEqual(texts((await run(hat)).sent), ['100'], '每次运行从空开始');

  const forever = program(stack(0, 0, b('oq_on_message'), b('oq_while', {}, { COND: b('oq_bool', { BOOL: 'true' }) }), reply(text('不应到达'))));
  const loopHat = compileProgram(forever).hats[0];
  await assert.rejects(run(loopHat), error => error instanceof BotRunError && error.code === 'loop');
});

test('the step budget stops nested loops and the clock budget stops slow runs', async () => {
  const inner = b('oq_repeat', {}, { TIMES: num(100) });
  const state = program(stack(0, 0, b('oq_on_message'), b('oq_repeat', {}, { TIMES: num(100) })));
  const nested = state.blocks.blocks[0].next.block;
  nested.inputs.DO = { block: { ...inner, inputs: { ...inner.inputs, DO: { block: { type: 'oq_reply', fields: { AT: false, QUOTE: false }, inputs: { TEXT: { block: { type: 'oq_text', fields: { TEXT: 'x' } } } } } } } } };
  const hat = compileProgram(state).hats[0];
  await assert.rejects(run(hat, { budget: { messages: 1_000_000 } }), error => error.code === 'steps' && /死循环/.test(error.message));

  const slow = hatOf(stack(0, 0, b('oq_on_message'), reply(text('a')), reply(text('b'))));
  const fake = fakeServices();
  fake.services.send = async () => { fake.clock.time += 70_000; };
  await assert.rejects(runHat(slow, { event: event(), services: fake.services }), error => error.code === 'time');
});

test('message count and text size are bounded', async () => {
  const chatty = hatOf(stack(0, 0, b('oq_on_message'), ...Array.from({ length: 6 }, () => reply(text('x')))));
  const fake = fakeServices();
  await assert.rejects(runHat(chatty, { event: event(), services: fake.services }), error => error.code === 'messages');
  assert.equal(fake.sent.length, defaultBudget.messages, '超限前发出的消息保持原样，超限的那条没有发');

  let blown = text('字'.repeat(1900));
  for (let index = 0; index < 4; index++) blown = b('oq_join', {}, { A: blown, B: blown });
  await assert.rejects(run(hatOf(stack(0, 0, b('oq_on_message'), reply(blown)))), error => error.code === 'text');
  const replaceBomb = b('oq_text_replace', {}, { TEXT: text('a'.repeat(1900)), FROM: text('a'), TO: text('b'.repeat(1900)) });
  await assert.rejects(run(hatOf(stack(0, 0, b('oq_on_message'), reply(replaceBomb)))), error => error.code === 'text');
  const long = (await run(hatOf(stack(0, 0, b('oq_on_message'), reply(b('oq_join', {}, { A: text('字'.repeat(1900)), B: b('oq_join', {}, { A: text('字'.repeat(1900)), B: text('字'.repeat(1900)) }) })))))).sent;
  assert.equal(long[0].segments[0].data.text.length, 4000, '单条消息按 4000 字截断');
});

test('media blocks accept only network and base64 sources, never local paths', async () => {
  const media = source => hatOf(stack(0, 0, b('oq_on_message'), b('oq_send_media', { TYPE: 'image' }, { SRC: source })));
  const { sent } = await run(media(text('https://example.com/a.png')));
  assert.deepEqual(sent[0].segments, [{ type: 'image', data: { file: 'https://example.com/a.png' } }]);
  for (const bad of ['C:\\Users\\me\\secret.png', '/etc/passwd', 'file:///etc/passwd', '\\\\server\\share\\a.png', 'data:image/png;base64,AAAA', '..\\..\\config\\openqq.json']) {
    await assert.rejects(run(media(text(bad))), error => error.code === 'invalid' && /本机路径/.test(error.message), bad);
  }
  // 来源来自聊天内容（比如用户说「发图 /etc/passwd」）时同样被拒绝。
  await assert.rejects(run(media(info('text')), { ev: event({ message: [{ type: 'text', data: { text: '/etc/passwd' } }] }) }), BotRunError);
});

test('send-to, face and fun blocks validate their targets', async () => {
  const hat = hatOf(stack(0, 0, b('oq_on_message'),
    b('oq_send_to', { TARGET: 'private' }, { ID: text('12345'), TEXT: text('私信') }),
    b('oq_send_to', { TARGET: 'group' }, { ID: num(777), TEXT: text('群发') }),
    b('oq_send_fun', { TYPE: 'dice' }),
    b('oq_send_face', {}, { ID: num(14) }),
    b('oq_reply', {}, { TEXT: text('') }),
  ));
  const { sent } = await run(hat);
  assert.deepEqual(sent.map(item => item.target), [{ type: 'private', id: 12345 }, { type: 'group', id: 777 }, { type: 'group', id: 30001 }, { type: 'group', id: 30001 }]);
  assert.deepEqual(sent[2].segments, [{ type: 'dice', data: {} }]);
  assert.deepEqual(sent[3].segments, [{ type: 'face', data: { id: '14' } }]);
  await assert.rejects(run(hatOf(stack(0, 0, b('oq_on_message'), b('oq_send_to', { TARGET: 'group' }, { ID: text('abc'), TEXT: text('x') })))), error => error.code === 'invalid');
  await assert.rejects(run(hatOf(stack(0, 0, b('oq_on_message'), b('oq_send_face', {}, { ID: num(-1) })))), error => error.code === 'invalid');
});

test('AI blocks pass prompts through services, send the answer untouched, and skip empty prompts', async () => {
  const asked = [];
  const hat = hatOf(stack(0, 0, b('oq_on_mention'),
    b('oq_ai_reply', { REMEMBER: true, QUOTE: false }, { PROMPT: info('text') }),
    reply(b('oq_ai_ask', { REMEMBER: false }, { PROMPT: text('再问一个') })),
    b('oq_ai_reply', {}, { PROMPT: text('   ') }),
  ));
  const { sent } = await run(hat, {
    ev: normalizeEvent(mention('今天吃什么')),
    ai: { ask: async request => { asked.push(request); return '答：' + request.prompt; } },
  });
  assert.deepEqual(asked.map(item => [item.prompt, item.remember]), [['今天吃什么', true], ['再问一个', false]]);
  assert.ok(asked.every(item => item.timeout > 0 && item.timeout <= defaultBudget.millis));
  assert.deepEqual(texts(sent), ['答：今天吃什么', '答：再问一个'], '回答原样发出，空提示不调用 AI');
  // AI 失败时运行中止，不发送半截消息。
  const failing = await run(hat, { ev: normalizeEvent(mention('x')), ai: { ask: async () => { throw new BotRunError('ai', 'AI 接口返回 HTTP 500'); } } }).catch(error => error);
  assert.equal(failing.code, 'ai');
  // 过长的回答只按单条消息上限截断，不会被附加任何内容。
  const long = await run(hat, { ev: normalizeEvent(mention('长')), ai: { ask: async () => '字'.repeat(6000) } });
  assert.equal(long.sent[0].segments.at(-1).data.text.length, 4000);
});

test('memory blocks read and write notes in the chosen scope and can clear the chat', async () => {
  const hat = hatOf(stack(0, 0, b('oq_on_command', { SCOPE: 'any', NAME: '/记住' }),
    b('oq_mem_set', { SCOPE: 'chat' }, { KEY: text('名字'), VALUE: info('args') }),
    b('oq_mem_set', { SCOPE: 'bot' }, { KEY: text('口头禅'), VALUE: text('哇') }),
    reply(b('oq_join', {}, { A: b('oq_mem_get', { SCOPE: 'chat' }, { KEY: text('名字') }), B: b('oq_mem_get', { SCOPE: 'bot' }, { KEY: text('口头禅') }) })),
    b('oq_mem_forget', { SCOPE: 'bot' }, { KEY: text('口头禅') }),
    b('oq_mem_clear_chat'),
    reply(b('oq_mem_get', { SCOPE: 'chat' }, { KEY: text('名字') })),
    reply(b('oq_mem_get', { SCOPE: 'bot' }, { KEY: text('口头禅') })),
  ));
  const { sent } = await run(hat, { args: '小明' });
  assert.deepEqual(texts(sent), ['小明哇']);
  await assert.rejects(run(hatOf(stack(0, 0, b('oq_on_message'), b('oq_mem_set', { SCOPE: 'chat' }, { KEY: text(''), VALUE: text('x') })))), error => error.code === 'invalid');
});

test('stop ends the stack and time blocks read the injected clock', async () => {
  const hat = hatOf(stack(0, 0, b('oq_on_message'),
    reply(b('oq_time', { PART: 'clock' })), reply(b('oq_time', { PART: 'weekday' })), b('oq_stop'), reply(text('不应到达'))));
  const fake = fakeServices();
  fake.clock.time = new Date(2026, 0, 4, 9, 5).getTime(); // 2026-01-04 是周日
  const result = await runHat(hat, { event: event(), services: fake.services });
  assert.deepEqual(texts(fake.sent), ['09:05', '7']);
  assert.equal(result.stopped, true);
});
