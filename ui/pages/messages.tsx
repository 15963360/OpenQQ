import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowLeft, Check, CircleAlert, Copy, Keyboard, LoaderCircle, MessageSquarePlus, MessagesSquare, RotateCw, SendHorizontal, User, Users } from 'lucide-react';
import { identifier, messageRequest } from '../format.mjs';
import { request } from '../lib/api';
import { conversationId, parseConversationId, useConversations, type ChatMessage, type ChatType, type Conversation } from '../lib/conversations';
import { navigate, setSearchParam, useSearchParam } from '../lib/router';
import { isReady, useStream } from '../lib/stream';
import { cn, formatTime, randomHex } from '../lib/utils';
import type { ActionResponse } from '../lib/types';
import { EmptyState } from '../components/page';
import { Segments } from '../components/segments';
import { sourceNames } from '../components/entry';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader } from '../components/ui/dialog';
import { Field, Input, SearchInput, Textarea } from '../components/ui/form';
import { Tooltip } from '../components/ui/overlay';
import { Segmented } from '../components/ui/tabs';
import { copyText, toast } from '../components/ui/toast';

type Filter = 'all' | ChatType;

function Avatar({ conversation, className }: { conversation: Pick<Conversation, 'type' | 'target'>; className?: string }) {
  return <span className={cn('grid size-9 shrink-0 place-items-center rounded-full border bg-muted text-xs font-semibold text-secondary-foreground', className)} aria-hidden>
    {conversation.type === 'group' ? <Users className="size-4" /> : String(conversation.target).slice(-2)}
  </span>;
}

function ConversationList({ conversations, active, onNew }: { conversations: Conversation[]; active: string | null; onNew(): void }) {
  const [query, setQuery] = useState(''), [filter, setFilter] = useState<Filter>('all');
  const visible = useMemo(() => {
    const text = query.trim().toLowerCase();
    return conversations.filter(item => (filter === 'all' || item.type === filter) && (!text || item.name.toLowerCase().includes(text) || String(item.target).includes(text)
      || item.messages.at(-1)?.text.toLowerCase().includes(text)));
  }, [conversations, query, filter]);
  const count = (type: Filter) => type === 'all' ? conversations.length : conversations.filter(item => item.type === type).length;
  return <div className="flex h-full min-h-0 flex-col">
    <div className="grid gap-3 border-b p-3">
      <div className="flex items-center gap-2">
        <h1 className="flex-1 text-base font-semibold tracking-[-0.01em]">消息</h1>
        <Tooltip content="新会话"><Button variant="outline" size="icon-sm" aria-label="新会话" onClick={onNew}><MessageSquarePlus /></Button></Tooltip>
      </div>
      <SearchInput value={query} onValueChange={setQuery} placeholder="搜索会话或 QQ 号" />
      <Segmented aria-label="会话类型" value={filter} onValueChange={setFilter} className="w-full"
        options={[{ value: 'all', label: '全部', count: count('all') }, { value: 'private', label: '私聊', count: count('private') }, { value: 'group', label: '群聊', count: count('group') }]} />
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
      {visible.length ? <ul className="grid gap-0.5">
        {visible.map(item => { const last = item.messages.at(-1); return <li key={item.id}>
          <button type="button" onClick={() => setSearchParam('c', item.id)} aria-current={active === item.id ? 'true' : undefined}
            className={cn('flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring', active === item.id ? 'bg-muted' : 'hover:bg-muted/60')}>
            <Avatar conversation={item} />
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="flex items-baseline gap-2">
                <span className="truncate text-sm font-medium">{item.name}</span>
                {last && <time className="tabular ml-auto shrink-0 text-2xs text-muted-foreground" dateTime={last.time}>{formatTime(last.time).slice(0, 5)}</time>}
              </span>
              <span className="flex items-center gap-2">
                <span className="truncate text-xs text-muted-foreground">{last ? (item.type === 'group' && last.direction === 'in' ? last.senderName + '：' : last.direction === 'out' ? '我：' : '') + last.text : '暂无消息'}</span>
                {item.unread > 0 && <span className="tabular ml-auto min-w-5 shrink-0 rounded-full bg-primary px-1.5 text-center text-2xs font-semibold leading-5 text-primary-foreground" aria-label={item.unread + ' 条未读'}>{item.unread > 99 ? '99+' : item.unread}</span>}
              </span>
            </span>
          </button>
        </li>; })}
      </ul> : <EmptyState compact icon={MessagesSquare} title={conversations.length ? '没有匹配的会话' : '暂无会话'}
        description={conversations.length ? '换个关键词或类型试试。' : '收到的消息会按会话出现在这里，记录只保存在当前标签页。'}
        action={!conversations.length && <Button variant="outline" size="sm" onClick={onNew}><MessageSquarePlus />新会话</Button>} />}
    </div>
  </div>;
}

