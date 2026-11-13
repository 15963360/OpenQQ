import WebSocket from 'ws';
import { pathToFileURL } from 'node:url';

export async function modelReply(prompt, env = process.env) {
  if (!env.BOT_API_URL || !env.BOT_API_KEY || !env.BOT_MODEL) return '请在 Bot 进程设置 BOT_API_URL、BOT_API_KEY 和 BOT_MODEL。';
  const url = new URL(env.BOT_API_URL);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('模型接口 URL 无效');
  const response = await fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { Authorization: 'Bearer ' + env.BOT_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: env.BOT_MODEL, messages: [{ role: 'user', content: prompt }], max_tokens: 512 }) });
  if (!response.ok) throw new Error('模型接口 HTTP ' + response.status);
  const value = await response.json();
  const text = value.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('模型没有返回文本');
  return text.slice(0, 4000);
}

export function runBot(env = process.env) {
  if (!env.ONEBOT_TOKEN) throw new Error('请设置 ONEBOT_TOKEN（从 WebUI 接入配置复制）');
  const address = env.ONEBOT_URL || 'ws://127.0.0.1:3001/';
  const allowed = new Set((env.BOT_ALLOW_USERS || '').split(',').map(v => v.trim()).filter(Boolean));
  const recent = new Set();
  let socket;
  let timer;
  let stopped = false;
  let busy = false;
  let sequence = 0;
  function connect() {
    socket = new WebSocket(address, { headers: { Authorization: 'Bearer ' + env.ONEBOT_TOKEN }, maxPayload: 1024 * 1024, handshakeTimeout: 10000, followRedirects: false });
    socket.on('open', () => console.log('Bot 已连接 OneBot，私聊发送 /ping 可测试；/ai 问题 调用模型。'));
    socket.on('error', () => console.error('OneBot 连接失败，请检查地址、令牌和服务状态。'));
    socket.on('close', () => { if (!stopped) timer = setTimeout(connect, 3000); });
    socket.on('message', async data => {
      let event; try { event = JSON.parse(data.toString()); } catch { return; }
      if ('retcode' in event) { console.log('动作回执', event.echo, event.status, event.retcode); return; }
      if (event.post_type !== 'message' || event.message_type !== 'private' || event.user_id === event.self_id || busy) return;
      const text = (Array.isArray(event.message) ? event.message : []).filter(s => s.type === 'text').map(s => s.data.text).join('').trim();
      if (text !== '/ping' && !text.startsWith('/ai ')) return;
      const key = `${event.self_id}:${event.message_id}`;
      if (recent.has(key)) return;
      recent.add(key); if (recent.size > 1000) recent.delete(recent.values().next().value);
      const connection = socket;
      busy = true;
      try {
        let reply = 'pong';
        if (text.startsWith('/ai ')) {
          if (!allowed.has(String(event.user_id))) return;
          reply = await modelReply(text.slice(4, 4004), env);
        }
        if (connection.readyState === WebSocket.OPEN) connection.send(JSON.stringify({ action: 'send_private_msg',
          params: { user_id: event.user_id, message: reply, auto_escape: true }, echo: 'bot-' + ++sequence }));
      } catch (error) { console.error(error.message); }
      finally { busy = false; }
    });
  }
  connect();
  return () => { stopped = true; clearTimeout(timer); socket?.terminate(); };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const stop = runBot();
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
