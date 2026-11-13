import { createInterface } from 'node:readline';

export const inputHelp = [
  '/private QQ号 消息内容  — 私聊纯文本',
  '/group 群号 消息内容    — 群聊纯文本',
  '/input QQ号 [事件类型]  — 私聊输入状态，事件类型默认 1',
  '/login                  — 当前登录账号',
  '/status                 — 原生会话状态',
  '/verbose                — 显示/隐藏调试信息',
  '/clear                  — 清屏',
  '/help                   — 显示本帮助',
  '/quit                   — 解除挂接并退出',
  '也可逐行输入 OneBot JSON，例如 {"action":"get_login_info","echo":"test"}',
].join('\n');

const localCommands = ['/help', '/quit', '/clear', '/verbose'];
const completions = ['/private ', '/group ', '/input ', '/login', '/status', '/verbose', '/clear', '/help', '/quit'];

export function parseInput(line) {
  if (Buffer.byteLength(line) > 1024 * 1024) throw new Error('输入行超过 1 MiB');
  if (!line.trim()) return null;
  const command = line.trim();
  if (localCommands.includes(command)) return command;
  if (command === '/login') return { action: 'get_login_info' };
  if (command === '/status') return { action: 'get_status' };
  const send = line.trimStart().match(/^\/(private|group)\s+(\d+)\s([\s\S]+)$/);
  if (send) return { action: send[1] === 'private' ? 'send_private_msg' : 'send_group_msg',
    params: { [send[1] === 'private' ? 'user_id' : 'group_id']: send[2], message: send[3], auto_escape: true } };
  const input = command.match(/^\/input\s+(\d+)(?:\s+(\d+))?$/);
  if (input) return { action: 'set_input_status', params: { user_id: input[1], event_type: Number(input[2] ?? 1) } };
  if (command.startsWith('/')) throw new Error('命令格式不正确，输入 /help 查看用法');
  let value;
  try { value = JSON.parse(line); } catch { throw new Error('输入必须是命令或有效的 JSON 动作'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON 动作必须为对象');
  return value;
}

// terminal=true gives a line editor with history and a prompt that output can be printed above.
export function startCommandInput({ input = process.stdin, output, terminal = false, prompt = '> ', dispatch, onQuit,
  write = line => process.stdout.write(line + '\n'), respond = (_request, response) => write(JSON.stringify(response)),
  help = () => console.error(inputHelp), local = {} }) {
  const reader = createInterface({ input, output: terminal ? output : undefined, terminal, prompt, historySize: 200, crlfDelay: Infinity,
    completer: terminal ? line => {
      const hits = completions.filter(value => value.startsWith(line));
      return [line.startsWith('/') ? hits : [], line];
    } : undefined });
  let closed = false;
  const close = () => { if (!closed) { closed = true; reader.close(); } };
  // In raw terminal mode Ctrl+C reaches readline instead of the process.
  if (terminal) reader.on('SIGINT', () => onQuit());
  const ask = () => { if (terminal && !closed) reader.prompt(); };
  const done = (async () => {
    ask();
    for await (const line of reader) {
      if (closed) break;
      let request;
      try {
        request = parseInput(line);
        if (!request) { ask(); continue; }
        if (request === '/help') { help(); ask(); continue; }
        if (request === '/quit') { onQuit(); break; }
        if (typeof request === 'string') { local[request.slice(1)]?.(); ask(); continue; }
        // Show the prompt again right away; the receipt is printed above it when QQ answers.
        ask();
        const response = await dispatch(request);
        if (!closed) respond(request, response);
      } catch (error) {
        if (!closed) respond(request, { status: 'failed', retcode: 1400, data: null, message: error.message });
        ask();
      }
    }
  })();
  return { close, done, reader };
}
