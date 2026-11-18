import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync, statSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBotStore, defaultAiSettings, MAX_BOTS } from '../src/bot/store.mjs';
import { createBotEngine } from '../src/bot/engine.mjs';
import { createAIClient } from '../src/bot/ai.mjs';
import { build } from '../src/bot/templates.mjs';
import { mockAI, mention, onebotEvent } from './bot-support.mjs';

const SECRET = 'sk-engine-SECRET-0987654321';
const { b, text, info, stack, program } = build;

async function setup(t, { aiHandler, start = '2026-01-01T00:00:00Z' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'openqq-bot-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = createBotStore({ dir });
  const ai = await mockAI(t, aiHandler);
  store.writeAi({ ...defaultAiSettings(), baseUrl: ai.baseUrl, apiKey: SECRET, model: 'test-model' });
  const sent = [];
  const logs = [];
  const clock = { time: Date.parse(start) };
  const dispatch = async request => { sent.push(request); return { status: 'ok', retcode: 0, data: { message_id: sent.length } }; };
  const engine = createBotEngine({ store, ai: createAIClient({ settings: () => store.readAi() }), dispatch, now: () => new Date(clock.time), log: entry => logs.push(entry), memoryOptions: { saveDelay: -1 } });
  t.after(() => engine.close());
  const create = (name = '小鱼', patch = {}) => {
    const bot = store.create({ name, template: 'ai-mention' });
    return store.update(bot.id, { enabled: true, limits: { cooldownSeconds: 0 }, ...patch }).bot;
  };
  const replyText = request => request.params.message.filter(segment => segment.type === 'text').map(segment => segment.data.text).join('');
  return { dir, store, ai, engine, sent, logs, clock, create, replyText };
}

test('a bot built from the "mention → AI reply" template answers an @ with the persona and quotes the message', async t => {
  const { engine, store, ai, sent, create } = await setup(t);
  const bot = create('阿鱼', { persona: { name: '阿鱼', systemPrompt: '你是一条毒舌的鱼。', personality: 'sharp' } });
  await engine.handleEvent(mention('今天吃什么', { group_id: 555, message_id: 42 }));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].action, 'send_group_msg');
  assert.equal(sent[0].params.group_id, 555);
  assert.deepEqual(sent[0].params.message[0], { type: 'reply', data: { id: '42' } });
  assert.equal(sent[0].params.message[1].data.text.startsWith('答：小明：今天吃什么'), true);
  const [request] = ai.requests;
  assert.equal(request.body.model, 'test-model');
  assert.equal(request.body.messages[0].role, 'system');
  assert.match(request.body.messages[0].content, /你是一条毒舌的鱼[\s\S]*阿鱼[\s\S]*爱调侃/);
  assert.deepEqual(request.body.messages.at(-1), { role: 'user', content: '小明：今天吃什么' });
  assert.equal(store.get(bot.id).enabled, true);
  // 没有 @ 就不触发；私聊也不触发这个 Bot。
  await engine.handleEvent(onebotEvent({ message: [{ type: 'text', data: { text: '随便聊聊' } }] }));
  await engine.handleEvent(onebotEvent({ message_type: 'private', group_id: undefined }));
  assert.equal(sent.length, 1);
  assert.equal(ai.requests.length, 1);
});

test('memory carries the conversation forward per chat and stays separate between chats', async t => {
  const { engine, store, ai, create } = await setup(t);
  const bot = create();
  const ask = (message, group) => engine.handleEvent(mention(message, { group_id: group }));
  await ask('我叫小明', 1);
  await ask('我叫什么？', 1);
  const second = ai.requests[1].body.messages;
  assert.deepEqual(second.slice(1).map(item => [item.role, item.content]), [
    ['user', '小明：我叫小明'], ['assistant', '答：小明：我叫小明'], ['user', '小明：我叫什么？'],
  ]);
  await ask('另一个群的第一句', 2);
  assert.equal(ai.requests[2].body.messages.length, 2, '别的群看不到这个群的对话');
  assert.equal(engine.memoryOf(bot.id).listChats().length, 2);
  // 关闭记忆后不再记录也不再带入历史。
  engine.memoryOf(bot.id).clear('chats');
  assert.equal(store.update(bot.id, { memory: { enabled: false } }).bot.memory.enabled, false);
  await ask('关了记忆', 1);
  await ask('再问一次', 1);
  assert.equal(ai.requests.at(-1).body.messages.length, 2);
  assert.equal(engine.memoryOf(bot.id).listChats().length, 0);
});

