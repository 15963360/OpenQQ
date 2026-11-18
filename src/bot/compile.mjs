// 把 WebUI 里 Blockly 保存的工作区 JSON 编译成经过校验的 AST。
// 保存程序和运行程序之前都必须经过这里：只认 blocks.mjs 里定义的积木，只认定义里允许的字段取值，
// 并限制积木数量、嵌套深度和字符串长度。解释器只执行这里的输出，从不直接读取不可信的 JSON。
import { blockTypes, blockKind } from './blocks.mjs';

export const programLimits = { blocks: 600, depth: 24, text: 2000, stacks: 40, variables: 100, bytes: 200 * 1024 };

export class CompileError extends Error {
  constructor(message) { super(message); this.name = 'CompileError'; }
}

const fail = message => { throw new CompileError(message); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isDisabled = raw => raw.enabled === false || (Array.isArray(raw.disabledReasons) && raw.disabledReasons.length > 0);

export const emptyProgram = () => ({ blocks: { languageVersion: 0, blocks: [] }, variables: [] });

/**
 * @param {unknown} state Blockly 序列化后的工作区：{ blocks: { blocks: [...] }, variables: [{ id, name }] }
 * @returns {{ hats: { type: string, fields: object, body: object[] }[], warnings: string[], blocks: number }}
 *   节点形如 { type, fields: { 字段名: 值 }, inputs: { 输入名: 节点 | 节点数组 | null } }；
 *   语句输入口（以及触发积木的 body）是已经展平的数组，值输入口是单个节点，没有接积木时为 null。
 */
export function compileProgram(state, limits = programLimits) {
  if (state === null || state === undefined) return { hats: [], warnings: [], blocks: 0 };
  if (!isObject(state)) fail('积木程序格式无效');
  if (Buffer.byteLength(JSON.stringify(state)) > limits.bytes) fail(`积木程序超过 ${limits.bytes / 1024} KiB，请精简`);
  const rawVariables = state.variables ?? [];
  if (!Array.isArray(rawVariables) || rawVariables.length > limits.variables) fail(`变量最多 ${limits.variables} 个`);
  const variables = new Map();
  for (const item of rawVariables) {
    if (!isObject(item) || typeof item.id !== 'string' || typeof item.name !== 'string') fail('变量定义无效');
    const name = item.name.trim();
    if (!name || name.length > 40) fail('变量名需要 1–40 个字符');
    variables.set(item.id, name);
  }
  const top = state.blocks === undefined ? [] : state.blocks?.blocks ?? [];
  if (!Array.isArray(top)) fail('积木列表格式无效');
  if (top.length > limits.stacks) fail(`积木堆最多 ${limits.stacks} 个`);

  let count = 0;
  const warnings = [];

  function field(arg, raw, type) {
    const value = raw?.fields?.[arg.name];
    switch (arg.type) {
      case 'field_dropdown': {
        const allowed = arg.options.map(option => option[1]);
        const chosen = value === undefined ? allowed[0] : value;
        if (!allowed.includes(chosen)) fail(`积木「${type}」的「${arg.name}」取值无效`);
        return chosen;
      }
      case 'field_input': {
        const chosen = value === undefined ? arg.text ?? '' : value;
        if (typeof chosen !== 'string') fail(`积木「${type}」的「${arg.name}」必须是文字`);
        if (chosen.length > limits.text) fail(`文字太长（最多 ${limits.text} 个字符）`);
        return chosen;
      }
      case 'field_number': {
        const chosen = Number(value === undefined ? arg.value ?? 0 : value);
        if (!Number.isFinite(chosen)) fail(`积木「${type}」的「${arg.name}」必须是数字`);
        return Math.min(arg.max ?? 1e15, Math.max(arg.min ?? -1e15, chosen));
      }
      case 'field_checkbox': {
        const chosen = value === undefined ? arg.checked ?? false : value;
        if (typeof chosen !== 'boolean') fail(`积木「${type}」的「${arg.name}」必须是勾选框`);
        return chosen;
      }
      case 'field_variable': {
        const id = isObject(value) ? value.id : undefined;
        if (typeof id !== 'string' || !variables.has(id)) fail(`积木「${type}」使用了不存在的变量`);
        return variables.get(id);
      }
      default: return fail(`积木「${type}」包含不支持的字段类型`);
    }
  }

  // 返回 null 表示这块积木被停用，调用方当作没有。
  function block(raw, depth, expected) {
    if (!isObject(raw) || typeof raw.type !== 'string') fail('积木格式无效');
    const definition = blockTypes.get(raw.type);
    if (!definition) fail(`未知的积木类型「${raw.type.slice(0, 40)}」`);
    if (expected && blockKind(definition) !== expected) fail(`积木「${raw.type}」不能放在这个位置`);
    if (++count > limits.blocks) fail(`积木最多 ${limits.blocks} 块`);
    if (depth > limits.depth) fail(`积木嵌套太深（最多 ${limits.depth} 层）`);
    if (isDisabled(raw)) return null;
    const fields = {};
    const inputs = {};
    for (const arg of definition.args0 ?? []) {
      if (arg.type.startsWith('field_')) fields[arg.name] = field(arg, raw, raw.type);
      else if (arg.type === 'input_value') {
        const slot = raw.inputs?.[arg.name];
        const child = slot?.block ?? slot?.shadow;
        inputs[arg.name] = child ? block(child, depth + 1, 'value') : null;
      } else if (arg.type === 'input_statement') {
        inputs[arg.name] = chain(raw.inputs?.[arg.name]?.block, depth + 1);
      }
    }
    return { type: raw.type, fields, inputs };
  }

  // 一串首尾相连的语句积木，展平成数组。
  function chain(first, depth) {
    const nodes = [];
    for (let raw = first; raw; raw = raw.next?.block) {
      const node = block(raw, depth, 'statement');
      if (node) nodes.push(node);
    }
    return nodes;
  }

  const hats = [];
  for (const raw of top) {
    if (!isObject(raw) || typeof raw.type !== 'string') fail('积木格式无效');
    if (!blockTypes.has(raw.type)) fail(`未知的积木类型「${raw.type.slice(0, 40)}」`);
    if (blockKind(blockTypes.get(raw.type)) !== 'hat') {
      warnings.push(`有一块「${raw.type}」没有接在触发积木下面，已忽略`);
      continue;
    }
    const node = block(raw, 0, 'hat');
    if (!node) continue;
    const body = chain(raw.next?.block, 1);
    if (!body.length) warnings.push('有一个触发积木下面没有积木，不会做任何事');
    hats.push({ type: node.type, fields: node.fields, body });
  }
  return { hats, warnings, blocks: count };
}
