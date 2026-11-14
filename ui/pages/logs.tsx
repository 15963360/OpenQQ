import { useMemo, useState } from 'react';
import { CircleAlert, Info, ScrollText, SearchX, TriangleAlert, Bug, type LucideIcon } from 'lucide-react';
import { describeLog, type LogLevel } from '../format.mjs';
import { useStreamView } from '../lib/stream-view';
import { useStream } from '../lib/stream';
import { cn, formatTimeMs } from '../lib/utils';
import { EntryDetail, levelMeta } from '../components/entry';
import { EmptyState, Page, PageHeader } from '../components/page';
import { ListFooter, StreamControls } from '../components/stream-toolbar';
import { Badge } from '../components/ui/badge';
import { Card } from '../components/ui/card';
import { SearchInput } from '../components/ui/form';
import { Skeleton } from '../components/ui/misc';
import { Segmented } from '../components/ui/tabs';

type Filter = 'all' | 'error' | 'warn' | 'info' | 'debug';
const bucket = (level: LogLevel): Exclude<Filter, 'all'> => level === 'success' ? 'info' : level;
const tiles: { value: Exclude<Filter, 'all'>; label: string; icon: LucideIcon; color: string }[] = [
  { value: 'error', label: '错误', icon: CircleAlert, color: 'text-destructive' },
  { value: 'warn', label: '警告', icon: TriangleAlert, color: 'text-warning' },
  { value: 'info', label: '信息', icon: Info, color: 'text-primary' },
  { value: 'debug', label: '调试', icon: Bug, color: 'text-muted-foreground' },
];

export default function Logs() {
  const view = useStreamView();
  const loaded = useStream(state => state.loaded);
  const [query, setQuery] = useState(''), [filter, setFilter] = useState<Filter>('all');
  const logs = useMemo(() => view.entries.filter(entry => entry.kind === 'diagnostic').map(entry => ({ entry, log: describeLog(entry) })), [view.entries]);
  const counts = useMemo(() => {
    const result: Record<Filter, number> = { all: logs.length, error: 0, warn: 0, info: 0, debug: 0 };
    for (const { log } of logs) result[bucket(log.level)]++;
    return result;
  }, [logs]);
  const rows = useMemo(() => {
    const text = query.trim().toLowerCase();
    return logs.filter(({ entry, log }) => (filter === 'all' || bucket(log.level) === filter)
      && (!text || log.message.toLowerCase().includes(text) || JSON.stringify(entry.data).toLowerCase().includes(text))).reverse();
  }, [logs, filter, query]);
  const lastError = useMemo(() => [...logs].reverse().find(({ log }) => log.level === 'error'), [logs]);

  return <Page wide>
    <PageHeader title="运行日志" description="原生挂接阶段、会话生命周期与事件处理诊断。QQ 自身的控制台输出写入 .runtime/qq.log。"
      meta={view.paused && <Badge tone="warning">已暂停</Badge>}
      actions={<StreamControls paused={view.paused} pending={view.pending} onTogglePause={view.togglePause} onClear={view.clear} />} />

    <section aria-label="日志级别统计" className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {tiles.map(tile => { const Icon = tile.icon; const selected = filter === tile.value; return <button key={tile.value} type="button" aria-pressed={selected}
        onClick={() => setFilter(selected ? 'all' : tile.value)}
        className={cn('flex items-center gap-3 rounded-xl border bg-card p-3.5 text-left shadow-sm outline-none transition-[border-color,box-shadow] hover:border-border-strong focus-visible:ring-2 focus-visible:ring-ring', selected && 'border-primary/50 ring-1 ring-primary/30')}>
        <span className="grid size-8 place-items-center rounded-lg bg-muted"><Icon className={cn('size-4', tile.color)} aria-hidden /></span>
        <span className="grid"><span className="text-xs text-muted-foreground">{tile.label}</span><span className="tabular text-lg font-semibold leading-6">{counts[tile.value]}</span></span>
      </button>; })}
    </section>

    {lastError && <div role="status" className="flex items-start gap-3 rounded-xl border border-destructive/25 bg-destructive/5 p-4">
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p className="text-sm font-medium">最近一次错误 · <span className="tabular font-mono text-caption">{formatTimeMs(lastError.entry.time)}</span></p>
        <p className="break-words text-caption text-secondary-foreground">{lastError.log.message}</p>
      </div>
      <button type="button" onClick={() => view.open(lastError.entry)} className="shrink-0 text-caption font-medium text-primary hover:underline">查看详情</button>
    </div>}

    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b p-3 sm:px-4">
        <Segmented aria-label="日志级别" value={filter} onValueChange={setFilter} className="max-w-full overflow-x-auto"
          options={[{ value: 'all', label: '全部', count: counts.all }, ...tiles.map(tile => ({ value: tile.value, label: tile.label, count: counts[tile.value] }))]} />
        <SearchInput value={query} onValueChange={setQuery} placeholder="搜索日志内容" className="ml-auto w-full sm:w-72" />
      </div>
      {!loaded ? <div className="grid gap-2 p-4">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-7" />)}</div>
        : rows.length ? <ul className="max-h-[calc(100dvh-420px)] min-h-72 overflow-y-auto py-1 font-mono text-xs">
          {rows.map(({ entry, log }) => { const meta = levelMeta[log.level]; return <li key={entry.id}>
            <button type="button" onClick={() => view.open(entry)}
              className={cn('grid w-full grid-cols-[96px_56px_minmax(0,1fr)] items-baseline gap-3 px-4 py-1.5 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted sm:grid-cols-[96px_56px_160px_minmax(0,1fr)] sm:px-5',
                log.level === 'error' && 'bg-destructive/[0.04]')}>
              <time className="tabular text-muted-foreground" dateTime={entry.time}>{formatTimeMs(entry.time)}</time>
              <span className={cn('font-semibold', meta.text)}>{meta.label}</span>
              <span className="hidden truncate text-secondary-foreground sm:block">{entry.data.type ?? '—'}</span>
              <span className="break-words font-sans text-caption text-foreground [overflow-wrap:anywhere]">{log.message}</span>
            </button>
          </li>; })}
        </ul> : <EmptyState icon={query || filter !== 'all' ? SearchX : ScrollText} title={query || filter !== 'all' ? '没有匹配的日志' : '暂无日志'}
          description={query || filter !== 'all' ? '调整级别或搜索词后再试。' : '挂接 QQ、会话就绪、同步状态和异常诊断会实时出现在这里。'} />}
      <ListFooter><span className="tabular">显示 {rows.length} 条</span><span>终端输入 /verbose 可查看 QQ 原始日志</span></ListFooter>
    </Card>
    <EntryDetail entry={view.detail} onClose={view.close} />
  </Page>;
}
