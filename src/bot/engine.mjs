// Bot 引擎：把收到的消息事件交给已启用的 Bot，匹配触发积木后用解释器运行。
// 这里负责所有“外部”的事：适用范围、触发冷却、发送/AI 频率限制、并发上限、记忆、真正的发送（经由 dispatch）、运行记录。
import { compileProgram } from './compile.mjs';
import { normalizeEvent, matchTrigger } from './trigger.mjs';
import { runHat, BotRunError } from './interpreter.mjs';
import { createRateLimiter } from './limits.mjs';
import { createMemory } from './memory.mjs';
import { buildMessages } from './persona.mjs';

const RUN_HISTORY = 50;
const MAX_QUEUE = 5;
const MAX_ANSWER = 20_000;

const summaryPrompt = [
  '你负责把一段聊天记录压缩成简短的摘要，供之后的对话参考。',
  '合并「已有摘要」和「新增对话」，保留人名、重要事实、约定和偏好；去掉寒暄和重复；',
  '每行一句，总共不超过 1200 个字符，只输出摘要本身。',
].join('');

export function createBotEngine({ store, dispatch, ai, log = () => {}, now = () => new Date(), random = Math.random, concurrency = 8, budget, memoryOptions = {}, maxEventAge = 120 } = {}) {
  const memories = new Map();
  const programs = new Map();
  const runs = new Map();
  const queues = new Map();
  const limiter = createRateLimiter({ now: () => now().getTime() });
  const stats = { events: 0, runs: 0, errors: 0, limited: 0, dropped: 0 };
  let active = 0;
  let closed = false;

  function memoryOf(id) {
    let memory = memories.get(id);
    if (!memory) { memory = createMemory({ file: store.memoryFile(id), now: () => now().getTime(), ...memoryOptions }); memories.set(id, memory); }
    return memory;
  }
  // 程序按 revision 缓存编译结果：保存后自动失效，收到消息时不重复编译。
  function programOf(bot) {
    const cached = programs.get(bot.id);
    const stamp = `${bot.revision ?? 0}:${bot.updatedAt}`;
    if (cached?.stamp === stamp) return cached.hats;
    const { hats } = compileProgram(bot.program);
    programs.set(bot.id, { stamp, hats });
    return hats;
  }
  function record(bot, entry) {
    const list = runs.get(bot.id) ?? [];
    list.unshift(entry);
    if (list.length > RUN_HISTORY) list.length = RUN_HISTORY;
    runs.set(bot.id, list);
    if (entry.status === 'error') stats.errors++;
    if (entry.status === 'limited') stats.limited++;
    log({ bot: bot.id, botName: bot.name, ...entry });
  }

  const inScope = (bot, event) => {
    const rule = bot.scope[event.chat.type];
    return rule.mode === 'all' || (rule.mode === 'allow') === rule.ids.includes(event.chat.id);
  };

  /** 解释器使用的外部能力；每次运行新建一份，绑定当前 Bot 和会话。outbox 不为空时是试运行：只记录不发送。 */
  function servicesFor(bot, event, outbox) {
    const memory = memoryOf(bot.id);
    const chatKey = event.chatKey;
    let remembered = false;
    const wrapMemory = fn => (...args) => { try { return fn(...args); } catch (error) { throw new BotRunError('invalid', error.message); } };
    return {
      services: {
        now, random,
        async send({ target, segments }) {
          if (outbox) { outbox.push({ target, segments }); return; }
          if (!limiter.take('send:' + bot.id, bot.limits.sendsPerMinute, 60_000)) throw new BotRunError('rate', `发送太频繁（每分钟最多 ${bot.limits.sendsPerMinute} 条），已跳过`);
          const params = target.type === 'group' ? { group_id: target.id, message: segments } : { user_id: target.id, message: segments };
          const response = await dispatch({ action: target.type === 'group' ? 'send_group_msg' : 'send_private_msg', params });
          if (response?.status !== 'ok') throw new BotRunError('send', `发送失败：${response?.message ?? '未知原因'}（retcode ${response?.retcode ?? '?'}）`);
        },
        ai: {
          async ask({ prompt, remember, timeout }) {
            if (!limiter.take('ai:' + bot.id, bot.limits.aiPerMinute, 60_000)) throw new BotRunError('rate', `调用 AI 太频繁（每分钟最多 ${bot.limits.aiPerMinute} 次），已跳过`);
            const messages = buildMessages({ persona: bot.persona, memorySettings: bot.memory, memory, chatKey, chat: event.chat, sender: event.nickname, prompt, now: now() });
            let answer;
            try { answer = (await ai.chat({ messages, temperature: bot.persona.temperature ?? undefined, timeout })).slice(0, MAX_ANSWER); }
            catch (error) { throw new BotRunError('ai', error instanceof Error ? error.message : 'AI 调用失败'); }
            if (remember && bot.memory.enabled) {
              memory.appendTurns(chatKey, [{ role: 'user', name: event.nickname, text: prompt }, { role: 'assistant', text: answer }]);
              remembered = true;
            }
            return answer;
          },
        },
        memory: {
          get: wrapMemory((scope, key) => memory.getNote(scope, chatKey, key)),
          set: wrapMemory((scope, key, value) => memory.setNote(scope, chatKey, key, value)),
          forget: wrapMemory((scope, key) => memory.deleteNote(scope, chatKey, key)),
          clearChat: () => memory.clearChat(chatKey),
        },
      },
      wasRemembered: () => remembered,
    };
  }

  // 对话原文攒多了就折进摘要；只有设置为「AI 摘要」时才会额外调用一次 AI，失败自动回退到规则摘要。
  async function compact(bot, chatKey) {
    const memory = memoryOf(bot.id);
    if (!memory.needsCompaction(chatKey)) return;
    const summarizer = bot.memory.summary === 'ai' ? async ({ summary, turns }) => ai.chat({
      messages: [{ role: 'system', content: summaryPrompt }, { role: 'user', content: `已有摘要：\n${summary || '（无）'}\n\n新增对话：\n${turns.map(turn => `${turn.role === 'user' ? turn.name || '用户' : '我'}：${turn.text}`).join('\n')}` }],
      temperature: 0.2, maxTokens: 500, timeout: 30_000,
    }) : undefined;
    await memory.compact(chatKey, summarizer);
  }

  async function runMatches(bot, event, matches, { outbox, simulated = false } = {}) {
    const results = [];
    for (const { hat, args } of matches) {
      const started = performance.now();
      const entry = { time: now().toISOString(), trigger: hat.type, chat: event.chatKey, user: event.userId, status: 'ok', steps: 0, messages: 0, elapsed: 0, ...(simulated ? { simulated: true } : {}) };
      const { services, wasRemembered } = servicesFor(bot, event, outbox);
      active++;
      stats.runs++;
      try {
        const result = await runHat(hat, { event, args, services, budget });
        Object.assign(entry, { steps: result.steps, messages: result.messages });
      } catch (error) {
        entry.status = error instanceof BotRunError ? (error.code === 'rate' ? 'limited' : 'error') : 'error';
        entry.error = error instanceof BotRunError ? error.message : `内部错误：${error?.message ?? error}`;
      } finally { active--; }
      entry.elapsed = Math.round(performance.now() - started);
      record(bot, entry);
      results.push(entry);
      if (wasRemembered()) await compact(bot, event.chatKey).catch(() => {});
    }
    return results;
  }

  // 同一个 Bot 在同一个会话里的运行排队执行，保证记忆按顺序更新；队列太长就丢弃新的，避免积压。
  function enqueue(key, task) {
    const queue = queues.get(key) ?? { tail: Promise.resolve(), size: 0 };
    if (queue.size >= MAX_QUEUE) { stats.dropped++; return Promise.resolve([]); }
    queue.size++;
    const result = queue.tail.then(task, task);
    queue.tail = result.catch(() => {}).finally(() => { if (--queue.size === 0) queues.delete(key); });
    queues.set(key, queue);
    return result;
  }

  return {
    /** 处理一条 OneBot 事件（正在运行的 Bot 才会响应）。返回的 Promise 在本事件触发的所有运行结束后完成，不会抛异常。 */
    async handleEvent(raw) {
      const event = closed ? null : normalizeEvent(raw);
      if (!event) return [];
      // 重连后补发的旧消息不回复。
      if (Number.isFinite(raw.time) && now().getTime() / 1000 - raw.time > maxEventAge) return [];
      stats.events++;
      const pending = [];
      for (const bot of store.live()) {
        if (!bot.enabled || !inScope(bot, event)) continue;
        let hats;
        try { hats = programOf(bot); } catch (error) { record(bot, { time: now().toISOString(), trigger: '-', chat: event.chatKey, user: event.userId, status: 'error', error: '积木程序无法加载：' + error.message, steps: 0, messages: 0, elapsed: 0 }); continue; }
        const matches = hats.map(hat => ({ hat, args: matchTrigger(hat, event)?.args })).filter(item => item.args !== undefined);
        if (!matches.length) continue;
        if (bot.limits.cooldownSeconds > 0 && !limiter.take(`cd:${bot.id}:${event.chatKey}:${event.userId}`, 1, bot.limits.cooldownSeconds * 1000)) continue;
        if (active >= concurrency) { stats.dropped++; record(bot, { time: now().toISOString(), trigger: matches[0].hat.type, chat: event.chatKey, user: event.userId, status: 'limited', error: '同时运行的积木太多，已跳过', steps: 0, messages: 0, elapsed: 0 }); continue; }
        pending.push(enqueue(`${bot.id}:${event.chatKey}`, () => runMatches(bot, event, matches)).catch(() => []));
      }
      return (await Promise.all(pending)).flat();
    },
    /** 在 WebUI 里试运行：不检查启用状态、适用范围和冷却，消息不会真的发出去，而是收集起来返回。AI 调用是真实的。 */
    async simulate(id, input = {}) {
      const bot = store.get(id);
      if (!bot) throw new Error('Bot 不存在');
      const type = input.chatType === 'group' ? 'group' : 'private';
      const text = typeof input.text === 'string' ? input.text.slice(0, 2000) : '';
      const event = {
        selfId: '10000', userId: 10001, nickname: typeof input.nickname === 'string' && input.nickname.trim() ? input.nickname.trim().slice(0, 40) : '测试用户',
        messageId: '', chat: { type, id: 100000 }, chatKey: type === 'group' ? 'sim:g' : 'sim:p', text: text.trim(), atSelf: input.atSelf === true && type === 'group', hasImage: false,
      };
      const matches = programOf(bot).map(hat => ({ hat, args: matchTrigger(hat, event)?.args })).filter(item => item.args !== undefined);
      const outbox = [];
      const runsResult = await runMatches(bot, event, matches, { outbox, simulated: true });
      return {
        matched: matches.map(item => item.hat.type),
        outputs: outbox.map(({ target, segments }) => ({ target, segments, text: segments.filter(segment => segment.type === 'text').map(segment => segment.data.text).join('') })),
        runs: runsResult,
      };
    },
    runsOf(id) { return [...(runs.get(id) ?? [])]; },
    memoryOf,
    /** 删除 Bot 后释放它的内存状态（文件由 store.remove 删除）。 */
    forget(id) { memories.get(id)?.close(); memories.delete(id); programs.delete(id); runs.delete(id); limiter.reset(`send:${id}`); limiter.reset(`ai:${id}`); },
    status: () => ({ active, ...stats }),
    close() { closed = true; for (const memory of memories.values()) memory.close(); },
  };
}
