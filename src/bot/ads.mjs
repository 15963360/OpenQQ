// WebUI 里的推广位（广告）。它只显示在控制台界面里（「AI 接入」页的横幅），绝不会进入发给 QQ 的消息，
// 也不会进入发给 AI 的提示词。文案、链接和开关由控制台的使用者在 WebUI 里修改，保存在 data/bot/ads.json。
// 横幅上总是带一个固定的「广告」标记（界面代码里写死，不能通过设置去掉），避免被当成 OpenQQ 自己的提示。
export const defaultAds = () => ({
  enabled: true,
  text: 'zelix.asia 是 AI API 中转站，由 OpenQQ 维护者运营，可以作为下面 Base URL 的一个选择。这是一条推广信息，不需要时可以在下方关闭或修改。',
  url: 'https://zelix.asia',
});

export const adLimits = { text: 300, url: 200 };

const fail = message => { throw new Error(message); };

export function normalizeAds(input, current = defaultAds()) {
  if (input === undefined) return current;
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('广告设置格式无效');
  const merged = { ...current, ...input };
  if (typeof merged.enabled !== 'boolean') fail('广告开关必须是布尔值');
  if (typeof merged.text !== 'string' || typeof merged.url !== 'string') fail('广告文案和链接必须是文字');
  const text = merged.text.trim();
  const url = merged.url.trim();
  if (text.length > adLimits.text) fail(`广告文案最多 ${adLimits.text} 个字符`);
  if (merged.enabled && !text) fail('开启广告时文案不能为空');
  if (url) {
    let parsed;
    try { parsed = new URL(url); } catch { fail('广告链接格式无效，例如 https://zelix.asia'); }
    // 只允许网页链接，不允许 javascript:、data: 等会在点击时执行内容的地址，也不带账号密码。
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) fail('广告链接只支持 http:// 或 https:// 网址，且不能带账号密码');
    if (url.length > adLimits.url) fail(`广告链接最多 ${adLimits.url} 个字符`);
  }
  return { enabled: merged.enabled, text, url };
}
