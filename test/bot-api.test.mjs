import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startWebUI } from '../src/webui.mjs';
import { createBotStore } from '../src/bot/store.mjs';
import { createBotEngine } from '../src/bot/engine.mjs';
import { createAIClient } from '../src/bot/ai.mjs';
import { createBotApi } from '../src/bot/api.mjs';
import { mockAI, mention, withUsablePort } from './bot-support.mjs';

const SECRET = 'sk-api-SECRET-abcdef0123456789';

async function fixture(t, aiHandler) {
  const dir = mkdtempSync(join(tmpdir(), 'openqq-api-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = createBotStore({ dir });
  const ai = await mockAI(t, aiHandler);
  const client = createAIClient({ settings: () => store.readAi() });
  const sent = [];
  const engine = createBotEngine({ store, ai: client, dispatch: async request => { sent.push(request); return { status: 'ok', retcode: 0, data: {} }; }, memoryOptions: { saveDelay: -1 } });
  t.after(() => engine.close());
  const web = await withUsablePort(async () => {
    const started = await startWebUI({ port: 0, bot: createBotApi({ store, engine, ai: client }) });
    return Object.assign(started, { port: Number(new URL(started.origin).port), stop: () => started.close() });
  });
  t.after(() => web.close());
  const token = new URLSearchParams(new URL(web.url).hash.slice(1)).get('token');
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const call = async (method, path, body) => {
    const response = await fetch(web.origin + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const raw = await response.text();
    return { status: response.status, raw, json: raw ? JSON.parse(raw) : undefined };
  };
  return { web, store, engine, ai, sent, call, token, headers, dir };
}

test('/api/bot/* requires the WebUI access key, JSON bodies and a known route', async t => {
  const { web, call, headers } = await fixture(t);
  assert.equal((await fetch(web.origin + '/api/bot/ai')).status, 401);
  assert.equal((await fetch(web.origin + '/api/bot/ai', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await fetch(web.origin + '/api/bot/ai', { method: 'POST', headers: { ...headers, 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal((await call('GET', '/api/bot/nope')).status, 404);
  assert.equal((await call('POST', '/api/bot/bots/b_00000000', {})).status, 404);
  assert.equal((await call('POST', '/api/bot/ai', [])).status, 400);
  assert.equal((await call('GET', '/api/bot/bots/b_00000000/memory')).status, 404);
  const foreign = await fetch(web.origin + '/api/bot/ai', { headers: { ...headers, Origin: 'https://evil.example' } });
  assert.equal(foreign.status, 403);
  assert.equal((await call('POST', '/api/bot/ai', { padding: 'x'.repeat(300 * 1024) })).status, 413);
  assert.equal((await fetch(web.origin + '/blocks.js')).headers.get('content-type'), 'text/javascript; charset=utf-8');
});

test('the API key is saved but never returned by any endpoint or leaked through the event stream', async t => {
  const { web, ai, call, token, engine } = await fixture(t, (request, response) => {
    if (request.url.endsWith('/models')) { response.end(JSON.stringify({ data: [{ id: 'gpt-x' }] })); return; }
    response.statusCode = 400;
    response.end(JSON.stringify({ error: { message: `invalid key ${request.headers.authorization} (${SECRET})` } }));
  });
  const saved = await call('POST', '/api/bot/ai', { baseUrl: ai.origin, apiKey: SECRET, model: 'gpt-x', temperature: 0.5 });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.json, { baseUrl: ai.baseUrl, model: 'gpt-x', temperature: 0.5, maxTokens: 512, timeoutSec: 30, apiKeySet: true, apiKeyHint: '••••6789' });
  const created = (await call('POST', '/api/bot/bots', { name: 'Key 测试', template: 'ai-mention' })).json.bot;
  await call('POST', `/api/bot/bots/${created.id}`, { enabled: true });
  const responses = [
    saved, await call('GET', '/api/bot/ai'), await call('GET', '/api/bot/bots'), await call('GET', `/api/bot/bots/${created.id}`),
    await call('POST', '/api/bot/ai/test', {}), await call('POST', '/api/bot/ai/test', { apiKey: SECRET }), await call('POST', '/api/bot/ai/models', {}),
    await call('POST', `/api/bot/bots/${created.id}/simulate`, { chatType: 'group', text: '嗨', atSelf: true }),
    await call('GET', `/api/bot/bots/${created.id}/runs`), await call('GET', `/api/bot/bots/${created.id}/memory`), await call('GET', `/api/bot/bots/${created.id}/memory/export`),
    await call('GET', '/api/config'), await call('GET', '/api/metrics'),
  ];
  for (const response of responses) assert.equal(response.raw.includes(SECRET), false, response.raw.slice(0, 200));
  assert.equal(responses[4].json.ok, false);
  assert.match(responses[4].json.message, /HTTP 400/);
  assert.equal(responses[6].json.models[0], 'gpt-x');
  // 真实消息运行失败后，错误会进入事件流和运行记录；其中也不能出现 Key。
  await engine.handleEvent(mention('来一条真实事件'));
  const stream = await fetch(web.origin + '/api/stream', { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(1500) });
  const reader = stream.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  await reader.cancel();
  assert.equal(first.includes(SECRET), false);
  assert.equal(JSON.stringify(engine.runsOf(created.id)).includes(SECRET), false);
  assert.ok(engine.runsOf(created.id).some(run => run.status === 'error'));
});

test('changing the server needs the key again, and test/models never send the saved key elsewhere', async t => {
  const { ai, call } = await fixture(t);
  const other = await mockAI(t);
  await call('POST', '/api/bot/ai', { baseUrl: ai.baseUrl, apiKey: SECRET, model: 'm-a' });
  const rejected = await call('POST', '/api/bot/ai', { baseUrl: other.baseUrl });
  assert.equal(rejected.status, 400);
  assert.match(rejected.json.message, /重新填写 API Key/);
  assert.equal((await call('GET', '/api/bot/ai')).json.baseUrl, ai.baseUrl, '被拒绝的修改没有生效');
  // 对新地址测试连接：没带 Key，所以是无 Key 请求，已保存的 Key 不会跟过去。
  const tested = await call('POST', '/api/bot/ai/test', { baseUrl: other.baseUrl });
  assert.equal(tested.json.ok, true);
  assert.equal(other.requests.length, 1);
  assert.equal(other.requests[0].headers.authorization, undefined);
  const models = await call('POST', '/api/bot/ai/models', { baseUrl: other.baseUrl });
  assert.deepEqual(models.json.models, ['m-a', 'm-b']);
  assert.equal(other.requests.every(request => request.headers.authorization === undefined), true);
  // 带上新 Key 才会发出去；同一服务器上的测试用已保存的 Key。
  await call('POST', '/api/bot/ai/test', { baseUrl: other.baseUrl, apiKey: 'sk-for-other-server' });
  assert.equal(other.requests.at(-1).headers.authorization, 'Bearer sk-for-other-server');
  await call('POST', '/api/bot/ai/test', {});
  assert.equal(ai.requests.at(-1).headers.authorization, 'Bearer ' + SECRET);
  const accepted = await call('POST', '/api/bot/ai', { baseUrl: other.baseUrl, apiKey: 'sk-for-other-server' });
  assert.equal(accepted.json.apiKeyHint, '••••rver');
  // 非法地址和非法 Key 的提示。
  assert.match((await call('POST', '/api/bot/ai', { baseUrl: 'http://api.example.com/v1' })).json.message, /https/);
  assert.match((await call('POST', '/api/bot/ai', { apiKey: 'has space' })).json.message, /可见 ASCII/);
  assert.equal((await call('POST', '/api/bot/ai/test', { baseUrl: 'nonsense' })).json.ok, false);
  assert.equal((await call('POST', '/api/bot/ai', { clearApiKey: true })).json.apiKeySet, false);
});

test('bots can be created from templates, edited, validated, simulated and deleted over the API', async t => {
  const { call, sent, ai, dir, store } = await fixture(t);
  await call('POST', '/api/bot/ai', { baseUrl: ai.baseUrl, apiKey: SECRET, model: 'm-a' });
  const list = (await call('GET', '/api/bot/bots')).json;
  assert.deepEqual(list.bots, []);
  assert.equal(list.templates.length, 4);
  assert.equal(list.presets.personality.some(item => item.id === 'gentle'), true);
  assert.equal((await call('POST', '/api/bot/bots', { name: '', template: 'nope' })).status, 400);
  const bot = (await call('POST', '/api/bot/bots', { name: '小鱼', template: 'ai-mention' })).json.bot;
  assert.equal(bot.enabled, false);
  assert.equal((await call('GET', '/api/bot/bots')).json.bots[0].hats, 1);
  const bad = await call('POST', `/api/bot/bots/${bot.id}`, { program: { blocks: { blocks: [{ type: 'oq_on_message', next: { block: { type: 'oq_reply', fields: { AT: 'x' } } } }] } } });
  assert.equal(bad.status, 400);
  assert.match(bad.json.message, /勾选框/);
  const edited = await call('POST', `/api/bot/bots/${bot.id}`, { name: '大鱼', persona: { name: '大鱼', personality: 'calm', traits: '句尾加“咕噜”' }, enabled: true });
  assert.equal(edited.status, 200);
  assert.equal(edited.json.bot.persona.personality, 'calm');
  assert.equal('ads' in edited.json.bot, false);
  const sim = await call('POST', `/api/bot/bots/${bot.id}/simulate`, { chatType: 'group', text: '你好', atSelf: true });
  assert.equal(sim.json.outputs.length, 1);
  assert.equal(sim.json.outputs[0].text, '答：测试用户：你好');
  assert.equal(sent.length, 0);
  assert.equal((await call('GET', `/api/bot/bots/${bot.id}/runs`)).json.runs.length, 1);
  assert.equal((await call('POST', `/api/bot/bots/${bot.id}/delete`, {})).status, 200);
  assert.equal((await call('GET', `/api/bot/bots/${bot.id}`)).status, 404);
  assert.equal(store.list().length, 0);
  void dir;
});

test('memory can be inspected, exported, cleared by scope and is never shared between bots', async t => {
  const { call, engine, ai } = await fixture(t);
  await call('POST', '/api/bot/ai', { baseUrl: ai.baseUrl, apiKey: SECRET, model: 'm-a' });
  const one = (await call('POST', '/api/bot/bots', { name: '一号', template: 'ai-mention' })).json.bot;
  const two = (await call('POST', '/api/bot/bots', { name: '二号', template: 'ai-mention' })).json.bot;
  await call('POST', `/api/bot/bots/${one.id}`, { enabled: true, limits: { cooldownSeconds: 0 } });
  await engine.handleEvent(mention('记住我喜欢鱼', { group_id: 77 }));
  engine.memoryOf(one.id).setNote('bot', '', '主人', '小明');
  const memory = (await call('GET', `/api/bot/bots/${one.id}/memory`)).json;
  assert.equal(memory.stats.chats, 1);
  assert.equal(memory.stats.turns, 2);
  assert.deepEqual(memory.chats.map(chat => chat.key), ['g:77']);
  assert.deepEqual(memory.notes, [['主人', '小明']]);
  const chat = (await call('GET', `/api/bot/bots/${one.id}/memory/chat?key=g:77`)).json;
  assert.deepEqual(chat.turns.map(turn => turn.role), ['user', 'assistant']);
  assert.equal((await call('GET', `/api/bot/bots/${one.id}/memory/chat?key=g:1`)).status, 404);
  assert.equal((await call('GET', `/api/bot/bots/${two.id}/memory`)).json.stats.chats, 0, '另一个 Bot 的记忆是空的');
  const exported = (await call('GET', `/api/bot/bots/${one.id}/memory/export`)).json;
  assert.equal(exported.bot.name, '一号');
  assert.equal(exported.chats['g:77'].turns[0].t, '记住我喜欢鱼');
  assert.equal(exported.notes['主人'], '小明');
  assert.equal((await call('POST', `/api/bot/bots/${one.id}/memory/clear`, { scope: 'chat', chatKey: '../x' })).status, 400);
  assert.equal((await call('POST', `/api/bot/bots/${one.id}/memory/clear`, { scope: 'everything' })).status, 400);
  assert.equal((await call('POST', `/api/bot/bots/${one.id}/memory/clear`, { scope: 'chat', chatKey: 'g:77' })).json.stats.chats, 0);
  assert.equal((await call('GET', `/api/bot/bots/${one.id}/memory`)).json.stats.notes, 1, '只清会话，笔记还在');
  assert.equal((await call('POST', `/api/bot/bots/${one.id}/memory/clear`, { scope: 'all' })).json.stats.notes, 0);
});

test('the UI ad is global, editable and switchable over the API, and persists in ads.json', async t => {
  const { call, dir } = await fixture(t);
  const initial = await call('GET', '/api/bot/ads');
  assert.equal(initial.status, 200);
  assert.deepEqual(Object.keys(initial.json).sort(), ['enabled', 'text', 'url']);
  assert.equal(initial.json.enabled, true);
  assert.match(initial.json.text, /zelix\.asia/);
  assert.equal(initial.json.url, 'https://zelix.asia');
  const edited = await call('POST', '/api/bot/ads', { text: '我自己的推广文案', url: 'https://example.com/promo' });
  assert.deepEqual(edited.json, { enabled: true, text: '我自己的推广文案', url: 'https://example.com/promo' });
  assert.deepEqual((await call('POST', '/api/bot/ads', { enabled: false })).json, { enabled: false, text: '我自己的推广文案', url: 'https://example.com/promo' });
  assert.equal(JSON.parse(readFileSync(join(dir, 'ads.json'), 'utf8')).enabled, false);
  for (const bad of [{ url: 'javascript:alert(1)' }, { text: '长'.repeat(301) }, { enabled: 'yes' }]) assert.equal((await call('POST', '/api/bot/ads', bad)).status, 400, JSON.stringify(bad));
  assert.equal((await call('GET', '/api/bot/ads')).json.enabled, false, '被拒绝的修改没有生效');
  assert.deepEqual((await call('POST', '/api/bot/ads/reset', {})).json, initial.json, '恢复默认');
  // 广告设置和 Bot 无关：不在 Bot 数据里，也不影响任何 Bot 的消息（见 bot-engine 的回归测试）。
  const bot = (await call('POST', '/api/bot/bots', { name: '无关', template: 'ai-mention' })).json.bot;
  assert.equal('ads' in bot, false);
});