function MessageItem({ message, grouped, showSender, onRetry }: { message: ChatMessage; grouped: boolean; showSender: boolean; onRetry(message: ChatMessage): void }) {
  const out = message.direction === 'out';
  return <li className={cn('flex flex-col', out ? 'items-end' : 'items-start', grouped ? 'mt-0.5' : 'mt-4 first:mt-0')}>
    {!grouped && <div className={cn('mb-1 flex items-baseline gap-2 px-1 text-xs', out && 'flex-row-reverse')}>
      {showSender && <span className="font-medium text-secondary-foreground">{message.senderName}</span>}
      {showSender && !out && message.senderId && <span className="tabular font-mono text-2xs text-muted-foreground">{message.senderId}</span>}
      <time className="tabular text-2xs text-muted-foreground" dateTime={message.time}>{formatTime(message.time)}</time>
    </div>}
    <div className={cn('max-w-[min(560px,85%)] rounded-2xl px-3.5 py-2 text-sm leading-relaxed', out ? 'rounded-br-md border border-primary/15 bg-accent text-foreground' : 'rounded-bl-md border bg-card')}>
      <Segments segments={message.segments} />
    </div>
    {out && <div className="mt-1 flex items-center gap-1.5 px-1 text-2xs text-muted-foreground" aria-live="polite">
      {message.status === 'pending' && <><LoaderCircle className="size-3 animate-spin" aria-hidden />发送中</>}
      {message.status === 'sent' && <><Check className="size-3 text-success" aria-hidden />已发送{message.source && message.source !== 'webui' ? ' · ' + (sourceNames[message.source] ?? message.source) : ''}</>}
      {message.status === 'failed' && <><CircleAlert className="size-3 text-destructive" aria-hidden /><span className="text-destructive-text">发送失败{message.error ? '：' + message.error : ''}</span>
        {message.segments.every(segment => segment.type === 'text') && <button type="button" onClick={() => onRetry(message)} className="ml-1 inline-flex items-center gap-1 rounded-sm font-medium text-foreground underline-offset-2 hover:underline"><RotateCw className="size-3" aria-hidden />重新发送</button>}</>}
    </div>}
  </li>;
}

