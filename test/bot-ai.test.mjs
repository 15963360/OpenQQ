import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createAIClient, normalizeBaseUrl, isLocalHost, scrub, AIError } from '../src/bot/ai.mjs';
import { mergeAiSettings, publicAiSettings, defaultAiSettings } from '../src/bot/store.mjs';
import { defaultAds, normalizeAds } from '../src/bot/ads.mjs';
import { mockAI, listenOnUsablePort } from './bot-support.mjs';

const SECRET = 'sk-test-SECRET-1234567890abcdef';
const settingsFor = (baseUrl, extra = {}) => ({ ...defaultAiSettings(), baseUrl, apiKey: SECRET, model: 'm-a', ...extra });

test('Base URL is normalized and plain http is only allowed for local addresses', () => {
  assert.equal(normalizeBaseUrl('https://api.example.com'), 'https://api.example.com/v1');
  assert.equal(normalizeBaseUrl(' https://api.example.com/v1/ '), 'https://api.example.com/v1');
  assert.equal(normalizeBaseUrl('https://api.example.com/v1/chat/completions'), 'https://api.example.com/v1');
  assert.equal(normalizeBaseUrl('https://relay.example.com/api/paas/v4/models'), 'https://relay.example.com/api/paas/v4');
  assert.equal(normalizeBaseUrl('http://127.0.0.1:11434'), 'http://127.0.0.1:11434/v1');
  assert.equal(normalizeBaseUrl('http://192.168.1.5:8080/v1'), 'http://192.168.1.5:8080/v1');
  for (const bad of ['', '   ', 'not a url', 'ftp://example.com/v1', 'https://user:pass@example.com/v1', 'https://example.com/v1?key=abc', 'https://example.com/v1#x', 'http://api.example.com/v1', 'http://8.8.8.8/v1', 'x'.repeat(3000)]) {
    assert.throws(() => normalizeBaseUrl(bad), AIError, bad);
  }
  for (const local of ['localhost', 'LOCALHOST', '127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.0.9', '[::1]', 'ollama', 'host.docker.internal', 'nas.local']) assert.ok(isLocalHost(local), local);
  for (const remote of ['example.com', '8.8.8.8', '172.32.0.1', '11.0.0.1', 'localhost.evil.com']) assert.equal(isLocalHost(remote), false, remote);
});

test('chat sends persona messages with the bearer key and returns the cleaned answer', async t => {
  const ai = await mockAI(t, (request, response) => response.end(JSON.stringify({ choices: [{ message: { content: '<think>先想想</think>\n  你好呀  ' } }] })));
  const client = createAIClient({ settings: () => settingsFor(ai.baseUrl, { temperature: 0.3, maxTokens: 99 }) });
  const answer = await client.chat({ messages: [{ role: 'system', content: '你是鱼' }, { role: 'user', content: '嗨' }] });
  assert.equal(answer, '你好呀');
  const [request] = ai.requests;
  assert.equal(request.method, 'POST');
  assert.equal(request.url, '/v1/chat/completions');
  assert.equal(request.headers.authorization, 'Bearer ' + SECRET);
  assert.deepEqual(request.body, { model: 'm-a', messages: [{ role: 'system', content: '你是鱼' }, { role: 'user', content: '嗨' }], stream: false, temperature: 0.3, max_tokens: 99 });
  // 分段内容（部分网关的格式）也能读。
  ai.set((req, res) => res.end(JSON.stringify({ choices: [{ message: { content: [{ type: 'text', text: '甲' }, { type: 'text', text: '乙' }] } }] })));
  assert.equal(await client.chat({ messages: [{ role: 'user', content: 'x' }] }), '甲乙');
});

test('listModels returns sorted unique ids and test() reports success with latency', async t => {
  const ai = await mockAI(t);
  const client = createAIClient({ settings: () => settingsFor(ai.baseUrl) });
  assert.deepEqual(await client.listModels(), ['m-a', 'm-b']);
  const result = await client.test();
  assert.equal(result.ok, true);
  assert.equal(result.reply.startsWith('答：'), true);
  assert.ok(result.latency >= 0);
  assert.equal(ai.requests.at(-1).body.max_tokens, 16);
});

test('errors never contain the API key, even when the upstream echoes it back', async t => {
  const ai = await mockAI(t, (request, response) => {
    response.statusCode = 401;
    response.end(JSON.stringify({ error: { message: `Incorrect API key provided: ${request.headers.authorization.slice(7)}. Bearer ${SECRET} sk-another-LEAKED-key-1234` } }));
  });
  const client = createAIClient({ settings: () => settingsFor(ai.baseUrl) });
  const failure = await client.chat({ messages: [{ role: 'user', content: 'x' }] }).catch(error => error);
  assert.ok(failure instanceof AIError);
  assert.match(failure.message, /HTTP 401/);
  assert.equal(failure.message.includes(SECRET), false);
  assert.equal(/LEAKED|SECRET|1234567890/.test(failure.message), false, failure.message);
  const test = await client.test();
  assert.equal(test.ok, false);
  assert.equal(JSON.stringify(test).includes(SECRET), false);
  assert.equal(scrub(`token=${SECRET}!`, SECRET), 'token=***!');
});

