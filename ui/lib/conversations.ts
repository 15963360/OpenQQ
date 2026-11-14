import { create } from 'zustand';
import { segmentText } from '../format.mjs';
import type { ActionResponse, Entry, Segment } from './types';

export type ChatType = 'private' | 'group';
export type SendState = 'pending' | 'sent' | 'failed';

export interface ChatMessage {
  key: string;
  direction: 'in' | 'out';
  time: string;
  senderId?: number;
  senderName: string;
  segments: Segment[];
  text: string;
  messageId?: number | string;
  status?: SendState;
  error?: string;
  echo?: string;
  source?: string;
  entryId?: number;
}

export interface Conversation {
  id: string;
  type: ChatType;
  target: number;
  name: string;
  messages: ChatMessage[];
  lastTime: string;
  unread: number;
}

const maxMessages = 300, maxConversations = 100;
const sendActions = new Set(['send_private_msg', 'send_group_msg', 'send_msg']);
export const conversationId = (type: ChatType, target: number) => type + ':' + target;

export function parseConversationId(value: string | null): { type: ChatType; target: number } | null {
  const match = value?.match(/^(private|group):([1-9]\d{0,15})$/);
  return match ? { type: match[1] as ChatType, target: Number(match[2]) } : null;
}

function toSegments(message: unknown): Segment[] {
  if (typeof message === 'string') return [{ type: 'text', data: { text: message } }];
  return Array.isArray(message) ? message.filter((item): item is Segment => Boolean(item && typeof item.type === 'string')) : [];
}

function targetOf(params: Record<string, unknown>, action: string): { type: ChatType; target: number } | null {
  const group = action === 'send_group_msg' || (action === 'send_msg' && (params.message_type === 'group' || (params.message_type == null && params.group_id != null)));
  const target = Number(group ? params.group_id : params.user_id);
  return Number.isSafeInteger(target) && target > 0 ? { type: group ? 'group' : 'private', target } : null;
}

interface Store {
  conversations: Record<string, Conversation>;
  lastEntry: number;
  active: string | null;
  ingest(entries: Entry[], live: boolean): void;
  addPending(id: string, type: ChatType, target: number, message: ChatMessage): void;
  settle(echo: string, response: ActionResponse | null, error?: string): void;
  open(id: string | null): void;
  ensure(type: ChatType, target: number): string;
}

function upsert(conversations: Record<string, Conversation>, type: ChatType, target: number, name?: string) {
  const id = conversationId(type, target);
  const existing = conversations[id];
  const value: Conversation = existing ? { ...existing, messages: existing.messages.slice() }
    : { id, type, target, name: type === 'group' ? '群 ' + target : 'QQ ' + target, messages: [], lastTime: new Date(0).toISOString(), unread: 0 };
  if (name && type === 'private') value.name = name;
  conversations[id] = value;
  return value;
}

function push(conversation: Conversation, message: ChatMessage) {
  const index = message.echo ? conversation.messages.findIndex(item => item.echo === message.echo) : -1;
  if (index >= 0) conversation.messages[index] = { ...conversation.messages[index], ...message, key: conversation.messages[index].key };
  else conversation.messages.push(message);
  if (conversation.messages.length > maxMessages) conversation.messages.splice(0, conversation.messages.length - maxMessages);
  if (message.time > conversation.lastTime) conversation.lastTime = message.time;
}

function prune(conversations: Record<string, Conversation>, active: string | null) {
  const ids = Object.keys(conversations);
  if (ids.length <= maxConversations) return;
  ids.sort((a, b) => conversations[a].lastTime.localeCompare(conversations[b].lastTime));
  for (const id of ids.slice(0, ids.length - maxConversations)) if (id !== active) delete conversations[id];
}

