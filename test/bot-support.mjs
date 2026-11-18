// Bot 测试共用的工具：本地模拟的 OpenAI 兼容服务、事件构造、模拟服务。本文件自身不含测试。
import { createServer } from 'node:http';
import { build } from '../src/bot/templates.mjs';
import { compileProgram } from '../src/bot/compile.mjs';
import { normalizeEvent } from '../src/bot/trigger.mjs';

export const { b, text, info, stack, program } = build;
export const hatOf = (...blocks) => compileProgram(program(...blocks)).hats[0];

// fetch() 会拒绝一批「危险端口」（6000、6665–6669、10080……）。有的机器把临时端口范围设得很低，随机端口可能正好落在里面，
// 所以需要随机端口的测试要换一个端口重试，否则偶尔会失败。
const badPorts = new Set([1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139,
  143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190,
  5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080]);
export async function withUsablePort(start) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const value = await start();
    if (!badPorts.has(value.port)) return value;
    await value.stop();
  }
  throw new Error('找不到 fetch 允许访问的端口');
}

/** 本地模拟的 OpenAI 兼容接口：记录所有请求，默认回答「答：」加最后一条用户消息。 */
export async function mockAI(t, handler) {
  const requests = [];
  const state = { handler: handler ?? ((request, response) => {
    if (request.method === 'GET' && request.url.endsWith('/models')) return response.end(JSON.stringify({ data: [{ id: 'm-b' }, { id: 'm-a' }, { id: 'm-a' }] }));
    const last = request.body.messages?.at(-1)?.content ?? '';
    response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '答：' + last } }] }));
  }) };
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { body = undefined; }
      const entry = { method: request.method, url: request.url, headers: request.headers, body };
      requests.push(entry);
      response.setHeader('Content-Type', 'application/json');
      state.handler({ ...entry, headers: request.headers }, response, requests);
    });
  });
  await listenOnUsablePort(server);
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, origin: `http://127.0.0.1:${server.address().port}`, requests, set: handler => { state.handler = handler; } };
}

/** 让 http.Server 监听一个 fetch 允许访问的随机端口。 */
export async function listenOnUsablePort(server) {
  await withUsablePort(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { port: server.address().port, stop: () => new Promise(resolve => server.close(resolve)) };
  });
  return server;
}

export function onebotEvent(overrides = {}) {
  const base = { post_type: 'message', message_type: 'group', self_id: 10000, user_id: 20001, group_id: 30001, message_id: 7, time: undefined,
    message: [{ type: 'text', data: { text: '你好' } }], sender: { user_id: 20001, nickname: '小明', card: '' } };
  return { ...base, ...overrides };
}
export const mention = (message, overrides = {}) => onebotEvent({ message: [{ type: 'at', data: { qq: '10000' } }, { type: 'text', data: { text: ' ' + message } }], ...overrides });
export const event = (overrides = {}) => normalizeEvent(onebotEvent(overrides));

/** 解释器用的模拟服务：消息收集在 sent，时间由 clock.time 控制。 */
export function fakeServices(overrides = {}) {
  const sent = [];
  const clock = { time: 0 };
  const notes = new Map();
  const services = {
    now: () => new Date(clock.time), random: () => 0.5,
    send: async ({ target, segments }) => { sent.push({ target, segments }); },
    ai: { ask: async ({ prompt }) => '答：' + prompt },
    ads: { wrap: body => body },
    memory: {
      get: (scope, key) => notes.get(scope + ':' + key) ?? '',
      set: (scope, key, value) => { notes.set(scope + ':' + key, value); },
      forget: (scope, key) => { notes.delete(scope + ':' + key); },
      clearChat: () => { for (const key of [...notes.keys()]) if (key.startsWith('chat:')) notes.delete(key); },
    },
    ...overrides,
  };
  return { services, sent, clock, notes };
}