test('two bots keep independent personas and memories even in the same chat', async t => {
  const { engine, store, ai, sent, create } = await setup(t);
  const fish = create('小鱼', { persona: { name: '小鱼', systemPrompt: '你是温柔的小鱼。', personality: 'gentle' } });
  const shark = create('大鲨鱼', { persona: { name: '大鲨鱼', systemPrompt: '你是凶猛的鲨鱼。', personality: 'sharp' } });
  await engine.handleEvent(mention('你好'));
  assert.equal(sent.length, 2, '两个 Bot 都被 @ 触发');
  const systems = ai.requests.map(request => request.body.messages[0].content);
  assert.ok(systems.some(system => system.includes('温柔的小鱼') && !system.includes('凶猛的鲨鱼')));
  assert.ok(systems.some(system => system.includes('凶猛的鲨鱼') && !system.includes('温柔的小鱼')));
  engine.memoryOf(fish.id).setNote('bot', '', '秘密', '只有小鱼知道');
  await engine.handleEvent(mention('第二句'));
  const secondRound = ai.requests.slice(2);
  assert.equal(secondRound.filter(request => request.body.messages[0].content.includes('只有小鱼知道')).length, 1);
  assert.equal(engine.memoryOf(shark.id).stats().notes, 0);
  assert.equal(engine.memoryOf(fish.id).stats().chats, 1);
  assert.notEqual(store.memoryFile(fish.id), store.memoryFile(shark.id));
});

test('AI replies go out exactly as the model wrote them: the UI ad never reaches QQ messages or the prompt', async t => {
  const { engine, store, ai, sent, create, replyText } = await setup(t);
  // 全局的界面推广位默认开启，而且改成什么文案都不会影响发出去的消息。
  assert.equal(store.readAds().enabled, true);
  store.writeAds({ text: '改过的推广文案 zelix.asia', url: 'https://zelix.asia' });
  const bot = create('无广告', { memory: { contextTurns: 0 }, limits: { sendsPerMinute: 60, aiPerMinute: 60, cooldownSeconds: 0 } });
  for (let index = 1; index <= 12; index++) await engine.handleEvent(mention('问题' + index));
  assert.equal(sent.length, 12);
  assert.deepEqual(sent.map(replyText), Array.from({ length: 12 }, (_, index) => `答：小明：问题${index + 1}`));
  const everything = JSON.stringify([sent, ai.requests.map(request => request.body), engine.memoryOf(bot.id).exportData()]);
  assert.equal(/zelix|广告|推广/.test(everything), false, '发出的消息、AI 请求和记忆里都没有广告');
});

test('rate limits: sends per minute, AI calls per minute and per-user cooldown', async t => {
  const { engine, store, ai, sent, logs, clock, create } = await setup(t);
  const bot = create('限流', { limits: { sendsPerMinute: 2, aiPerMinute: 3, cooldownSeconds: 0 } });
  for (let index = 0; index < 4; index++) await engine.handleEvent(mention('第' + index + '个', { user_id: 100 + index }));
  assert.equal(sent.length, 2, '每分钟最多发 2 条');
  const limited = logs.filter(entry => entry.status === 'limited');
  assert.equal(limited.length, 2);
  assert.match(limited[0].error, /发送太频繁/);
  assert.equal(ai.requests.length, 3, '第 4 次在调用 AI 之前就被 AI 频率限制拦下');
  assert.match(limited[1].error, /调用 AI 太频繁/);
  clock.time += 61_000;
  await engine.handleEvent(mention('过了一分钟', { user_id: 200 }));
  assert.equal(sent.length, 3);
  // 冷却：同一个人 2 秒内重复触发只处理第一次。
  store.update(bot.id, { limits: { sendsPerMinute: 60, aiPerMinute: 60, cooldownSeconds: 2 } });
  clock.time += 61_000;
  const base = sent.length;
  await engine.handleEvent(mention('甲', { user_id: 300 }));
  await engine.handleEvent(mention('乙', { user_id: 300 }));
  await engine.handleEvent(mention('丙', { user_id: 301 }));
  assert.equal(sent.length - base, 2, '同一个人的第二条被冷却掉，别人不受影响');
  clock.time += 2500;
  await engine.handleEvent(mention('丁', { user_id: 300 }));
  assert.equal(sent.length - base, 3);
});

