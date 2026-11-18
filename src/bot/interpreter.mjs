// 积木程序解释器：对 compile.mjs 产出的 AST 做递归求值，没有 eval / new Function / 动态导入。
// 每次运行有一份预算（步数、墙钟时间、循环次数、消息条数、文字长度），任何一项用完就抛 BotRunError 中止本次运行。
// 与外界的全部交互都通过 services（由 engine.mjs 提供），所以测试里可以换成模拟实现。

export const defaultBudget = { steps: 2000, millis: 60_000, loop: 100, messages: 5, text: 20_000, messageChars: 4000, variables: 100 };

export class BotRunError extends Error {
  /** code：steps | time | loop | messages | text | invalid | send | ai | rate */
  constructor(code, message) { super(message); this.name = 'BotRunError'; this.code = code; }
}

class StopRun extends Error {}

const weekdayNames = [7, 1, 2, 3, 4, 5, 6];
const pad = value => String(value).padStart(2, '0');

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}
const numeric = value => typeof value === 'number' ? Number.isFinite(value) ? value : NaN
  : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
const toBool = value => typeof value === 'boolean' ? value : typeof value === 'number' ? value !== 0 : !['', '0', 'false', '假'].includes(String(value).trim().toLowerCase());

function compare(a, b) {
  const x = numeric(a), y = numeric(b);
  if (!Number.isNaN(x) && !Number.isNaN(y)) return x < y ? -1 : x > y ? 1 : 0;
  const left = toText(a), right = toText(b);
  return left < right ? -1 : left > right ? 1 : 0;
}
function toText(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0';
  return value ? 'true' : 'false';
}

/**
 * @param {{ type: string, fields: object, body: object[] }} hat compileProgram 产出的触发积木
 * @param {object} options
 * @param {object} options.event normalizeEvent 的结果
 * @param {string} [options.args] 命令参数
 * @param {object} options.services { now(), random(), send({target, segments}), ai: { ask }, memory: {...} }
 * @param {Partial<typeof defaultBudget>} [options.budget]
 * @returns {Promise<{ steps: number, messages: number, stopped: boolean }>}
 */
