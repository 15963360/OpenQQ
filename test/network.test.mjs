import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';
import { defaultConfig } from '../src/config.mjs';
import { startOneBot } from '../src/network.mjs';

function inbox(socket) {
  const queue = [], waiters = [];
  socket.on('message', data => { const item = JSON.parse(data.toString()); if (waiters.length) waiters.shift()(item); else queue.push(item); });
  return () => queue.length ? Promise.resolve(queue.shift()) : new Promise(resolve => waiters.push(resolve));
}
async function fixture(t, dispatch) {
  const config = defaultConfig(); config.ws.port = 0;
  let state;
  const requests = [];
  const network = await startOneBot({ config, dispatch: dispatch ?? (async request => { requests.push(request); return { status: 'ok', retcode: 0, data: { message_id: 123 }, echo: request.echo }; }), onStatus: value => { state = value; } });
  t.after(() => network.close());
  return { network, config, address: state.ws.address, requests };
}
async function client(t, address, token, path = '/') {
  const socket = new WebSocket(address + path, { headers: { Authorization: 'Bearer ' + token } });
  t.after(() => socket.terminate()); const next = inbox(socket);
  await once(socket, 'open'); return { socket, next };
}

test('forward WS authenticates, gates offline actions, preserves echo and broadcasts events', async t => {
  const { network, address, config, requests } = await fixture(t);
  const bad = new WebSocket(address); bad.on('error', () => {});
  const [, response] = await once(bad, 'unexpected-response'); response.resume(); assert.equal(response.statusCode, 401);
  bad.terminate();
  const { socket, next } = await client(t, address, config.accessToken);
  socket.send(JSON.stringify({ action: 'get_status', echo: 0 }));
  assert.deepEqual(await next(), { status: 'failed', retcode: 1502, data: null, message: 'QQ 尚未就绪', echo: 0 });
  assert.equal(requests.length, 0);
  network.setStatus({ phase: 'session_ready', self_id: 12345 });
  assert.equal((await next()).meta_event_type, 'lifecycle');
  socket.send('{'); assert.equal((await next()).retcode, 1400);
  const action = { action: 'send_private_msg', params: { user_id: 44, message: 'test' }, echo: { '中文': [1] } };
  socket.send(JSON.stringify(action)); assert.deepEqual((await next()).echo, action.echo); assert.deepEqual(requests, [action]);
  const event = { post_type: 'message', self_id: 12345, message: [{ type: 'text', data: { text: '中文' } }] };
  network.broadcast(event); assert.deepEqual(await next(), event);
});

test('API and event paths have separate roles and query tokens work', async t => {
  const { network, address, config } = await fixture(t);
  network.setStatus({ phase: 'session_ready', self_id: 12345 });
  const api = await client(t, address, config.accessToken, '/api/');
  const eventSocket = new WebSocket(address + '/event/?access_token=' + config.accessToken);
  t.after(() => eventSocket.terminate()); const eventNext = inbox(eventSocket); await once(eventSocket, 'open');
  assert.equal((await eventNext()).sub_type, 'connect');
  network.broadcast({ post_type: 'notice', notice_type: 'friend_add' });
  api.socket.send('{"action":"get_status","echo":false}');
  assert.equal((await api.next()).echo, false);
  assert.equal((await eventNext()).post_type, 'notice');
});

test('heartbeat reports online status and switches to offline without leaking configuration', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { network, address, config } = await fixture(t);
  network.setStatus({ phase: 'session_ready', self_id: 12345 });
  const { socket, next } = await client(t, address, config.accessToken); await next();
  t.mock.timers.tick(15000);
  const beat = await next(); assert.equal(beat.meta_event_type, 'heartbeat'); assert.equal(beat.interval, 15000); assert.deepEqual(beat.status, { online: true, good: true });
  // An action round trip also guarantees that the preceding pong reached the server.
  socket.send('{"action":"get_status","echo":"heartbeat-barrier"}');
  assert.equal((await next()).echo, 'heartbeat-barrier');
  network.setStatus({ phase: 'offline', self_id: 12345 });
  t.mock.timers.tick(15000);
  assert.deepEqual((await next()).status, { online: false, good: false });
  assert.equal(JSON.stringify(beat).includes(config.accessToken), false);
});

test('forward WS bounds action concurrency and rejects oversized frames', async t => {
  const complete = [];
  const { network, address, config } = await fixture(t, req => new Promise(resolve => complete.push(() => resolve({ status: 'ok', retcode: 0, data: null, echo: req.echo }))));
  network.setStatus({ phase: 'session_ready', self_id: 12345 });
  const { socket, next } = await client(t, address, config.accessToken); await next();
  for (let i = 0; i < 9; i++) socket.send(JSON.stringify({ action: 'get_status', echo: i }));
  const rejected = await next(); assert.equal(rejected.retcode, 1503); assert.equal(rejected.echo, 8); assert.equal(complete.length, 8);
  complete.forEach(resolve => resolve()); for (let i = 0; i < 8; i++) assert.equal((await next()).status, 'ok');
  const closed = once(socket, 'close'); socket.send('x'.repeat(256 * 1024 + 1)); assert.equal((await closed)[0], 1009);
});

test('reverse WS waits for account, sends auth headers, dispatches and reconnects without replay', async t => {
  const bot = new WebSocketServer({ port: 0, host: '127.0.0.1' }); await once(bot, 'listening');
  t.after(() => new Promise(resolve => { for (const ws of bot.clients) ws.terminate(); bot.close(resolve); }));
  const config = defaultConfig(); config.ws.enabled = false;
  config.reverseWs = [{ enabled: true, url: 'ws://127.0.0.1:' + bot.address().port + '/onebot', token: 'robot-secret' }];
  const network = await startOneBot({ config, dispatch: async req => ({ status: 'ok', retcode: 0, data: null, echo: req.echo }) });
  t.after(() => network.close());
  assert.equal(bot.clients.size, 0);
  let joined = once(bot, 'connection'); network.setStatus({ phase: 'session_ready', self_id: 87654 });
  const [socket, req] = await joined; const next = inbox(socket);
  assert.equal(req.headers['x-self-id'], '87654'); assert.equal(req.headers['x-client-role'], 'Universal'); assert.equal(req.headers.authorization, 'Bearer robot-secret');
  assert.equal((await next()).sub_type, 'connect');
  socket.send('{"action":"get_status","echo":"reverse"}'); assert.equal((await next()).echo, 'reverse');
  joined = once(bot, 'connection'); socket.terminate();
  const [second] = await joined; const next2 = inbox(second); assert.equal((await next2()).sub_type, 'connect');
  network.broadcast({ post_type: 'notice', notice_type: 'friend_add' }); assert.equal((await next2()).post_type, 'notice');
});
