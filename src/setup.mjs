import { createInterface } from 'node:readline/promises';
import { validateConfig, saveConfig } from './config.mjs';
import { detectEnvironment } from './env.mjs';

export async function setupCLI(path, defaults, { input = process.stdin, output = process.stdout, detect = detectEnvironment } = {}) {
  if (!input.isTTY) throw new Error('CLI 初始化需要交互终端；请使用 npm run webui 在浏览器中配置');
  const reader = createInterface({ input, output });
  const ask = async (label, fallback) => (await reader.question(`${label} [${fallback}]: `)).trim() || String(fallback);
  output.write('\nOpenQQ 初始化 · 回车使用默认值 · Ctrl+C 取消\n');
  try {
    const config = structuredClone(defaults);
    const detected = detect({ qqRoot: config.qqRoot, python: config.python });
    if (detected.qq?.path && !defaults.qqRoot) config.qqRoot = detected.qq.path;
    if (detected.python?.path && (!defaults.python || defaults.python === 'python')) config.python = detected.python.path;
    config.qqRoot = await ask('QQ 安装目录', config.qqRoot);
    config.python = await ask('已安装 Frida 的 Python 路径', config.python);
    config.webPort = Number(await ask('WebUI 端口', config.webPort));
    const mode = await ask('接入方式：1 正向 WS（机器人连接 OpenQQ），2 反向 WS（OpenQQ 连接机器人）', config.ws.enabled ? '1' : '2');
    if (!['1', '2'].includes(mode)) throw new Error('接入方式需为 1 或 2');
    config.ws.enabled = mode === '1';
    if (config.ws.enabled) {
      config.ws.port = Number(await ask('OneBot WebSocket 端口', config.ws.port));
      const rotate = await ask('重新生成 OneBot 令牌？y/n（已有令牌保留）', 'n');
      if (rotate === 'y') config.accessToken = (await import('node:crypto')).randomBytes(32).toString('hex');
      config.reverseWs = [];
    } else {
      const url = await ask('机器人反向 WS 地址', config.reverseWs[0]?.url || 'ws://127.0.0.1:8080/onebot/v11/ws');
      const token = await ask('机器人端配置的令牌（空表示不鉴权）', config.reverseWs[0]?.token || '');
      config.reverseWs = [{ enabled: true, url, token }];
    }
    saveConfig(path, validateConfig(config));
    output.write(`\n已保存 ${path}\n运行 npm start，登录 QQ 后连接机器人。\n令牌可在 WebUI 的连接向导中查看和复制。\n`);
    return config;
  } finally { reader.close(); }
}
