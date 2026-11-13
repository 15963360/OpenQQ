import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { modelReply, runBot } from '../examples/bot.mjs';

test('model example calls only the configured endpoint and validates its response', async t => {
  let received;
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    received = { auth: req.headers.authorization, body: JSON.parse(body) };
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: '模拟模型回答' } }] }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  const reply = await modelReply('你好', { BOT_API_URL: 'http://127.0.0.1:' + server.address().port, BOT_API_KEY: 'fixture-key', BOT_MODEL: 'fixture-model' });
  assert.equal(reply, '模拟模型回答'); assert.equal(received.auth, 'Bearer fixture-key'); assert.equal(received.body.messages[0].content, '你好');
  assert.match(await modelReply('x', {}), /BOT_API_URL/);
});

test('example bot responds only to explicit private commands through a mock OneBot server', async t => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await once(server, 'listening');
  t.after(() => new Promise(resolve => { for (const ws of server.clients) ws.terminate(); server.close(resolve); }));
  const joined = once(server, 'connection'); const stop = runBot({ ONEBOT_URL: 'ws://127.0.0.1:' + server.address().port, ONEBOT_TOKEN: 'fixture-token' }); t.after(stop);
  const [socket, request] = await joined; assert.equal(request.headers.authorization, 'Bearer fixture-token');
  const response = once(socket, 'message');
  socket.send(JSON.stringify({ post_type: 'message', message_type: 'private', self_id: 1, user_id: 2, message_id: 123, message: [{ type: 'text', data: { text: '/ping' } }] }));
  const [data] = await response; const action = JSON.parse(data.toString());
  assert.equal(action.action, 'send_private_msg'); assert.equal(action.params.user_id, 2); assert.equal(action.params.message, 'pong');
});
