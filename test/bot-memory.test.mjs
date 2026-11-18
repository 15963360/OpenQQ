import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemory, memoryLimits } from '../src/bot/memory.mjs';
import { buildMessages, defaultPersona, defaultMemorySettings } from '../src/bot/persona.mjs';

function sandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), 'openqq-memory-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, file: join(dir, 'bot', 'memory.json') };
}
const open = (file, options = {}) => createMemory({ file, saveDelay: -1, ...options });
const say = (role, text, name = '') => ({ role, name, text });

test('turns persist across restarts and recent() returns the newest ones oldest-first', t => {
  const { file } = sandbox(t);
  const memory = open(file);
  memory.appendTurns('g:1', [say('user', '你好', '小明'), say('assistant', '你好呀'), say('user', '今天天气如何', '小明')]);
  assert.deepEqual(memory.recent('g:1', 2).map(turn => [turn.role, turn.text]), [['assistant', '你好呀'], ['user', '今天天气如何']]);
  assert.equal(memory.recent('g:1', 5)[0].name, '小明');
  assert.deepEqual(memory.recent('g:2', 5), []);
  memory.flush();
  const again = open(file);
  assert.equal(again.recent('g:1', 10).length, 3);
  assert.equal(again.stats().chats, 1);
  // 文件里是普通 JSON，权限和临时文件都处理好了。
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).version, 1);
  assert.deepEqual(readdirSync(join(file, '..')).filter(name => name.endsWith('.tmp')), []);
});

test('conversations are isolated from each other and clearing one leaves the rest', t => {
  const { file } = sandbox(t);
  const memory = open(file);
  memory.appendTurns('g:1', [say('user', '群里的秘密')]);
  memory.appendTurns('p:2', [say('user', '私聊内容')]);
  memory.setNote('chat', 'g:1', '名字', '小明');
  assert.equal(memory.getNote('chat', 'p:2', '名字'), '', '另一个会话读不到本会话的笔记');
  memory.clearChat('g:1');
  assert.deepEqual(memory.recent('g:1', 5), []);
  assert.equal(memory.recent('p:2', 5).length, 1);
  assert.equal(memory.getNote('chat', 'g:1', '名字'), '');
});

test('old turns fold into a bounded rule-based summary and the newest ones stay', async t => {
  const { file } = sandbox(t);
  const memory = open(file, { limits: { softTurns: 6, keepTurns: 3, summaryChars: 200 } });
  for (let index = 1; index <= 8; index++) memory.appendTurns('p:1', [say(index % 2 ? 'user' : 'assistant', `第${index}句 ` + '话'.repeat(100), '小明')]);
  assert.equal(memory.needsCompaction('p:1'), true);
  assert.equal(await memory.compact('p:1'), true);
  assert.equal(memory.needsCompaction('p:1'), false);
  assert.deepEqual(memory.recent('p:1', 10).map(turn => turn.text.slice(0, 3)), ['第6句', '第7句', '第8句']);
  const summary = memory.summary('p:1');
  assert.ok(summary.length <= 201, '摘要长度有上限：' + summary.length);
  assert.match(summary, /第5句/, '摘要保留最近被折叠的内容');
  assert.match(summary, /…/, '每句话被截成一行');
  assert.equal(await memory.compact('p:1'), false, '没超过阈值就什么也不做');
  // 摘要多次叠加后依然不会超过上限。
  for (let round = 0; round < 6; round++) {
    for (let index = 0; index < 10; index++) memory.appendTurns('p:1', [say('user', `轮${round}-${index} ` + '字'.repeat(80))]);
    await memory.compact('p:1');
  }
  assert.ok(memory.summary('p:1').length <= 201);
});