export async function runHat(hat, { event, args = '', services, budget: overrides = {} }) {
  const budget = { ...defaultBudget, ...overrides };
  const clock = () => services.now().getTime();
  const started = clock();
  const variables = new Map();
  let steps = 0;
  let messages = 0;

  const tick = () => {
    if (++steps > budget.steps) throw new BotRunError('steps', `运行步数超过 ${budget.steps}，已强制停止（可能有死循环）`);
    if (clock() - started > budget.millis) throw new BotRunError('time', `运行时间超过 ${Math.round(budget.millis / 1000)} 秒，已强制停止`);
  };
  const remaining = () => Math.max(1, budget.millis - (clock() - started));
  const text = value => {
    const result = toText(value);
    if (result.length > budget.text) throw new BotRunError('text', `文字超过 ${budget.text} 个字符，已强制停止`);
    return result;
  };
  const clip = value => value.length > budget.messageChars ? value.slice(0, budget.messageChars - 1) + '…' : value;
  const here = () => event.chat;

  async function send(target, segments) {
    if (++messages > budget.messages) throw new BotRunError('messages', `一次运行最多发送 ${budget.messages} 条消息，已强制停止`);
    await services.send({ target, segments });
  }
  const replySegments = (body, { at, quote }) => {
    const segments = [];
    if (quote && event.messageId) segments.push({ type: 'reply', data: { id: event.messageId } });
    if (at && event.chat.type === 'group') segments.push({ type: 'at', data: { qq: String(event.userId) } });
    segments.push({ type: 'text', data: { text: (segments.some(segment => segment.type === 'at') ? ' ' : '') + body } });
    return segments;
  };
  const memoryKey = value => {
    const key = text(value).trim();
    if (!key || key.length > 40) throw new BotRunError('invalid', '记忆的名称需要 1–40 个字符');
    return key;
  };

  async function evaluate(node) {
    if (node === null || node === undefined) return '';
    tick();
    const { fields, inputs } = node;
    const input = name => evaluate(inputs[name]);
    switch (node.type) {
      case 'oq_text': return fields.TEXT;
      case 'oq_number': return fields.NUM;
      case 'oq_bool': return fields.BOOL === 'true';
      case 'oq_event_info': {
        switch (fields.FIELD) {
          case 'text': return event.text;
          case 'sender_id': return String(event.userId);
          case 'sender_name': return event.nickname;
          case 'group_id': return event.chat.type === 'group' ? String(event.chat.id) : '';
          case 'self_id': return event.selfId;
          case 'message_id': return event.messageId;
          case 'args': return args;
          default: return '';
        }
      }
      case 'oq_event_flag':
        return fields.FLAG === 'group' ? event.chat.type === 'group' : fields.FLAG === 'private' ? event.chat.type === 'private'
          : fields.FLAG === 'mentioned' ? event.atSelf : event.hasImage;
      case 'oq_time': {
        const date = services.now();
        switch (fields.PART) {
          case 'hour': return date.getHours();
          case 'minute': return date.getMinutes();
          case 'weekday': return weekdayNames[date.getDay()];
          case 'date': return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
          default: return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
        }
      }
      case 'oq_join': return text(text(await input('A')) + text(await input('B')));
      case 'oq_text_contains': return text(await input('TEXT')).toLowerCase().includes(text(await input('SUB')).toLowerCase());
      case 'oq_text_length': return text(await input('TEXT')).length;
      case 'oq_text_replace': {
        const source = text(await input('TEXT')), from = text(await input('FROM')), to = text(await input('TO'));
        if (!from) return source;
        // 先按结果长度预估，避免「很长的替换文字 × 很多处匹配」在内存里炸开。
        const parts = source.split(from);
        if (source.length + (parts.length - 1) * (to.length - from.length) > budget.text) throw new BotRunError('text', `文字超过 ${budget.text} 个字符，已强制停止`);
        return parts.join(to);
      }
      case 'oq_text_sub': {
        const source = text(await input('TEXT'));
        const from = Math.max(1, Math.floor(toNumber(await input('FROM'))));
        const to = Math.floor(toNumber(await input('TO')));
        return to < from ? '' : source.slice(from - 1, to);
      }
      case 'oq_arith': {
        const a = toNumber(await input('A')), b = toNumber(await input('B'));
        switch (fields.OP) {
          case 'add': return a + b;
          case 'sub': return a - b;
          case 'mul': return a * b;
          case 'div': return b === 0 ? 0 : a / b;
          default: return b === 0 ? 0 : a % b;
        }
      }
      case 'oq_compare': {
        const a = await input('A'), b = await input('B');
        const order = compare(a, b);
        switch (fields.OP) {
          case 'eq': return order === 0;
          case 'neq': return order !== 0;
          case 'lt': return order < 0;
          case 'lte': return order <= 0;
          case 'gt': return order > 0;
          default: return order >= 0;
        }
      }
      case 'oq_logic': {
        // 短路求值：左边已经能决定结果时不再计算右边。
        const left = toBool(await input('A'));
        if (fields.OP === 'and') return left && toBool(await input('B'));
        return left || toBool(await input('B'));
      }
      case 'oq_not': return !toBool(await input('A'));
      case 'oq_random': {
        let from = Math.floor(toNumber(await input('FROM'))), to = Math.floor(toNumber(await input('TO')));
        if (from > to) [from, to] = [to, from];
        from = Math.max(-(2 ** 31), from); to = Math.min(2 ** 31, to);
        return from + Math.floor(services.random() * (to - from + 1));
      }
      case 'oq_random_pick': {
        const choices = fields.TEXT.split('|').map(item => item.trim()).filter(Boolean);
        return choices.length ? choices[Math.min(choices.length - 1, Math.floor(services.random() * choices.length))] : '';
      }
      case 'oq_var_get': return variables.get(fields.VAR) ?? '';
      case 'oq_mem_get': return services.memory.get(fields.SCOPE, memoryKey(await input('KEY')));
      case 'oq_ai_ask': {
        const prompt = text(await input('PROMPT')).trim();
        if (!prompt) return '';
        return await services.ai.ask({ prompt, remember: fields.REMEMBER, timeout: remaining() });
      }
      default: throw new BotRunError('invalid', `不能作为值使用的积木「${node.type}」`);
    }
  }

  async function execute(list) {
    for (const node of list) await statement(node);
  }

  async function statement(node) {
    tick();
    const { fields, inputs } = node;
    switch (node.type) {
      case 'oq_if':
        if (toBool(await evaluate(inputs.COND))) await execute(inputs.DO);
        return;
      case 'oq_if_else':
        await execute(toBool(await evaluate(inputs.COND)) ? inputs.THEN : inputs.ELSE);
        return;
      case 'oq_repeat': {
        const times = Math.min(budget.loop, Math.max(0, Math.floor(toNumber(await evaluate(inputs.TIMES)))));
        for (let index = 0; index < times; index++) await execute(inputs.DO);
        return;
      }
      case 'oq_while':
        for (let index = 0; toBool(await evaluate(inputs.COND)); index++) {
          if (index >= budget.loop) throw new BotRunError('loop', `循环超过 ${budget.loop} 次，已强制停止`);
          await execute(inputs.DO);
        }
        return;
      case 'oq_stop': throw new StopRun();
      case 'oq_var_set': {
        const value = await evaluate(inputs.VALUE);
        if (!variables.has(fields.VAR) && variables.size >= budget.variables) throw new BotRunError('invalid', `变量最多 ${budget.variables} 个`);
        variables.set(fields.VAR, typeof value === 'string' ? text(value) : value);
        return;
      }
      case 'oq_var_change':
        variables.set(fields.VAR, toNumber(variables.get(fields.VAR)) + toNumber(await evaluate(inputs.DELTA)));
        return;
      case 'oq_reply': {
        const body = clip(text(await evaluate(inputs.TEXT)));
        if (body) await send(here(), replySegments(body, { at: fields.AT, quote: fields.QUOTE }));
        return;
      }
      case 'oq_send_to': {
        const id = Math.floor(toNumber(await evaluate(inputs.ID)));
        if (!Number.isSafeInteger(id) || id <= 0) throw new BotRunError('invalid', '发送目标的号码无效');
        const body = clip(text(await evaluate(inputs.TEXT)));
        if (body) await send({ type: fields.TARGET, id }, [{ type: 'text', data: { text: body } }]);
        return;
      }
      case 'oq_send_media': {
        // 只接受网络链接和 base64：本机路径会让群里的任何人借积木读取这台电脑上的文件。
        const source = text(await evaluate(inputs.SRC)).trim();
        if (!/^(?:https?:\/\/|base64:\/\/)/i.test(source)) throw new BotRunError('invalid', '媒体来源只能是 http(s):// 链接或 base64:// 数据，不能是本机路径');
        await send(here(), [{ type: fields.TYPE, data: { file: source } }]);
        return;
      }
      case 'oq_send_fun':
        await send(here(), [{ type: fields.TYPE, data: {} }]);
        return;
      case 'oq_send_face': {
        const id = Math.floor(toNumber(await evaluate(inputs.ID)));
        if (!Number.isSafeInteger(id) || id < 0 || id > 100000) throw new BotRunError('invalid', 'QQ 表情编号无效');
        await send(here(), [{ type: 'face', data: { id: String(id) } }]);
        return;
      }
      case 'oq_ai_reply': {
        const prompt = text(await evaluate(inputs.PROMPT)).trim();
        if (!prompt) return;
        const answer = await services.ai.ask({ prompt, remember: fields.REMEMBER, timeout: remaining() });
        // AI 的回答原样发出（只按单条消息长度上限截断）；这里不会附加任何别的内容。
        const body = clip(answer);
        if (body) await send(here(), replySegments(body, { at: false, quote: fields.QUOTE }));
        return;
      }
      case 'oq_mem_set': {
        const key = memoryKey(await evaluate(inputs.KEY));
        services.memory.set(fields.SCOPE, key, text(await evaluate(inputs.VALUE)));
        return;
      }
      case 'oq_mem_forget':
        services.memory.forget(fields.SCOPE, memoryKey(await evaluate(inputs.KEY)));
        return;
      case 'oq_mem_clear_chat':
        services.memory.clearChat();
        return;
      default: throw new BotRunError('invalid', `不能作为语句使用的积木「${node.type}」`);
    }
  }

  let stopped = false;
  try { await execute(hat.body); }
  catch (error) { if (error instanceof StopRun) stopped = true; else throw error; }
  return { steps, messages, stopped };
}
