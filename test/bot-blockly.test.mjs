import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileProgram } from '../src/bot/compile.mjs';
import { createBotStore, defaultAiSettings } from '../src/bot/store.mjs';
import { createBotEngine } from '../src/bot/engine.mjs';
import { createAIClient } from '../src/bot/ai.mjs';
import { mockAI, mention, onebotEvent } from './bot-support.mjs';

// 这份工作区 JSON 是浏览器里真实的 Blockly 编辑器序列化出来的（带 id、阴影积木、变量表），
// 用来保证服务端的校验/解释器能读懂编辑器实际保存的格式，而不只是测试里手写的 JSON。
const workspace = JSON.parse(readFileSync(new URL('./fixtures/blockly-workspace.json', import.meta.url), 'utf8'));

test('the workspace saved by the real Blockly editor compiles: variables, shadows and nested inputs', () => {
  const { hats, warnings, blocks } = compileProgram(workspace);
  assert.deepEqual(warnings, []);
  assert.deepEqual(hats.map(hat => hat.type), ['oq_on_command', 'oq_on_mention']);
  assert.equal(blocks, 17, '含阴影积木');
  const [change, ifElse] = hats[0].body;
  assert.equal(change.fields.VAR, '计数');
  assert.equal(change.inputs.DELTA.fields.NUM, 2);
  assert.equal(ifElse.inputs.COND.inputs.A.fields.VAR, '计数');
  assert.equal(ifElse.inputs.COND.inputs.B.fields.NUM, 3, '阴影积木作为默认值');
  assert.equal(ifElse.inputs.THEN[0].inputs.TEXT.type, 'oq_join');
});

test('the Blockly workspace runs end to end through the engine, including the mention → AI reply stack', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'openqq-blockly-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = createBotStore({ dir });
  const ai = await mockAI(t);
  store.writeAi({ ...defaultAiSettings(), baseUrl: ai.baseUrl, apiKey: 'sk-fixture-1234567890', model: 'm' });
  const sent = [];
  const engine = createBotEngine({ store, ai: createAIClient({ settings: () => store.readAi() }), memoryOptions: { saveDelay: -1 },
    dispatch: async request => { sent.push(request); return { status: 'ok', retcode: 0, data: {} }; } });
  t.after(() => engine.close());
  const bot = store.create({ name: '真实格式' });
  store.update(bot.id, { enabled: true, program: workspace, limits: { cooldownSeconds: 0 } });

  // /count：变量 0 + 2 = 2，不大于 3，走 ELSE 把「次数」记成 2（不回复）。
  await engine.handleEvent(onebotEvent({ message_type: 'private', group_id: undefined, message: [{ type: 'text', data: { text: '/count' } }] }));
  assert.equal(sent.length, 0);
  assert.equal(engine.memoryOf(bot.id).getNote('chat', 'p:20001', '次数'), '2');
  // @ 机器人：走 AI 回复。
  await engine.handleEvent(mention('你好', { group_id: 9 }));
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].params.message.map(segment => segment.type), ['reply', 'text']);
  assert.equal(sent[0].params.message[1].data.text, '答：小明：你好');
  assert.equal(engine.runsOf(bot.id).every(run => run.status === 'ok'), true);
});