test('scope lists, disabled bots, stale events and non-message events are ignored', async t => {
  const { engine, store, sent, clock, create } = await setup(t);
  const bot = create('范围');
  store.update(bot.id, { scope: { group: { mode: 'allow', ids: [10, 11] } } });
  await engine.handleEvent(mention('在名单里', { group_id: 10 }));
  await engine.handleEvent(mention('不在名单', { group_id: 99 }));
  assert.equal(sent.length, 1);
  store.update(bot.id, { scope: { group: { mode: 'deny', ids: [10] } } });
  await engine.handleEvent(mention('被拉黑', { group_id: 10 }));
  await engine.handleEvent(mention('没拉黑', { group_id: 11 }));
  assert.equal(sent.length, 2);
  store.update(bot.id, { enabled: false });
  await engine.handleEvent(mention('已停用', { group_id: 11 }));
  assert.equal(sent.length, 2);
  store.update(bot.id, { enabled: true });
  await engine.handleEvent(mention('太旧', { group_id: 11, time: clock.time / 1000 - 600 }));
  await engine.handleEvent(mention('新鲜', { group_id: 11, time: clock.time / 1000 - 5 }));
  assert.equal(sent.length, 3);
  assert.deepEqual(await engine.handleEvent({ post_type: 'notice', notice_type: 'group_increase' }), []);
  assert.deepEqual(await engine.handleEvent(null), []);
});

test('simulate runs the program without sending anything and reports what would be sent', async t => {
  const { engine, store, sent, ai, create } = await setup(t);
  const bot = create('试运行');
  store.update(bot.id, { enabled: false });
  const result = await engine.simulate(bot.id, { chatType: 'group', text: '你好', atSelf: true });
  assert.deepEqual(result.matched, ['oq_on_mention']);
  assert.equal(result.outputs.length, 1);
  assert.equal(result.outputs[0].text, '答：测试用户：你好');
  assert.equal(result.runs[0].simulated, true);
  assert.equal(sent.length, 0, '试运行不会真的发消息');
  assert.equal(ai.requests.length, 1);
  assert.deepEqual((await engine.simulate(bot.id, { chatType: 'group', text: '没有@' })).matched, []);
  assert.ok(engine.memoryOf(bot.id).listChats().every(chat => chat.key.startsWith('sim:')), '试运行用单独的会话记忆');
  assert.equal(engine.runsOf(bot.id).length, 1, '没有匹配的触发就不产生运行记录');
  await assert.rejects(engine.simulate('b_00000000'), /不存在/);
});

test('failed runs are recorded without leaking the key, and a failing send is reported', async t => {
  const { engine, ai, logs, create } = await setup(t, { aiHandler: (request, response) => { response.statusCode = 401; response.end(JSON.stringify({ error: { message: 'bad key ' + request.headers.authorization } })); } });
  const bot = create();
  await engine.handleEvent(mention('你好'));
  const [entry] = engine.runsOf(bot.id);
  assert.equal(entry.status, 'error');
  assert.match(entry.error, /HTTP 401/);
  assert.equal(JSON.stringify([entry, logs]).includes(SECRET), false);
  assert.equal(ai.requests.length, 1);
  assert.equal(logs[0].botName, '小鱼');
});

test('runs in one chat are queued in order, so memory records turns in arrival order', async t => {
  const { engine, ai, create } = await setup(t, { aiHandler: (request, response) => setTimeout(() => response.end(JSON.stringify({ choices: [{ message: { content: '收到' } }] })), request.body.messages.at(-1).content.includes('慢') ? 60 : 1) });
  const bot = create();
  await Promise.all([engine.handleEvent(mention('慢的第一句', { user_id: 1 })), engine.handleEvent(mention('快的第二句', { user_id: 2 }))]);
  const turns = engine.memoryOf(bot.id).recent('g:30001', 10).filter(turn => turn.role === 'user').map(turn => turn.text);
  assert.deepEqual(turns, ['慢的第一句', '快的第二句']);
  assert.equal(ai.requests.length, 2);
});