function Thread({ conversation, onBack }: { conversation: Conversation; onBack(): void }) {
  const ready = useStream(store => isReady(store.state, store.connected));
  const syncing = useStream(store => store.state.syncing === true);
  const addPending = useConversations(state => state.addPending), settle = useConversations(state => state.settle);
  const [text, setText] = useState(''), [typing, setTyping] = useState(false);
  const list = useRef<HTMLDivElement>(null), stick = useRef(true), input = useRef<HTMLTextAreaElement>(null);
  const messages = conversation.messages;

  useLayoutEffect(() => { stick.current = true; }, [conversation.id]);
  useLayoutEffect(() => { const element = list.current; if (element && stick.current) element.scrollTop = element.scrollHeight; }, [messages.length, conversation.id]);

  async function send(value: string) {
    let action;
    try { action = messageRequest({ targetType: conversation.type, target: conversation.target, message: value }); }
    catch (error) { toast.error('无法发送', (error as Error).message); return false; }
    const echo = 'webui-' + randomHex(6);
    addPending(conversation.id, conversation.type, conversation.target, { key: 'p' + echo, echo, direction: 'out', time: new Date().toISOString(), senderName: '我',
      segments: [{ type: 'text', data: { text: value } }], text: value, status: 'pending', source: 'webui' });
    stick.current = true;
    request<ActionResponse>('/api/action', { ...action, echo })
      .then(response => settle(echo, response))
      // Never resend automatically: a timed-out send may already have reached QQ.
      .catch(error => settle(echo, null, (error as Error).message + '；请先在 QQ 中确认是否已发送'));
    return true;
  }
  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!ready || !text.trim()) return;
    if (await send(text)) { setText(''); input.current?.focus(); }
  }
  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); }
  }
  async function sendTyping() {
    setTyping(true);
    try {
      const response = await request<ActionResponse>('/api/action', { action: 'set_input_status', params: { user_id: identifier(conversation.target), event_type: 1 } });
      if (response.status === 'ok') toast.success('已发送「正在输入」'); else toast.error('输入状态失败', response.message);
    } catch (error) { toast.error('输入状态失败', (error as Error).message); }
    finally { setTyping(false); }
  }

  const rows = useMemo(() => messages.map((message, index) => {
    const previous = messages[index - 1];
    const grouped = Boolean(previous && previous.direction === message.direction && previous.senderId === message.senderId
      && new Date(message.time).getTime() - new Date(previous.time).getTime() < 3 * 60_000);
    return { message, grouped };
  }), [messages]);

  return <div className="flex h-full min-h-0 flex-col">
    <header className="flex min-h-14 items-center gap-3 border-b px-3 py-2 sm:px-4">
      <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="返回会话列表" onClick={onBack}><ArrowLeft /></Button>
      <Avatar conversation={conversation} className="size-8" />
      <div className="grid min-w-0 flex-1 leading-tight">
        <span className="flex items-center gap-2"><span className="truncate text-sm font-semibold">{conversation.name}</span><Badge tone="outline">{conversation.type === 'group' ? '群聊' : '私聊'}</Badge></span>
        <span className="tabular truncate font-mono text-xs text-muted-foreground">{conversation.target}</span>
      </div>
      <Tooltip content={conversation.type === 'group' ? '复制群号' : '复制 QQ 号'}>
        <Button variant="ghost" size="icon-sm" aria-label="复制号码" onClick={() => copyText(String(conversation.target))}><Copy /></Button>
      </Tooltip>
      {conversation.type === 'private' && <Tooltip content="发送「正在输入」状态">
        <Button variant="ghost" size="icon-sm" aria-label="发送正在输入状态" disabled={!ready} loading={typing} onClick={sendTyping}>{!typing && <Keyboard />}</Button>
      </Tooltip>}
    </header>
    <div ref={list} onScroll={event => { const element = event.currentTarget; stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80; }}
      className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6" aria-live="polite" aria-relevant="additions">
      {rows.length ? <ul className="mx-auto flex max-w-3xl flex-col">
        {rows.map(({ message, grouped }) => <MessageItem key={message.key} message={message} grouped={grouped} showSender={conversation.type === 'group' || message.direction === 'in'} onRetry={item => send(item.text)} />)}
      </ul> : <EmptyState compact icon={MessagesSquare} title="还没有消息" description="本标签页打开期间收到或发出的消息会显示在这里。" className="h-full" />}
    </div>
    <form onSubmit={submit} className="border-t bg-background p-3 sm:px-4">
      <div className="mx-auto grid max-w-3xl gap-2">
        <div className="flex items-end gap-2 rounded-xl border bg-card p-1.5 shadow-sm transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20">
          <Textarea ref={input} value={text} onChange={event => setText(event.target.value)} onKeyDown={onKey} rows={1} maxLength={65536} disabled={!ready}
            placeholder={ready ? `发送到 ${conversation.name}` : syncing ? 'QQ 正在同步，请稍候…' : 'QQ 会话就绪后才能发送'} aria-label="消息内容"
            className="max-h-40 min-h-9 resize-none border-0 bg-transparent px-2 py-1.5 shadow-none hover:border-0 focus-visible:ring-0 [field-sizing:content]" />
          <Button type="submit" size="icon-sm" disabled={!ready || !text.trim()} aria-label="发送"><SendHorizontal /></Button>
        </div>
        <p className="px-1 text-2xs text-muted-foreground">Enter 发送 · Shift + Enter 换行 · 按纯文本发送，CQ 码不会被解析</p>
      </div>
    </form>
  </div>;
}

