import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { createConsole, describeEvent, describeNativeLine, segmentPreview } from '../src/console.mjs';
import { startCommandInput } from '../src/input.mjs';

const strip = text => text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
function sink(tty = true) {
  const stream = new PassThrough();
  stream.isTTY = tty;
  stream.columns = 100;
  stream.rows = 30;
  let text = '';
  stream.on('data', chunk => { text += chunk; });
  return { stream, read: () => text, reset: () => { text = ''; } };
}

test('pretty mode renders one readable line per message with a segment preview', () => {
  const out = sink();
  const view = createConsole({ stdout: out.stream, mode: 'pretty', color: false, timeZone: 'UTC' });
  view.event({ time: 1794470400, self_id: 1, post_type: 'message', message_type: 'group', sub_type: 'normal', message_id: 7, user_id: 222,
    group_id: 987654, sender: { user_id: 222, nickname: 'Nick', card: '名片' },
    message: [{ type: 'at', data: { qq: 'all' } }, { type: 'text', data: { text: ' 开会\n第二行' } }, { type: 'image', data: { file: 'a.png' } }] });
  const lines = out.read().split('\n');
  assert.match(lines[0], /^08:00:00 {2} 群聊 {2}群 987654 · 名片\(222\) #7$/);
  assert.equal(lines[1].trim(), '@全体成员 开会');
  assert.equal(lines[2].trim(), '第二行[图片]');
});

test('json mode keeps the OneBot JSON Lines contract on stdout and diagnostics on stderr', () => {
  const out = sink(false);
  const err = sink(false);
  const view = createConsole({ stdout: out.stream, stderr: err.stream, mode: 'json' });
  const event = { time: 1, self_id: 1, post_type: 'notice', notice_type: 'friend_add', user_id: 2 };
  view.event(event);
  view.action({ action: 'get_status' }, { status: 'ok', retcode: 0, data: null }, 'terminal');
  view.action({ action: 'get_status' }, { status: 'ok', retcode: 0, data: null }, 'webui');
  view.diagnostic({ type: 'sync_state', syncing: false });
  view.native('QQ internal log line');
  view.native('[OpenQQ/native] {"stage":"bootstrapped","pid":3}');
  assert.deepEqual(out.read().trim().split('\n').map(line => JSON.parse(line)), [event, { status: 'ok', retcode: 0, data: null }]);
  assert.equal(err.read(), '[OpenQQ] {"type":"sync_state","syncing":false}\n[OpenQQ/native] {"stage":"bootstrapped","pid":3}\n');
});

test('debug output and raw QQ logs stay hidden until /verbose', () => {
  const out = sink();
  const view = createConsole({ stdout: out.stream, mode: 'pretty', color: false });
  view.native('[OpenQQ/native] {"stage":"addon_register","name":"x","owner":"x.node","target":false}');
  view.native('[Electron] noisy QQ log');
  view.diagnostic({ type: 'native_callback', source: 'msg', event: 'onFoo', argument_shapes: ['string'] });
  assert.equal(out.read(), '');
  assert.equal(view.takeHidden(), 3);
  view.toggleVerbose();
  view.native('[Electron] noisy QQ log');
  assert.match(out.read(), /QQ │ \[Electron\] noisy QQ log/);
  assert.deepEqual(describeNativeLine('[OpenQQ/native] {"stage":"addon_register","name":"QQNT","target":true}')[0], 'ok');
});

test('notices, requests and receipts are described in plain Chinese', () => {
  assert.equal(describeEvent({ post_type: 'notice', notice_type: 'group_ban', group_id: 9, user_id: 5, operator_id: 6, duration: 600, sub_type: 'ban' })[2], '群 9 · 5 被禁言 10 分钟（操作者 6）');
  assert.equal(describeEvent({ post_type: 'notice', notice_type: 'notify', sub_type: 'poke', user_id: 1, target_id: 2 })[2], '1 戳了戳 2');
  assert.equal(describeEvent({ post_type: 'request', request_type: 'friend', user_id: 3, comment: '你好' })[3], '「你好」');
  assert.equal(segmentPreview({ type: 'face', data: { id: '14' } }), '[表情14]');
  const out = sink();
  const view = createConsole({ stdout: out.stream, mode: 'pretty', color: false });
  view.action({ action: 'send_group_msg', params: { group_id: 42, message: 'x' } }, { status: 'failed', retcode: 1502, data: null, message: '未就绪' });
  assert.match(out.read(), / 失败 {2}发送群聊 → 群 42\n {12}\[1502\] 未就绪/);
});

test('output printed while typing is placed above the prompt and the typed text is restored', async t => {
  // Node deliberately skips terminal redraw when the runner advertises TERM=dumb.
  const previousTerm = process.env.TERM;
  process.env.TERM = 'xterm';
  t.after(() => { if (previousTerm === undefined) delete process.env.TERM; else process.env.TERM = previousTerm; });
  const input = sink();
  input.stream.setRawMode = () => {};
  const out = sink();
  const view = createConsole({ stdout: out.stream, mode: 'pretty', color: false });
  const commands = startCommandInput({ input: input.stream, output: out.stream, terminal: true, prompt: '› ',
    dispatch: async () => ({ status: 'ok', retcode: 0, data: null }), onQuit: () => {}, respond: () => {} });
  view.attach(commands.reader);
  input.stream.write('/private 123 半句话');
  await new Promise(resolve => setImmediate(resolve));
  out.reset();
  view.event({ time: 1, self_id: 1, post_type: 'notice', notice_type: 'friend_add', user_id: 2 });
  const screen = strip(out.read());
  assert.ok(screen.indexOf('新增好友 2') < screen.lastIndexOf('› /private 123 半句话'), screen);
  assert.equal(commands.reader.line, '/private 123 半句话');
  commands.close();
  await commands.done;
});
