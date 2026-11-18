// 滑动窗口频率限制。键是任意字符串（如 "send:botId"、"cooldown:botId:g:123:456"），全部在内存里。
export function createRateLimiter({ now = Date.now, maxKeys = 5000 } = {}) {
  const windows = new Map();
  return {
    /** 窗口内还没超过 max 次就记一次并返回 true；已经超过则不记录并返回 false。 */
    take(key, max, windowMs) {
      const time = now();
      const stamps = windows.get(key) ?? [];
      while (stamps.length && stamps[0] <= time - windowMs) stamps.shift();
      if (stamps.length >= max) { windows.delete(key); windows.set(key, stamps); return false; }
      stamps.push(time);
      // 先删再放，让 Map 的迭代顺序等于最近使用顺序，超过上限时淘汰最久没用的键。
      windows.delete(key);
      windows.set(key, stamps);
      if (windows.size > maxKeys) windows.delete(windows.keys().next().value);
      return true;
    },
    reset(prefix = '') { for (const key of [...windows.keys()]) if (key.startsWith(prefix)) windows.delete(key); },
    get size() { return windows.size; },
  };
}
