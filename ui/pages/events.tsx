import { useMemo, useState } from 'react';
import { ChevronRight, Inbox, SearchX } from 'lucide-react';
import { describeEntry, type EntryKind } from '../format.mjs';
import { useStreamView } from '../lib/stream-view';
import { useStream } from '../lib/stream';
import { formatMs, formatTimeMs } from '../lib/utils';
import { EntryDetail, KindBadge, sourceNames } from '../components/entry';
import { EmptyState, Page, PageHeader } from '../components/page';
import { ListFooter, StreamControls } from '../components/stream-toolbar';
import { Badge } from '../components/ui/badge';
import { Card } from '../components/ui/card';
import { SearchInput } from '../components/ui/form';
import { Skeleton } from '../components/ui/misc';
import { Segmented } from '../components/ui/tabs';

type Filter = 'all' | Exclude<EntryKind, 'diagnostic'>;
const filters: { value: Filter; label: string }[] = [
  { value: 'all', label: '全部' }, { value: 'message', label: '消息' }, { value: 'notice', label: '通知' }, { value: 'request', label: '请求' }, { value: 'action', label: '动作' },
];

export default function Events() {
  const view = useStreamView();
  const loaded = useStream(state => state.loaded);
  const [query, setQuery] = useState(''), [filter, setFilter] = useState<Filter>('all');
  const described = useMemo(() => view.entries.filter(entry => entry.kind !== 'diagnostic').map(entry => ({ entry, description: describeEntry(entry) })), [view.entries]);
  const counts = useMemo(() => {
    const result: Record<string, number> = { all: described.length };
    for (const { description } of described) result[description.kind] = (result[description.kind] ?? 0) + 1;
    return result;
  }, [described]);
  const rows = useMemo(() => {
    const text = query.trim().toLowerCase();
    return described.filter(({ entry, description }) => (filter === 'all' || description.kind === filter)
      && (!text || description.title.toLowerCase().includes(text) || description.text.toLowerCase().includes(text) || JSON.stringify(entry.data).toLowerCase().includes(text))).reverse();
  }, [described, filter, query]);

  return <Page wide>
    <PageHeader title="事件" description="OneBot 事件与动作回执的实时流，点击任意一行查看结构化详情与原始 JSON。"
      meta={view.paused && <Badge tone="warning">已暂停</Badge>}
      actions={<StreamControls paused={view.paused} pending={view.pending} onTogglePause={view.togglePause} onClear={view.clear} />} />
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b p-3 sm:px-4">
        <Segmented aria-label="事件类型" value={filter} onValueChange={setFilter} className="max-w-full overflow-x-auto"
          options={filters.map(item => ({ ...item, count: counts[item.value] ?? 0 }))} />
        <SearchInput value={query} onValueChange={setQuery} placeholder="搜索内容、QQ 号或字段" className="ml-auto w-full sm:w-72" />
      </div>
      <div className="hidden grid-cols-[110px_60px_minmax(140px,220px)_minmax(0,1fr)_88px_16px] gap-4 border-b bg-muted/40 px-5 py-2 text-xs font-medium text-muted-foreground md:grid" aria-hidden>
        <span>时间</span><span>类型</span><span>标题</span><span>内容</span><span className="text-right">来源</span><span />
      </div>
      {!loaded ? <div className="grid gap-2 p-4">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-9" />)}</div>
        : rows.length ? <ul className="max-h-[calc(100dvh-300px)] min-h-72 divide-y overflow-y-auto">
          {rows.map(({ entry, description }) => <li key={entry.id}>
            <button type="button" onClick={() => view.open(entry)}
              className="grid w-full grid-cols-[60px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-4 py-2.5 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted md:grid-cols-[110px_60px_minmax(140px,220px)_minmax(0,1fr)_88px_16px] md:gap-4 md:px-5">
              <time className="tabular order-3 text-right font-mono text-xs text-muted-foreground md:order-none md:text-left" dateTime={entry.time}>{formatTimeMs(entry.time)}</time>
              <KindBadge kind={description.kind} failed={description.failed} className="order-1 md:order-none" />
              <span className="order-2 truncate text-sm font-medium md:order-none">{description.title}</span>
              <span className="order-4 col-span-2 col-start-2 truncate text-caption text-muted-foreground md:order-none md:col-span-1 md:col-start-auto">{description.text}</span>
              <span className="hidden truncate text-right text-xs text-muted-foreground md:block">
                {entry.kind === 'action' ? [entry.data.source && (sourceNames[entry.data.source] ?? entry.data.source), entry.data.elapsed != null && formatMs(entry.data.elapsed)].filter(Boolean).join(' · ') : description.source}
              </span>
              <ChevronRight className="hidden size-4 text-muted-foreground/60 md:block" aria-hidden />
            </button>
          </li>)}
        </ul> : <EmptyState icon={query || filter !== 'all' ? SearchX : Inbox} title={query || filter !== 'all' ? '没有匹配的事件' : '暂无事件'}
          description={query || filter !== 'all' ? '调整筛选条件或搜索词后再试。' : '新的消息、通知、请求和动作回执会实时出现在这里。'} />}
      <ListFooter><span className="tabular">显示 {rows.length} 条</span><span>仅保存在内存 · 最近 200 条</span></ListFooter>
    </Card>
    <EntryDetail entry={view.detail} onClose={view.close} />
  </Page>;
}
