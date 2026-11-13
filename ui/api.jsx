import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { boundedHistory } from './format.mjs';

const Context = createContext(null);
export function readToken() {
  const fragment = new URLSearchParams(location.hash.slice(1)).get('token');
  let token = fragment || '';
  try { token ||= sessionStorage.getItem('openqq-token') || ''; if (fragment) sessionStorage.setItem('openqq-token', token); } catch {}
  if (fragment) history.replaceState(null, '', location.pathname + location.search);
  return token;
}
export function APIProvider({ children }) {
  const [token, setValue] = useState(readToken);
  const setToken = useCallback(value => {
    setValue(value);
    try { if (value) sessionStorage.setItem('openqq-token', value); else sessionStorage.removeItem('openqq-token'); } catch {}
  }, []);
  const request = useCallback(async (path, body) => {
    const json = body === undefined ? undefined : JSON.stringify(body);
    if (json && new TextEncoder().encode(json).length > 256 * 1024) throw new Error('请求内容超过 256 KiB');
    const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(25000),
      headers: { Authorization: 'Bearer ' + token, ...(json === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: json });
    if (response.status === 401) { setToken(''); throw new Error('访问密钥已失效，请使用本次启动的完整 WebUI 地址'); }
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || '请求失败');
    return result;
  }, [token, setToken]);
  return <Context.Provider value={useMemo(() => ({ token, setToken, request }), [token, setToken, request])}>{children}</Context.Provider>;
}
export const useAPI = () => useContext(Context);

export function useEventStream() {
  const { token, setToken } = useAPI();
  const [data, setData] = useState({ state: { phase: 'detached' }, counts: { events: 0, actions: 0, errors: 0 }, entries: [], connected: false });
  useEffect(() => {
    let stopped = false, timer;
    const controller = new AbortController();
    async function connect() {
      try {
        const response = await fetch('/api/stream', { headers: { Authorization: 'Bearer ' + token }, signal: controller.signal });
        if (response.status === 401) { setToken(''); return; }
        if (!response.ok || !response.body) throw new Error('连接失败');
        setData(previous => ({ ...previous, connected: true }));
        const reader = response.body.getReader(), decoder = new TextDecoder();
        let buffer = '';
        while (!stopped) {
          const part = await reader.read(); if (part.done) break;
          buffer += decoder.decode(part.value, { stream: true });
          if (buffer.length > 4 * 1024 * 1024) throw new Error('事件流过大');
          for (let end; (end = buffer.indexOf('\n\n')) !== -1;) {
            const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            const lines = frame.split('\n');
            const type = lines.find(line => line.startsWith('event: '))?.slice(7);
            const text = lines.find(line => line.startsWith('data: '))?.slice(6);
            if (!text) continue;
            const value = JSON.parse(text);
            if (type === 'snapshot') setData({ state: value.state, counts: value.counts, entries: boundedHistory(value.entries), connected: true });
            if (type === 'state') setData(previous => ({ ...previous, state: value }));
            if (type === 'entry') setData(previous => ({ ...previous, counts: value.counts, entries: boundedHistory([...previous.entries, value.entry]) }));
          }
        }
      } catch (error) { if (error.name === 'AbortError') return; }
      if (!stopped) {
        setData(previous => ({ ...previous, connected: false }));
        timer = setTimeout(connect, 2000);
      }
    }
    connect();
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, [token, setToken]);
  return data;
}
