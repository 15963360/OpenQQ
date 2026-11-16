import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import WebSocket, { WebSocketServer } from 'ws';
import { imageInfo, safeName } from './media.mjs';

const DEFAULT_MAX_PAYLOAD = 48 * 1024 * 1024;
const MAX_MEDIA_ENTRIES = 1000;
const IMAGE_MIME = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };

function parseMediaBase(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    return parsed.origin + parsed.pathname.replace(/\/+$/, '');
  } catch { return null; }
}

async function sniffMime(filePath) {
  let handle;
  try {
    handle = await open(filePath, 'r');
    const buf = Buffer.alloc(65536);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    const info = imageInfo(buf.subarray(0, bytesRead));
    return info ? IMAGE_MIME[info.format] ?? 'application/octet-stream' : 'application/octet-stream';
  } catch {
    return 'application/octet-stream';
  } finally {
    await handle?.close().catch(() => {});
  }
}

function extractToken(request, url) {
  const header = request.headers.authorization;
  if (header !== undefined) {
    const match = header.match(/^Bearer\s+(.+)$/i);
    return match ? match[1] : '';
  }
  return url.searchParams.get('access_token') ?? '';
}

export async function startOneBot({ config, dispatch, onStatus = () => {}, maxPayload = DEFAULT_MAX_PAYLOAD,
  mediaBaseUrl = process.env.OPENQQ_MEDIA_BASE_URL } = {}) {
  const peers = new Map();
  const reverse = config.reverseWs.filter(item => item.enabled).map(item => ({ ...item, state: 'waiting', socket: null, timer: null }));
  const authFailures = new Map();
  const mediaMap = new Map();
  const mediaByPath = new Map();
  let state = { phase: 'starting' };
  let closed = false;
  let server;
  let wss;
  let address = null;
  let httpMediaOrigin = null;
  const ready = () => state.phase === 'session_ready' && state.syncing !== true && Number.isSafeInteger(Number(state.self_id)) && Number(state.self_id) > 0;
  const report = () => onStatus({ ws: { enabled: config.ws.enabled, address, clients: [...peers.values()].filter(p => !p.reverse).length },
    reverseWs: reverse.map((item, index) => ({ index, state: item.state })) });
  const meta = extra => ({ time: Math.floor(Date.now() / 1000), self_id: Number(state.self_id), post_type: 'meta_event', ...extra });
  function send(socket, value) {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 32 * 1024 * 1024) { socket.terminate(); return; }
    socket.send(JSON.stringify(value));
  }
  function mediaUrl(filePath, fileName) {
    if (!httpMediaOrigin || typeof filePath !== 'string' || !filePath) return null;
    let id = mediaByPath.get(filePath);
    if (id && mediaMap.has(id)) {
      const existing = mediaMap.get(id);
      mediaMap.delete(id);
      mediaMap.set(id, existing);
    } else {
      id = randomBytes(32).toString('hex');
      mediaMap.set(id, { path: filePath });
      mediaByPath.set(filePath, id);
      if (mediaMap.size > MAX_MEDIA_ENTRIES) {
        const [oldestId, oldest] = mediaMap.entries().next().value;
        mediaMap.delete(oldestId);
        if (mediaByPath.get(oldest.path) === oldestId) mediaByPath.delete(oldest.path);
      }
    }
    const name = safeName(fileName, basename(filePath) || 'media');
    return `${httpMediaOrigin}/openqq/media/${id}/${encodeURIComponent(name)}`;
  }
  function attach(socket, role, isReverse = false) {
    const peer = { role, reverse: isReverse, active: 0, announced: false, alive: true };
    peers.set(socket, peer);
    socket.on('error', () => {});
    socket.on('pong', () => { peer.alive = true; });
    socket.on('close', () => { peers.delete(socket); report(); });
    socket.on('message', async (data, binary) => {
      if (role === 'event') return;
      let request;
      try {
        if (binary) throw new Error();
        request = JSON.parse(data.toString());
        if (!request || typeof request !== 'object' || Array.isArray(request) || typeof request.action !== 'string') throw new Error();
      } catch { send(socket, { status: 'failed', retcode: 1400, data: null, message: '需要 JSON 动作对象' }); return; }
      const fail = (retcode, message) => ({ status: 'failed', retcode, data: null, message, ...(Object.hasOwn(request, 'echo') ? { echo: request.echo } : {}) });
      if (peer.active >= 8) { send(socket, fail(1503, '并发动作过多')); return; }
      if (!ready()) { send(socket, fail(1502, 'QQ 尚未就绪')); return; }
      peer.active++;
      try { send(socket, await dispatch(request)); }
      catch { send(socket, fail(1500, '动作执行异常')); }
      finally { peer.active--; }
    });
    announce(socket, peer);
    report();
  }
  function announce(socket, peer) {
    if (ready() && peer.role !== 'api' && !peer.announced) {
      send(socket, meta({ meta_event_type: 'lifecycle', sub_type: 'connect' })); peer.announced = true;
    }
  }
  function connect(item) {
    if (closed || !ready() || item.socket || item.timer) return;
    item.state = 'connecting'; report();
    const socket = new WebSocket(item.url, { headers: { 'X-Self-ID': String(state.self_id), 'X-Client-Role': 'Universal',
      ...(item.token ? { Authorization: 'Bearer ' + item.token } : {}) }, maxPayload, handshakeTimeout: 10000, followRedirects: false });
    item.socket = socket;
    socket.on('error', () => {});
    socket.once('open', () => { item.state = 'connected'; attach(socket, 'universal', true); });
    socket.once('close', () => {
      item.socket = null;
      if (closed || !ready()) { item.state = 'waiting'; report(); return; }
      item.state = 'reconnecting'; report();
      item.timer = setTimeout(() => { item.timer = null; connect(item); }, 3000);
    });
  }
  async function serveMedia(req, res) {
    if (!req.url || !req.url.startsWith('/') || req.url.startsWith('//')) { res.writeHead(400); res.end(); return; }
    let parsed;
    try { parsed = new URL(req.url, 'http://127.0.0.1'); } catch { res.writeHead(400); res.end(); return; }
    if (!parsed.pathname.startsWith('/openqq/media/')) { res.writeHead(426); res.end('OneBot v11: WebSocket required'); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    const match = parsed.pathname.match(/^\/openqq\/media\/([a-f0-9]{64})(?:\/[^/]*)?$/);
    if (!match) { res.writeHead(404); res.end(); return; }
    const entry = mediaMap.get(match[1]);
    if (!entry) { res.writeHead(404); res.end(); return; }
    let info;
    try { info = await stat(entry.path); } catch { info = null; }
    if (!info || !info.isFile()) { res.writeHead(404); res.end(); return; }
    const contentType = await sniffMime(entry.path);
    const headers = {
      'Content-Type': contentType,
      'Content-Length': String(info.size),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(contentType === 'application/octet-stream' ? { 'Content-Disposition': 'attachment' } : {}),
    };
    res.writeHead(200, headers);
    if (req.method === 'HEAD') { res.end(); return; }
    const stream = createReadStream(entry.path);
    stream.on('error', () => { if (!res.destroyed) res.destroy(); });
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }
  if (config.ws.enabled) {
    server = createServer((req, res) => {
      serveMedia(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); if (!res.writableEnded) res.end(); });
    });
    server.headersTimeout = 10000;
    server.requestTimeout = 30000;
    wss = new WebSocketServer({ noServer: true, maxPayload, perMessageDeflate: false });
    server.on('upgrade', (request, socket, head) => {
      socket.on('error', () => {});
      if (!request.url || !request.url.startsWith('/') || request.url.startsWith('//')) { socket.destroy(); return; }
      let url; try { url = new URL(request.url, 'http://127.0.0.1'); } catch { socket.destroy(); return; }
      const remote = request.socket.remoteAddress || 'unknown';
      const now = Date.now();
      const record = authFailures.get(remote);
      if (record && record.resetAt > now && record.count >= 20) {
        socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return;
      }
      const token = extractToken(request, url);
      const supplied = Buffer.from(token), expected = Buffer.from(config.accessToken);
      let code = 0;
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        code = 401;
        const entry = record && record.resetAt > now ? record : { count: 0, resetAt: now + 60000 };
        entry.count++;
        if (authFailures.size >= 1000) authFailures.delete(authFailures.keys().next().value);
        authFailures.set(remote, entry);
      } else {
        authFailures.delete(remote);
      }
      const path = url.pathname.replace(/\/$/, '') || '/';
      if (!['/', '/api', '/event'].includes(path)) code = code || 404;
      if (closed || wss.clients.size >= 32) code = code || 503;
      if (code) { socket.end(`HTTP/1.1 ${code} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); return; }
      wss.handleUpgrade(request, socket, head, ws => attach(ws, path === '/api' ? 'api' : path === '/event' ? 'event' : 'universal'));
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.ws.port, config.ws.host, resolve); });
    address = `ws://${config.ws.host === '0.0.0.0' ? '127.0.0.1' : config.ws.host}:${server.address().port}`;
    httpMediaOrigin = parseMediaBase(mediaBaseUrl) ?? `http://${config.ws.host === '0.0.0.0' ? '127.0.0.1' : config.ws.host}:${server.address().port}`;
  }
  const heartbeat = setInterval(() => {
    for (const [socket, peer] of peers) {
      if (!peer.alive) { socket.terminate(); continue; }
      peer.alive = false; socket.ping();
      if (Number(state.self_id) > 0 && peer.role !== 'api') send(socket, meta({ meta_event_type: 'heartbeat', interval: 15000, status: { online: ready(), good: ready() } }));
    }
  }, 15000);
  heartbeat.unref();
  report();
  return {
    mediaUrl,
    setStatus(next) {
      const previous = state;
      state = { ...next };
      for (const [socket, peer] of peers) {
        if (previous.self_id && String(previous.self_id) !== String(state.self_id)) { socket.terminate(); continue; }
        announce(socket, peer);
      }
      for (const item of reverse) {
        if (!ready() || (previous.self_id && String(previous.self_id) !== String(state.self_id))) {
          clearTimeout(item.timer); item.timer = null; item.state = 'waiting'; item.socket?.terminate();
        } else connect(item);
      }
      report();
    },
    broadcast(event) { for (const [socket, peer] of peers) if (peer.role !== 'api') send(socket, event); },
    async close() {
      closed = true; clearInterval(heartbeat);
      mediaMap.clear(); mediaByPath.clear();
      for (const item of reverse) { clearTimeout(item.timer); item.socket?.terminate(); }
      for (const socket of peers.keys()) socket.terminate();
      if (wss) await new Promise(resolve => wss.close(resolve));
      if (server) { const stopped = new Promise(resolve => server.close(resolve)); server.closeAllConnections(); await stopped; }
    },
  };
}
