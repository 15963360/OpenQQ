import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundedHistory, describeEntry, describeLog, identifier, messageRequest } from '../ui/format.mjs';

test('UI messages preserve literal text and reject invalid recipients before posting', () => {
  assert.deepEqual(messageRequest({ targetType: 'group', target: ' 123456 ', message: '[CQ:at,qq=all]\n你好' }), {
    action: 'send_group_msg', params: { group_id: 123456, message: '[CQ:at,qq=all]\n你好', auto_escape: true },
  });
  for (const value of ['u_uid', '0', '1.5', '9007199254740993']) assert.throws(() => identifier(value));
  assert.throws(() => messageRequest({ targetType: 'private', target: 123, message: '你'.repeat(21846) }));
});

test('UI history stays bounded and keeps message, poke and action descriptions distinct', () => {
  const entries = Array.from({ length: 250 }, (_, id) => ({ id, data: { text: '测试' } }));
  assert.equal(boundedHistory(entries).length, 200);
  assert.equal(boundedHistory(entries)[0].id, 50);
  assert.equal(describeEntry({ kind: 'event', data: { post_type: 'notice', sub_type: 'poke', user_id: 1, target_id: 2 } }).text, '1 戳了戳 2');
  assert.equal(describeEntry({ kind: 'action', data: { request: { action: 'send_group_msg' }, response: { status: 'failed', message: '未就绪' } } }).failed, true);
});

test('Bot run diagnostics are readable in the logs and flagged as failures only when they errored', () => {
  const error = { kind: 'diagnostic', data: { type: 'bot_run', status: 'error', botName: '小鱼', error: 'AI 接口返回 HTTP 401' } };
  assert.deepEqual(describeLog(error), { level: 'error', message: 'Bot「小鱼」运行出错：AI 接口返回 HTTP 401' });
  assert.equal(describeEntry(error).failed, true);
  const limited = { kind: 'diagnostic', data: { type: 'bot_run', status: 'limited', botName: '小鱼', error: '发送太频繁' } };
  assert.equal(describeLog(limited).level, 'warn');
  assert.equal(describeEntry(limited).failed, false);
});