function NewConversation({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const ensure = useConversations(state => state.ensure);
  const [type, setType] = useState<ChatType>('private'), [target, setTarget] = useState(''), [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setTarget(''); setError(null); } }, [open]);
  function submit(event: FormEvent) {
    event.preventDefault();
    let number: number;
    try { number = identifier(target); } catch (failure) { setError((failure as Error).message); return; }
    const id = ensure(type, number);
    onOpenChange(false);
    setSearchParam('c', id);
  }
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader title="新会话" description="输入对方 QQ 号或群号，消息会通过当前登录的账号发送。" />
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <Segmented aria-label="会话类型" size="default" value={type} onValueChange={setType} className="w-full" options={[{ value: 'private', label: <><User className="size-3.5" />私聊</> }, { value: 'group', label: <><Users className="size-3.5" />群聊</> }]} />
        <Field label={type === 'group' ? '群号' : 'QQ 号'} htmlFor="new-target" error={error}>
          <Input id="new-target" value={target} onChange={event => { setTarget(event.target.value); setError(null); }} inputMode="numeric" autoFocus className="font-mono"
            placeholder={type === 'group' ? '例如 987654321' : '例如 123456789'} aria-invalid={Boolean(error)} aria-describedby={error ? 'new-target-hint' : undefined} />
        </Field>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button type="submit">打开会话</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

export default function Messages() {
  const conversations = useConversations(state => state.conversations);
  const open = useConversations(state => state.open), ensure = useConversations(state => state.ensure);
  const param = useSearchParam('c');
  const [creating, setCreating] = useState(false);
  const parsed = parseConversationId(param);
  const activeId = parsed ? conversationId(parsed.type, parsed.target) : null;
  useEffect(() => {
    if (parsed && !useConversations.getState().conversations[activeId!]) ensure(parsed.type, parsed.target);
    open(activeId);
  }, [activeId]);
  useEffect(() => () => open(null), [open]);
  const sorted = useMemo(() => Object.values(conversations).sort((a, b) => b.lastTime.localeCompare(a.lastTime)), [conversations]);
  const active = activeId ? conversations[activeId] : undefined;
  return <div className="flex h-[calc(100dvh-3.5rem)] min-h-[480px]">
    <aside className={cn('w-full shrink-0 border-r bg-background md:w-80', active && 'hidden md:block')} aria-label="会话列表">
      <ConversationList conversations={sorted} active={activeId} onNew={() => setCreating(true)} />
    </aside>
    <section className={cn('min-w-0 flex-1 bg-card/40', !active && 'hidden md:block')} aria-label="会话内容">
      {active ? <Thread key={active.id} conversation={active} onBack={() => navigate('/messages')} />
        : <EmptyState icon={MessagesSquare} title="选择一个会话" description="从左侧选择会话，或新建会话向好友、群聊发送消息。" className="h-full"
          action={<Button variant="outline" size="sm" onClick={() => setCreating(true)}><MessageSquarePlus />新会话</Button>} />}
    </section>
    <NewConversation open={creating} onOpenChange={setCreating} />
  </div>;
}