test('failures are reported plainly: no key, no model, bad JSON, empty answer, timeout, redirect and oversized body', async t => {
  const ai = await mockAI(t);
  const noKey = createAIClient({ settings: () => settingsFor('https://api.example.com/v1', { apiKey: '' }) });
  await assert.rejects(noKey.chat({ messages: [] }), /API Key/);
  const noModel = createAIClient({ settings: () => settingsFor(ai.baseUrl, { model: '' }) });
  await assert.rejects(noModel.chat({ messages: [] }), /选择模型/);
  // 本机模型（如 Ollama）可以不填 Key，此时不发 Authorization 头。
  const local = createAIClient({ settings: () => settingsFor(ai.baseUrl, { apiKey: '' }) });
  await local.chat({ messages: [{ role: 'user', content: 'x' }] });
  assert.equal(ai.requests.at(-1).headers.authorization, undefined);
  const client = createAIClient({ settings: () => settingsFor(ai.baseUrl) });
  ai.set((req, res) => res.end('<html>not json</html>'));
  await assert.rejects(client.chat({ messages: [] }), /不是 JSON/);
  ai.set((req, res) => res.end(JSON.stringify({ choices: [{ message: { content: '<think>只有思考</think>' } }] })));
  await assert.rejects(client.chat({ messages: [] }), /没有返回文字/);
  ai.set((req, res) => { res.statusCode = 429; res.end(JSON.stringify({ message: 'rate limited' })); });
  await assert.rejects(client.chat({ messages: [] }), /HTTP 429：rate limited/);
  ai.set(() => { /* 永不响应 */ });
  await assert.rejects(client.chat({ messages: [], timeout: 1000 }), /1 秒内没有响应/);
  ai.set((req, res) => { res.statusCode = 307; res.setHeader('Location', 'http://127.0.0.1:1/steal'); res.end(); });
  await assert.rejects(client.chat({ messages: [] }), /无法连接/);
  ai.set((req, res) => res.end(JSON.stringify({ choices: [{ message: { content: 'x'.repeat(1.2 * 1024 * 1024) } }] })));
  await assert.rejects(client.chat({ messages: [] }), /响应过大/);
});

test('the key is never sent to a redirect target', async t => {
  const seen = [];
  const target = createServer((request, response) => { seen.push(request.headers.authorization); response.end('{}'); });
  await listenOnUsablePort(target);
  t.after(() => new Promise(resolve => { target.closeAllConnections(); target.close(resolve); }));
  const ai = await mockAI(t, (request, response) => { response.statusCode = 302; response.setHeader('Location', `http://127.0.0.1:${target.address().port}/x`); response.end(); });
  await assert.rejects(createAIClient({ settings: () => settingsFor(ai.baseUrl) }).chat({ messages: [] }), AIError);
  assert.deepEqual(seen, []);
});

test('AI settings merge keeps the key unless replaced, and refuses to reuse it for another server', () => {
  const current = { ...defaultAiSettings(), baseUrl: 'https://a.example.com/v1', apiKey: SECRET, model: 'm' };
  const kept = mergeAiSettings(current, { baseUrl: 'https://a.example.com/v1/', model: 'gpt', apiKey: '' });
  assert.equal(kept.apiKey, SECRET);
  assert.equal(kept.model, 'gpt');
  assert.equal(mergeAiSettings(current, { baseUrl: 'https://a.example.com/openai/v1' }).apiKey, SECRET, '同一服务器上换路径可以沿用 Key');
  assert.throws(() => mergeAiSettings(current, { baseUrl: 'https://evil.example.net/v1' }), /重新填写 API Key/);
  assert.equal(mergeAiSettings(current, { baseUrl: 'https://b.example.com/v1', apiKey: ' sk-new-key ' }).apiKey, 'sk-new-key');
  assert.equal(mergeAiSettings(current, { clearApiKey: true }).apiKey, '');
  for (const bad of [{ apiKey: 'has space' }, { apiKey: '密钥' }, { temperature: 3 }, { maxTokens: 5 }, { timeoutSec: 500 }, { model: 'a\nb' }, 'text']) assert.throws(() => mergeAiSettings(current, bad), Error, JSON.stringify(bad));
});

test('the public view reports whether a key is set but never contains it', () => {
  const view = publicAiSettings({ ...defaultAiSettings(), baseUrl: 'https://a.example.com/v1', apiKey: SECRET, model: 'm' });
  assert.equal(view.apiKeySet, true);
  assert.equal(view.apiKeyHint, '••••cdef');
  assert.equal(JSON.stringify(view).includes('SECRET'), false);
  assert.equal(JSON.stringify(view).includes('sk-test'), false);
  assert.equal(publicAiSettings({ ...defaultAiSettings(), apiKey: 'short' }).apiKeyHint, '••••');
  assert.deepEqual(Object.keys(publicAiSettings(defaultAiSettings())).includes('apiKey'), false);
  assert.equal(publicAiSettings(defaultAiSettings()).apiKeySet, false);
});

test('the UI ad is validated: https/http links only, optional text when off, no javascript: links', () => {
  const ads = defaultAds();
  assert.equal(ads.enabled, true);
  assert.match(ads.text, /zelix.asia/);
  assert.equal(ads.url, 'https://zelix.asia');
  assert.deepEqual(normalizeAds({ text: '  自家的推广  ', url: ' https://example.com/x ' }), { enabled: true, text: '自家的推广', url: 'https://example.com/x' });
  assert.deepEqual(normalizeAds({ enabled: false, text: '', url: '' }), { enabled: false, text: '', url: '' }, '关闭时文案和链接都可以清空');
  assert.deepEqual(normalizeAds(undefined), ads);
  for (const bad of [{ text: '长'.repeat(301) }, { enabled: 'yes' }, { enabled: true, text: ' ' }, { url: 'javascript:alert(1)' }, { url: 'data:text/html,x' }, { url: 'ftp://example.com' },
    { url: 'https://user:pass@example.com' }, { url: 'not a url' }, { url: 'https://example.com/' + 'a'.repeat(200) }, { text: 5 }, 'x', []]) {
    assert.throws(() => normalizeAds(bad), Error, JSON.stringify(bad));
  }
});
