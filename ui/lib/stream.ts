import { create } from 'zustand';
import { boundedHistory, describeEntry, describeLog } from '../format.mjs';
import { useAuth } from './api';
import { useConversations } from './conversations';
import type { Counts, Entry, SessionState } from './types';

interface StreamStore {
  state: SessionState;
  counts: Counts;
  entries: Entry[];
  connected: boolean;
  /** True once the first snapshot arrived; distinguishes "loading" from "disconnected". */
  loaded: boolean;
  /** Highest alert entry id the user has acknowledged in the notification menu. */
  seenAlert: number;
  markAlertsSeen(): void;
}

export const useStream = create<StreamStore>((set, get) => ({
  state: { phase: 'detached' }, counts: { events: 0, actions: 0, errors: 0 }, entries: [], connected: false, loaded: false, seenAlert: 0,
  markAlertsSeen() { const last = alertsOf(get().entries).at(-1); if (last) set({ seenAlert: last.id }); },
}));

export type AlertLevel = 'error' | 'warn';
export interface Alert { id: number; time: string; level: AlertLevel; title: string; message: string; entry: Entry }

/** Failed actions and warning/error diagnostics, oldest first. */
export function alertsOf(entries: Entry[]): Alert[] {
  const result: Alert[] = [];
  for (const entry of entries) {
    if (entry.kind === 'action' && entry.data.response?.status === 'failed') {
      const description = describeEntry(entry);
      result.push({ id: entry.id, time: entry.time, level: 'error', title: description.title + ' 执行失败', message: description.text, entry });
    } else if (entry.kind === 'diagnostic') {
      const log = describeLog(entry);
      if (log.level === 'error' || log.level === 'warn') result.push({ id: entry.id, time: entry.time, level: log.level, title: entry.data.type || '运行日志', message: log.message, entry });
    }
  }
  return result;
}

export const isReady = (state: SessionState, connected: boolean) => connected && state.phase === 'session_ready' && state.syncing !== true;

function parseFrames(buffer: string, onFrame: (type: string | undefined, data: string) => void) {
  let end: number;
  while ((end = buffer.indexOf('\n\n')) !== -1) {
    const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
    const lines = frame.split('\n');
    const type = lines.find(line => line.startsWith('event: '))?.slice(7);
    const data = lines.find(line => line.startsWith('data: '))?.slice(6);
    if (data) onFrame(type, data);
  }
  return buffer;
}

/** Opens the server-sent event stream and keeps reconnecting until the returned function is called. */
export function connectStream() {
  let stopped = false, timer: ReturnType<typeof setTimeout> | undefined, attempt = 0;
  const controller = new AbortController();
  async function connect() {
    try {
      const response = await fetch('/api/stream', { headers: { Authorization: 'Bearer ' + useAuth.getState().token }, signal: controller.signal });
      if (response.status === 401) { useAuth.getState().setToken(''); return; }
      if (!response.ok || !response.body) throw new Error('连接失败');
      attempt = 0;
      useStream.setState({ connected: true });
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = '';
      while (!stopped) {
        const part = await reader.read();
        if (part.done) break;
        buffer += decoder.decode(part.value, { stream: true });
        if (buffer.length > 4 * 1024 * 1024) throw new Error('事件流过大');
        buffer = parseFrames(buffer, (type, text) => {
          const value = JSON.parse(text);
          if (type === 'snapshot') {
            const entries = boundedHistory(value.entries as Entry[]);
            useStream.setState({ state: value.state, counts: value.counts, entries, connected: true, loaded: true });
            useConversations.getState().ingest(entries, false);
          } else if (type === 'state') useStream.setState({ state: value });
          else if (type === 'entry') {
            useStream.setState(previous => ({ counts: value.counts, entries: boundedHistory([...previous.entries, value.entry]) }));
            useConversations.getState().ingest([value.entry], true);
          }
        });
      }
    } catch (error) { if ((error as Error).name === 'AbortError') return; }
    if (!stopped) {
      useStream.setState({ connected: false });
      timer = setTimeout(connect, Math.min(10000, 1000 * 2 ** attempt++));
    }
  }
  connect();
  return () => { stopped = true; clearTimeout(timer); controller.abort(); };
}
