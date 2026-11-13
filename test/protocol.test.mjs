import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFuses } from '../src/qq.mjs';
import { createMessageConverter } from '../src/onebot.mjs';

const self = { uin: '123456' };
const message = () => ({ chatType: 1, msgId: '9007199254740993', peerUid: 'u_other', peerUin: '654321',
  senderUin: '654321', msgTime: '1794470400', sendNickName: '测试',
  elements: [{ elementType: 1, textElement: { content: '[CQ:at,qq=all]&', atType: 0 } }] });

test('reads the fuse wire without modifying the binary and rejects corrupt data', () => {
  const bytes = Buffer.concat([Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'), Buffer.from([1, 8]), Buffer.from('10110001')]);
  const before = Buffer.from(bytes);
  assert.deepEqual(readFuses(bytes), { wire: '10110001', runAsNode: true, nodeOptions: true, nodeCliInspect: true });
  assert.deepEqual(bytes, before);
  assert.throws(() => readFuses(Buffer.from('invalid')), /标记/);
  assert.throws(() => readFuses(bytes.subarray(0, -1)), /格式/);
});

test('converts literal text, escapes CQ-like content and deduplicates lossless native message IDs', () => {
  const convert = createMessageConverter();
  const event = convert(self, message());
  assert.equal(event.message_id, 1);
  assert.equal(event.message[0].data.text, '[CQ:at,qq=all]&');
  assert.equal(event.raw_message, '&#91;CQ:at,qq=all&#93;&amp;');
  assert.equal(event.sub_type, 'other');
  assert.equal(convert(self, message()), null);
  assert.equal(convert(self, { ...message(), msgId: '9007199254740992' }).message_id, 2);
});

test('converts group messages and skips self messages or unsupported chat types', () => {
  const convert = createMessageConverter();
  const group = convert(self, { ...message(), chatType: 2, peerUin: '987654' });
  assert.equal(group.group_id, 987654);
  assert.equal(group.sub_type, 'normal');
  assert.equal(convert(self, { ...message(), senderUin: self.uin }), null);
  assert.equal(convert(self, { ...message(), chatType: 100 }).sub_type, 'group');
  assert.equal(convert(self, { ...message(), chatType: 999 }), null);
});

test('preserves unsupported elements, converts mentions and rejects unsafe numeric identifiers', () => {
  const convert = createMessageConverter();
  assert.throws(() => convert(self, { ...message(), senderUin: 'u_not_a_qq_number' }), /标识/);
  assert.throws(() => convert({ uin: '9007199254740993' }, message()), /标识/);
  assert.equal(convert(self, { ...message(), elements: [{ elementType: 2 }] }).message[0].type, 'openqq_element');
  assert.equal(createMessageConverter()(self, { ...message(), elements: [{ elementType: 1, textElement: { content: '@all', atType: 1 } }] }).message[0].data.qq, 'all');
  assert.throws(() => convert(self, { ...message(), msgId: Number.MAX_SAFE_INTEGER + 1 }), /精度/);
});

test('a rejected group event does not consume its deduplication entry', () => {
  const convert = createMessageConverter();
  assert.throws(() => convert(self, { ...message(), chatType: 2, peerUin: 'invalid' }), /group_id/);
  assert.equal(convert(self, { ...message(), chatType: 2, peerUin: '987654' }).message_id, 1);
});