test('an AI summarizer is used when given, and any failure falls back to the rule summary', async t => {
  const { file } = sandbox(t);
  const memory = open(file, { limits: { softTurns: 4, keepTurns: 2 } });
  const fill = () => { for (let index = 0; index < 6; index++) memory.appendTurns('g:9', [say('user', '消息' + index, '小红')]); };
  fill();
  const calls = [];
  assert.equal(await memory.compact('g:9', async input => { calls.push(input); return '  小红聊了很多消息。  '; }), true);
  assert.equal(memory.summary('g:9'), '小红聊了很多消息。');
  assert.equal(calls[0].turns.length, 4);
  assert.equal(memory.recent('g:9', 9).length, 2);
  fill();
  assert.equal(await memory.compact('g:9', async () => { throw new Error('AI 挂了'); }), true);
  assert.match(memory.summary('g:9'), /小红：消息/, '回退到规则摘要：保留原有摘要并追加');
  assert.match(memory.summary('g:9'), /小红聊了很多消息/);
  // 摘要过程中会话被清空，不会把旧内容写回去。
  fill();
  const racing = memory.compact('g:9', async () => { memory.clearChat('g:9'); return '不应出现'; });
  assert.equal(await racing, false);
  assert.equal(memory.summary('g:9'), '');
});

test('size limits: turn text, hard turn cap, chat count, note count and total bytes', t => {
  const { file } = sandbox(t);
  let clock = 1000;
  const memory = open(file, { now: () => clock++, limits: { hardTurns: 10, keepTurns: 4, chats: 3, notes: 2, turnChars: 50, bytes: 4000 } });
  memory.appendTurns('g:1', [say('user', '长'.repeat(500))]);
  assert.equal(memory.recent('g:1', 1)[0].text.length, 50);
  for (let index = 0; index < 25; index++) memory.appendTurns('g:1', [say('user', '句' + index)]);
  assert.ok(memory.stats().turns <= 10, '没人调用 compact 原文也不会无限增长');
  for (const key of ['g:2', 'g:3', 'g:4']) memory.appendTurns(key, [say('user', key)]);
  assert.deepEqual(memory.listChats().map(chat => chat.key).sort(), ['g:2', 'g:3', 'g:4'], '会话超过上限时淘汰最久没更新的');
  memory.setNote('bot', '', 'a', '1');
  memory.setNote('bot', '', 'b', '2');
  assert.throws(() => memory.setNote('bot', '', 'c', '3'), /笔记已满/);
  memory.setNote('bot', '', 'a', '覆盖已有的不占新位置');
  assert.throws(() => memory.setNote('bot', '', 'x'.repeat(41), '1'), /名称需要/);
  assert.equal(memory.setNote('bot', '', 'b', 'v'.repeat(900)), undefined);
  assert.equal(memory.getNote('bot', '', 'b').length, memoryLimits.valueChars);
  for (let index = 0; index < 40; index++) memory.appendTurns('g:' + (10 + index % 3), [say('user', '占位'.repeat(25))]);
  memory.flush();
  assert.ok(readFileSync(file).length <= 4000, '落盘体积不超过上限');
});

test('notes in the prompt come from the bot and the current chat only, and __proto__ names are safe', t => {
  const { file } = sandbox(t);
  const memory = open(file);
  memory.setNote('bot', '', '__proto__', '危险');
  memory.setNote('bot', '', 'constructor', 'x');
  memory.setNote('chat', 'g:1', '喜欢的食物', '鱼');
  memory.setNote('chat', 'g:2', '喜欢的食物', '肉');
  assert.deepEqual(memory.notesFor('g:1'), [['__proto__', '危险'], ['constructor', 'x'], ['喜欢的食物', '鱼']]);
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.getPrototypeOf(memory.exportData().notes), Object.prototype);
  memory.flush();
  assert.deepEqual(open(file).notesFor('g:1').map(item => item[0]), ['__proto__', 'constructor', '喜欢的食物']);
  assert.equal(({}).danger, undefined);
});

test('export contains only notes and chats; clear scopes remove what they say', t => {
  const { file } = sandbox(t);
  const memory = open(file);
  memory.appendTurns('p:5', [say('user', '你好')]);
  memory.setNote('bot', '', '名字', '小鱼');
  const exported = memory.exportData({ bot: { id: 'b_00000000', name: '小鱼' } });
  assert.deepEqual(Object.keys(exported).sort(), ['bot', 'chats', 'exportedAt', 'notes', 'version']);
  assert.equal(exported.chats['p:5'].turns[0].t, '你好');
  assert.equal(JSON.parse(JSON.stringify(exported)).notes['名字'], '小鱼');
  memory.clear('chats');
  assert.equal(memory.stats().chats, 0);
  assert.equal(memory.stats().notes, 1);
  memory.clear('all');
  assert.equal(memory.stats().notes, 0);
  memory.flush();
  assert.equal(open(file).stats().notes, 0);
});