// Conversations are assembled in the browser from the live stream; they last as long as this tab.
export const useConversations = create<Store>((set, get) => ({
  conversations: {}, lastEntry: 0, active: null,
  ingest(entries, live) {
    const state = get();
    // A snapshot whose ids restart below what we have seen means the server restarted: start over.
    let lastEntry = entries.length && !live && entries.at(-1)!.id < state.lastEntry ? 0 : state.lastEntry;
    const conversations = lastEntry === 0 && state.lastEntry !== 0 ? {} : { ...state.conversations };
    let changed = lastEntry !== state.lastEntry;
    for (const entry of entries) {
      if (entry.id <= lastEntry) continue;
      lastEntry = entry.id;
      if (entry.kind === 'event' && entry.data.post_type === 'message') {
        const event = entry.data, group = event.message_type === 'group' && event.group_id != null;
        const target = Number(group ? event.group_id : event.user_id);
        if (!Number.isSafeInteger(target) || target <= 0) continue;
        const senderName = String(event.sender?.card || event.sender?.nickname || event.user_id || '未知');
        const conversation = upsert(conversations, group ? 'group' : 'private', target, group ? undefined : event.sender?.nickname || undefined);
        const segments = toSegments(event.message);
        push(conversation, { key: 'e' + entry.id, entryId: entry.id, direction: 'in', time: entry.time, senderId: event.user_id, senderName, segments,
          text: segmentText(segments), messageId: event.message_id });
        if (live && state.active !== conversation.id) conversation.unread++;
        changed = true;
      } else if (entry.kind === 'action' && entry.data.request && sendActions.has(entry.data.request.action)) {
        const { request, response } = entry.data;
        const where = request.params ? targetOf(request.params, request.action) : null;
        if (!where) continue;
        const conversation = upsert(conversations, where.type, where.target);
        const segments = toSegments(request.params?.message);
        const ok = response?.status === 'ok';
        push(conversation, { key: 'a' + entry.id, entryId: entry.id, direction: 'out', time: entry.time, senderName: '我', segments, text: segmentText(segments),
          status: ok ? 'sent' : 'failed', error: ok ? undefined : response?.message, echo: typeof request.echo === 'string' ? request.echo : undefined,
          messageId: (response?.data as { message_id?: number } | undefined)?.message_id, source: entry.data.source });
        changed = true;
      }
    }
    if (!changed && lastEntry === state.lastEntry) return;
    prune(conversations, state.active);
    set({ conversations, lastEntry });
  },
  addPending(id, type, target, message) {
    const conversations = { ...get().conversations };
    const conversation = upsert(conversations, type, target);
    if (conversation.id !== id) return;
    push(conversation, message);
    set({ conversations });
  },
  settle(echo, response, error) {
    const conversations = { ...get().conversations };
    for (const conversation of Object.values(conversations)) {
      const index = conversation.messages.findIndex(item => item.echo === echo);
      if (index < 0) continue;
      const current = conversation.messages[index];
      // The stream entry may already have settled it; never downgrade a settled message back.
      if (current.status !== 'pending') return;
      const ok = response?.status === 'ok';
      const next = { ...conversation, messages: conversation.messages.slice() };
      next.messages[index] = { ...current, status: ok ? 'sent' : 'failed', error: ok ? undefined : error || response?.message || '发送失败',
        messageId: (response?.data as { message_id?: number } | undefined)?.message_id };
      conversations[conversation.id] = next;
      set({ conversations });
      return;
    }
  },
  open(id) {
    if (!id) { set({ active: null }); return; }
    const conversations = get().conversations;
    const conversation = conversations[id];
    set({ active: id, conversations: conversation?.unread ? { ...conversations, [id]: { ...conversation, unread: 0 } } : conversations });
  },
  ensure(type, target) {
    const conversations = { ...get().conversations };
    const conversation = upsert(conversations, type, target);
    if (!get().conversations[conversation.id]) { conversation.lastTime = new Date().toISOString(); set({ conversations }); }
    return conversation.id;
  },
}));
