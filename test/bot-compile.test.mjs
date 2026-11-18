import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileProgram, CompileError, programLimits } from '../src/bot/compile.mjs';
import { blockDefinitions, blockKind } from '../src/bot/blocks.mjs';
import { templates } from '../src/bot/templates.mjs';
import { b, text, info, stack, program } from './bot-support.mjs';

test('every built-in template compiles and every block definition has a unique type and valid kind', () => {
  for (const template of templates) {
    const { hats, warnings } = compileProgram(template.program());
    assert.ok(hats.length >= 1, template.id);
    assert.deepEqual(warnings, [], template.id);
  }
  const types = blockDefinitions.map(definition => definition.type);
  assert.equal(new Set(types).size, types.length);
  for (const definition of blockDefinitions) {
    assert.match(definition.type, /^oq_[a-z_]+$/);
    assert.ok(['hat', 'statement', 'value'].includes(blockKind(definition)));
    // %1..%n 占位符必须和 args0 一一对应，否则 Blockly 会拒绝这个积木。
    const placeholders = [...definition.message0.matchAll(/%(\d+)/g)].map(match => Number(match[1]));
    assert.deepEqual(placeholders.sort((x, y) => x - y), (definition.args0 ?? []).map((_, index) => index + 1), definition.type);
  }
});

test('compile flattens statement chains, fills defaults and falls back to shadows', () => {
  const state = program(stack(0, 0, b('oq_on_keyword', { SCOPE: 'group', MODE: 'equals', TEXT: 'hi' }),
    b('oq_if', {}, { COND: b('oq_event_flag', { FLAG: 'mentioned' }) }),
    b('oq_reply', { AT: true })));
  // DO 里放两块语句：第二块通过 next 连接。
  state.blocks.blocks[0].next.block.inputs.DO = { block: { type: 'oq_reply', next: { block: { type: 'oq_stop' } }, inputs: { TEXT: { shadow: { type: 'oq_text', fields: { TEXT: '默认值' } } } } } };
  const { hats } = compileProgram(state);
  assert.equal(hats.length, 1);
  assert.deepEqual(hats[0].fields, { SCOPE: 'group', MODE: 'equals', TEXT: 'hi' });
  const [ifNode, reply] = hats[0].body;
  assert.equal(ifNode.type, 'oq_if');
  assert.deepEqual(ifNode.inputs.DO.map(node => node.type), ['oq_reply', 'oq_stop']);
  assert.equal(ifNode.inputs.DO[0].inputs.TEXT.fields.TEXT, '默认值');
  assert.equal(ifNode.inputs.COND.fields.FLAG, 'mentioned');
  assert.deepEqual(reply.fields, { AT: true, QUOTE: false });
  assert.equal(reply.inputs.TEXT, null);
});

test('compile resolves variables by id and rejects unknown ones', () => {
  const state = program(stack(0, 0, b('oq_on_message'), b('oq_var_set', { VAR: { id: 'v1' } }, { VALUE: text('x') })));
  assert.throws(() => compileProgram(state), /不存在的变量/);
  state.variables = [{ id: 'v1', name: '计数' }];
  assert.equal(compileProgram(state).hats[0].body[0].fields.VAR, '计数');
  state.variables = [{ id: 'v1', name: ' ' }];
  assert.throws(() => compileProgram(state), /变量名/);
});

test('compile rejects unknown blocks, bad field values, wrong placement and malformed input', () => {
  const bad = state => assert.throws(() => compileProgram(state), CompileError);
  bad('not an object');
  bad(program({ type: 'evil_block' }));
  bad(program(b('oq_on_keyword', { SCOPE: 'everywhere' })));
  bad(program(b('oq_on_keyword', { TEXT: 5 })));
  bad(program(b('oq_on_keyword', { TEXT: 'x'.repeat(programLimits.text + 1) })));
  bad(program(b('oq_on_message', {}, {}, b('oq_text'))));                                    // 值积木接在语句位置
  bad(program(stack(0, 0, b('oq_on_message'), b('oq_reply', {}, { TEXT: b('oq_stop') }))));  // 语句积木放进值输入口
  bad(program(stack(0, 0, b('oq_on_message'), b('oq_reply', { AT: 'yes' }))));
  bad(program(stack(0, 0, b('oq_on_message'), b('oq_repeat', {}, { TIMES: b('oq_number', { NUM: 'abc' }) }))));
  bad({ blocks: { blocks: 'x' } });
  // 带原型污染字样的字段名不会影响结果：只读取定义里声明的字段。
  const polluted = compileProgram(program(stack(0, 0, b('oq_on_message', { SCOPE: 'any', __proto__x: 1 }), b('oq_stop'))));
  assert.equal(Object.getPrototypeOf(polluted.hats[0].fields), Object.prototype);
});

test('compile enforces block, depth, stack and size limits', () => {
  const wide = program(stack(0, 0, b('oq_on_message'), ...Array.from({ length: 601 }, () => b('oq_stop'))));
  assert.throws(() => compileProgram(wide), /最多 600 块/);
  let nested = b('oq_text', { TEXT: 'x' });
  for (let index = 0; index < programLimits.depth + 2; index++) nested = b('oq_join', {}, { A: nested, B: text('y') });
  assert.throws(() => compileProgram(program(stack(0, 0, b('oq_on_message'), b('oq_reply', {}, { TEXT: nested })))), /嵌套太深/);
  assert.throws(() => compileProgram(program(...Array.from({ length: 41 }, () => b('oq_on_message')))), /积木堆最多/);
  assert.throws(() => compileProgram(program(stack(0, 0, b('oq_on_message'), b('oq_reply', {}, { TEXT: text('字'.repeat(1900)) })), ...Array.from({ length: 60 }, () => b('oq_reply', {}, { TEXT: text('字'.repeat(1900)) })))), /KiB|块/);
});

test('compile skips disabled blocks and warns about orphans and empty triggers', () => {
  const state = program(
    stack(0, 0, b('oq_on_message'), b('oq_reply', {}, { TEXT: text('保留') }), b('oq_reply', {}, { TEXT: text('停用') })),
    b('oq_reply'),
    b('oq_on_mention'),
  );
  state.blocks.blocks[0].next.block.next.block.disabledReasons = ['MANUAL_DISABLE'];
  const { hats, warnings } = compileProgram(state);
  assert.equal(hats.length, 2);
  assert.equal(hats[0].body.length, 1);
  assert.equal(warnings.length, 2);
  assert.match(warnings.join(), /没有接在触发积木下面/);
  assert.match(warnings.join(), /下面没有积木/);
  assert.deepEqual(compileProgram(null), { hats: [], warnings: [], blocks: 0 });
  assert.deepEqual(compileProgram(program(stack(0, 0, b('oq_on_message'), b('oq_reply', {}, { TEXT: info('text') })))).hats[0].body[0].inputs.TEXT, { type: 'oq_event_info', fields: { FIELD: 'text' }, inputs: {} });
});
