import type { ReactNode } from 'react';
import { Bell, MessageSquare, MessagesSquare, ScrollText, UserPlus, Zap, type LucideIcon } from 'lucide-react';
import { describeEntry, describeLog, type EntryKind, type LogLevel } from '../format.mjs';
import { conversationId } from '../lib/conversations';
import { navigate } from '../lib/router';
import { cn, formatDateTime, formatMs } from '../lib/utils';
import type { Entry, Segment } from '../lib/types';
import { retcodes } from '../lib/catalog';
import { Badge, type Tone } from './ui/badge';
import { Button } from './ui/button';
import { Dialog, SheetContent } from './ui/dialog';
import { DescriptionList } from './page';
import { JsonView } from './json-view';
import { Segments } from './segments';

export const kindMeta: Record<EntryKind, { label: string; icon: LucideIcon; tone: Tone }> = {
  message: { label: '消息', icon: MessageSquare, tone: 'primary' },
  notice: { label: '通知', icon: Bell, tone: 'neutral' },
  request: { label: '请求', icon: UserPlus, tone: 'warning' },
  action: { label: '动作', icon: Zap, tone: 'neutral' },
  diagnostic: { label: '诊断', icon: ScrollText, tone: 'neutral' },
};

export const levelMeta: Record<LogLevel, { label: string; tone: Tone; text: string }> = {
  error: { label: '错误', tone: 'destructive', text: 'text-destructive-text' },
  warn: { label: '警告', tone: 'warning', text: 'text-warning-text' },
  info: { label: '信息', tone: 'primary', text: 'text-accent-foreground' },
  success: { label: '完成', tone: 'success', text: 'text-success-text' },
  debug: { label: '调试', tone: 'neutral', text: 'text-muted-foreground' },
};

export const sourceNames: Record<string, string> = { webui: 'WebUI', onebot: 'OneBot', terminal: '终端' };

export function KindBadge({ kind, failed, className }: { kind: EntryKind; failed?: boolean; className?: string }) {
  const meta = kindMeta[kind];
  const Icon = meta.icon;
  return <Badge tone={failed ? 'destructive' : meta.tone} className={cn('w-[52px] justify-center rounded-md px-1.5', className)}><Icon aria-hidden />{meta.label}</Badge>;
}

function conversationOf(entry: Entry) {
  if (entry.kind !== 'event' || entry.data.post_type !== 'message') return null;
  const group = entry.data.message_type === 'group' && entry.data.group_id;
  const target = Number(group ? entry.data.group_id : entry.data.user_id);
  return Number.isSafeInteger(target) && target > 0 ? conversationId(group ? 'group' : 'private', target) : null;
}

/** Side sheet with the structured fields and raw JSON of one stream entry. */
export function EntryDetail({ entry, onClose }: { entry: Entry | null; onClose(): void }) {
  return <Dialog open={Boolean(entry)} onOpenChange={open => { if (!open) onClose(); }}>
    {entry && <EntrySheet entry={entry} onClose={onClose} />}
  </Dialog>;
}

function EntrySheet({ entry, onClose }: { entry: Entry; onClose(): void }) {
  const description = describeEntry(entry);
  const conversation = conversationOf(entry);
  const items: [string, ReactNode][] = [
    ['类型', <KindBadge kind={description.kind} failed={description.failed} />],
    ['时间', <span className="tabular font-mono text-caption">{formatDateTime(entry.time)}</span>],
    ['来源', description.source],
    ['序号', <span className="tabular font-mono text-caption">#{entry.id}</span>],
  ];
  if (entry.kind === 'action') {
    const response = entry.data.response;
    if (entry.data.source) items.push(['入口', sourceNames[entry.data.source] ?? entry.data.source]);
    if (entry.data.elapsed != null) items.push(['耗时', <span className="tabular font-mono text-caption">{formatMs(entry.data.elapsed)}</span>]);
    if (response) items.push(['结果', <span className="flex flex-wrap items-center gap-2">
      <Badge tone={response.status === 'ok' ? 'success' : 'destructive'}>{response.status === 'ok' ? '成功' : '失败'}</Badge>
      <span className="font-mono text-caption">retcode {response.retcode}</span>
      {retcodes[response.retcode] && response.retcode !== 0 && <span className="text-caption text-muted-foreground">{retcodes[response.retcode]}</span>}
    </span>]);
  }
  if (entry.kind === 'diagnostic') {
    const log = describeLog(entry);
    items.push(['级别', <Badge tone={levelMeta[log.level].tone}>{levelMeta[log.level].label}</Badge>]);
  }
  const segments = entry.kind === 'event' && Array.isArray(entry.data.message) ? entry.data.message as Segment[] : null;
  return <SheetContent title={description.title} description={description.text}
    actions={conversation && <Button size="sm" variant="outline" onClick={() => { onClose(); navigate('/messages?c=' + conversation); }}><MessagesSquare />打开会话</Button>}>
    <div className="grid gap-6 p-5">
      <DescriptionList items={items} />
      {segments && <section className="grid gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">消息内容</h3>
        <div className="rounded-lg border bg-card p-3 text-sm"><Segments segments={segments} /></div>
      </section>}
      {entry.kind === 'action' ? <>
        <section className="grid gap-2"><h3 className="text-xs font-medium text-muted-foreground">请求</h3><JsonView value={entry.data.request ?? null} /></section>
        <section className="grid gap-2"><h3 className="text-xs font-medium text-muted-foreground">响应</h3><JsonView value={entry.data.response ?? null} /></section>
      </> : <section className="grid gap-2"><h3 className="text-xs font-medium text-muted-foreground">原始数据</h3><JsonView value={entry.data} maxHeight="none" /></section>}
    </div>
  </SheetContent>;
}