test('AI summaries are requested only in "ai" mode and only when old turns need folding', async t => {
  let summaries = 0;
  const { engine, store, clock, create } = await setup(t, { aiHandler: (request, response) => {
    const system = request.body.messages[0].content;
    if (system.includes('压缩成简短的摘要')) summaries++;
    response.end(JSON.stringify({ choices: [{ message: { content: system.includes('压缩成简短的摘要') ? '摘要：聊了很多。' : '好的' } }] }));
  } });
  const bot = create('摘要', { memory: { summary: 'ai', contextTurns: 4 }, limits: { sendsPerMinute: 120, aiPerMinute: 60, cooldownSeconds: 0 } });
  const memory = engine.memoryOf(bot.id);
  for (let index = 0; index < 22; index++) await engine.handleEvent(mention('话题' + index));
  assert.ok(summaries >= 1);
  assert.match(memory.summary('g:30001'), /聊了很多/);
  assert.ok(memory.recent('g:30001', 100).length <= memory.limits.softTurns);
  store.update(bot.id, { memory: { summary: 'rule' } });
  clock.time += 61_000;
  const before = summaries;
  for (let index = 0; index < 30; index++) await engine.handleEvent(mention('规则' + index));
  assert.equal(summaries, before);
});

test('the store validates saves, persists atomically, protects the key file and survives bad files', async t => {
  const { dir, store, engine } = await setup(t);
  const bot = store.create({ name: '存储', template: 'memory-notes' });
  assert.match(bot.id, /^b_[0-9a-f]{8}$/);
  assert.equal(bot.program.blocks.blocks.length, 2);
  assert.equal(bot.enabled, false);
  assert.throws(() => store.update(bot.id, { program: { blocks: { blocks: [{ type: 'evil' }] } } }), /未知的积木类型/);
  assert.equal(store.get(bot.id).program.blocks.blocks.length, 2, '无效程序不会覆盖已保存的');
  assert.throws(() => store.update(bot.id, { name: '' }), /名称/);
  assert.throws(() => store.update(bot.id, { persona: { personality: 'evil' } }), /性格/);
  assert.throws(() => store.update(bot.id, { scope: { group: { mode: 'allow', ids: ['x'] } } }), /号码/);
  assert.throws(() => store.update(bot.id, { limits: { sendsPerMinute: 0 } }), /1–120/);
  const saved = store.update(bot.id, { name: '新名字', program: program(stack(0, 0, b('oq_on_message'))) });
  assert.match(saved.warnings.join(), /没有积木/);
  // 重新打开目录能读回来；ai.json 单独存放，权限收紧到仅本人。
  const reopened = createBotStore({ dir });
  assert.equal(reopened.get(bot.id).name, '新名字');
  assert.equal(reopened.readAi().apiKey, SECRET);
  if (process.platform !== 'win32') assert.equal(statSync(join(dir, 'ai.json')).mode & 0o777, 0o600);
  assert.equal(readFileSync(join(dir, 'bots', bot.id, 'bot.json'), 'utf8').includes(SECRET), false, 'Key 不会写进 Bot 文件');
  assert.equal('ads' in saved.bot, false, '广告是全局的界面设置，不属于某个 Bot');
  const stale = JSON.parse(readFileSync(join(dir, 'bots', bot.id, 'bot.json'), 'utf8'));
  writeFileSync(join(dir, 'bots', bot.id, 'bot.json'), JSON.stringify({ ...stale, ads: { enabled: true, everyN: 1, label: 'x', text: 'y' } }));
  assert.equal('ads' in createBotStore({ dir }).get(bot.id), false, '旧版本文件里的 ads 字段被丢弃');
  writeFileSync(join(dir, 'bots', bot.id, 'bot.json'), JSON.stringify(stale));
  assert.deepEqual(readdirSync(join(dir, 'bots', bot.id)).filter(name => name.endsWith('.tmp')), []);
  // 路径穿越式的 id 被拒绝；损坏的 Bot 文件被跳过而不是让整个存储起不来。
  for (const id of ['../x', 'b_zzzzzzzz', 'b_0123456', '', 7]) { assert.throws(() => store.update(id, {}), /不存在/); assert.throws(() => store.memoryFile(id), /不存在/); }
  mkdirSync(join(dir, 'bots', 'b_deadbeef'), { recursive: true });
  writeFileSync(join(dir, 'bots', 'b_deadbeef', 'bot.json'), '{ broken');
  const withBad = createBotStore({ dir });
  assert.equal(withBad.list().length, 1);
  assert.equal(withBad.skipped[0].id, 'b_deadbeef');
  // 删除：目录和引擎里的状态一起清掉。
  engine.forget(bot.id);
  store.remove(bot.id);
  assert.equal(store.get(bot.id), undefined);
  assert.equal(readdirSync(join(dir, 'bots')).includes(bot.id), false);
  assert.throws(() => store.remove(bot.id), /不存在/);
  for (let index = 0; index < MAX_BOTS; index++) store.create({ name: 'b' + index });
  assert.throws(() => store.create({ name: '多了' }), /最多创建/);
});