test('a corrupted memory file is set aside instead of crashing the bot', t => {
  const { dir, file } = sandbox(t);
  const memory = open(file);
  memory.appendTurns('g:1', [say('user', 'x')]);
  memory.flush();
  writeFileSync(file, '{ this is not json');
  const recovered = open(file);
  assert.equal(recovered.stats().chats, 0);
  assert.ok(readdirSync(join(dir, 'bot')).some(name => name.startsWith('memory.json.bad-')));
  // 结构合法但内容被篡改（超长、类型不对、非法会话名）时只保留合规的部分。
  writeFileSync(file, JSON.stringify({ version: 1, notes: { ok: 'v', bad: 5 }, chats: { 'g:1': { turns: [{ r: 'u', t: 'hi' }, { r: 'x', t: 'no' }, 7] }, '../evil': { turns: [] } } }));
  const sanitized = open(file);
  assert.equal(sanitized.getNote('bot', '', 'ok'), 'v');
  assert.equal(sanitized.getNote('bot', '', 'bad'), '');
  assert.deepEqual(sanitized.listChats().map(chat => chat.key), ['g:1']);
  assert.equal(sanitized.recent('g:1', 9).length, 1);
  assert.equal(existsSync(join(dir, 'evil')), false);
});

test('debounced saves write once and close() flushes pending changes', async t => {
  const { file } = sandbox(t);
  const memory = createMemory({ file, saveDelay: 20 });
  memory.appendTurns('g:1', [say('user', 'a')]);
  memory.appendTurns('g:1', [say('user', 'b')]);
  assert.equal(existsSync(file), false);
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).chats['g:1'].turns.length, 2);
  memory.appendTurns('g:1', [say('user', 'c')]);
  memory.close();
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).chats['g:1'].turns.length, 3);
});

test('prompt assembly puts persona, summary, notes and recent turns into the request in order', async t => {
  const { file } = sandbox(t);
  const memory = open(file, { limits: { softTurns: 3, keepTurns: 1 } });
  const persona = { ...defaultPersona(), name: '阿鱼', systemPrompt: '你是一条会说冷笑话的鱼。', personality: 'sharp', traits: '喜欢用“咕噜”结尾', style: 'short' };
  memory.setNote('bot', '', '主人', '小明');
  memory.setNote('chat', 'g:7', '群规', '不许刷屏');
  memory.appendTurns('g:7', [say('user', '你好', '小红'), say('assistant', '你好呀'), say('user', '你是谁', '小红'), say('assistant', '我是阿鱼')]);
  await memory.compact('g:7');
  const settings = { ...defaultMemorySettings(), contextTurns: 2 };
  const messages = buildMessages({ persona, memorySettings: settings, memory, chatKey: 'g:7', chat: { type: 'group', id: 7 }, sender: '小黄', prompt: '讲个笑话', now: new Date(2026, 0, 1, 8, 0) });
  assert.equal(messages[0].role, 'system');
  const system = messages[0].content;
  assert.ok(system.startsWith('你是一条会说冷笑话的鱼。'));
  for (const expected of ['阿鱼', '爱调侃', '咕噜', '不超过两三句话', '主人：小明', '群规：不许刷屏', '群聊（群号 7）', '摘要']) assert.ok(system.includes(expected), expected);
  assert.deepEqual(messages.slice(1, -1).map(item => [item.role, item.content]), [['assistant', '我是阿鱼']], '只带最近的原文，更早的在摘要里');
  assert.equal(messages.at(-1).content, '小黄：讲个笑话');
  assert.equal(messages.at(-1).role, 'user');
  // 私聊：不带昵称前缀；关闭记忆后不带摘要和历史，但笔记仍在。
  const off = buildMessages({ persona, memorySettings: { ...settings, enabled: false }, memory, chatKey: 'g:7', chat: { type: 'private', id: 1 }, sender: '小黄', prompt: '嗨', now: new Date() });
  assert.equal(off.length, 2);
  assert.equal(off[1].content, '嗨');
  assert.ok(off[0].content.includes('群规：不许刷屏') && !off[0].content.includes('摘要'));
});
