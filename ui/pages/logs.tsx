import { useMemo, useState } from 'react';
import { CircleAlert, Info, ScrollText, SearchX, TriangleAlert, Bug, type LucideIcon } from 'lucide-react';
import { describeLog, type LogLevel } from '../format.mjs';
import { useStreamView } from '../lib/stream-view';
import { useStream } from '../lib/stream';
import { usePreferences } from '../lib/preferences';
import { cn, formatTimeMs } from '../lib/utils';
import { EntryDetail, levelMeta } from '../components/entry';
import { EmptyState, Page, PageHeader } from '../components/page';
import { ListFooter, StreamControls } from '../components/stream-toolbar';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { SearchInput, Switch } from '../components/ui/form';
import { Tooltip } from '../components/ui/overlay';
import { Skeleton } from '../components/ui/misc';
import { Segmented } from '../components/ui/tabs';

type Filter = 'all' | 'error' | 'warn' | 'info' | 'debug';
const bucket = (level: LogLevel): Exclude<Filter, 'all'> => level === 'success' ? 'info' : level;
const tiles: { value: Exclude<Filter, 'all'>; label: string; icon: LucideIcon; color: string }[] = [
  { value: 'error', label: '错误', icon: CircleAlert, color: 'text-destructive' },
  { value: 'warn', label: '警告', icon: TriangleAlert, color: 'text-warning' },
  { value: 'info', label: '信息', icon: Info, color: 'text-foreground' },
  { value: 'debug', label: '调试', icon: Bug, color: 'text-muted-foreground' },
];

export default function Logs() {
  const view = useStreamView();
  const loaded = useStream(state => state.loaded);
  const showDebug = usePreferences(state => state.showDebugLogs), setShowDebug = usePreferences(state => state.setShowDebugLogs);
  const [query, setQuery] = useState(''), [filter, setFilter] = useState<Filter>('all');
  const logs = useMemo(() => view.entries.filter(entry => entry.kind === 'diagnostic').map(entry => ({ entry, log: describeLog(entry) })), [view.entries]);
  const counts = useMemo(() => {
    const result: Record<Filter, number> = { all: logs.length, error: 0, warn: 0, info: 0, debug: 0 };
    for (const { log } of logs) result[bucket(log.level)]++;
    return result;
  }, [logs]);
  const hidden = showDebug ? 0 : counts.debug;
  const rows = useMemo(() => {
    const text = query.trim().toLowerCase();
    return logs.filter(({ entry, log }) => (showDebug || log.level !== 'debug') && (filter === 'all' || bucket(log.level) === filter)
      && (!text || log.message.toLowerCase().includes(text) || JSON.stringify(entry.data).toLowerCase().includes(text))).reverse();
  }, [logs, filter, query, showDebug]);
  const lastError = useMemo(() => [...logs].reverse().find(({ log }) => log.level === 'error'), [logs]);
  function toggleDebug(value: boolean) {
    setShowDebug(value);
    if (!value && filter === 'debug') setFilter('all');
  }
  function selectTile(value: Exclude<Filter, 'all'>) {
    if (filter === value) { setFilter('all'); return; }
    if (value === 'debug') setShowDebug(true);
    setFilter(value);
  }
  const levelOptions = tiles.filter(tile => showDebug || tile.value !== 'debug');

  return <Page wide>
    <PageHeader title="运行日志" description="原生挂接阶段、会话生命周期与事件处理诊断。QQ 自身的控制台输出写入 .runtime/qq.log。"
      meta={view.paused && <Badge tone="warning">已暂停</Badge>}
      actions={<StreamControls paused={view.paused} pending={view.pending} onTogglePause={view.togglePause} onClear={view.clear} />} />

    <section aria-label="日志级别统计" className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {tiles.map(tile => { const Icon = tile.icon; const selected = filter === tile.value; return <button key={tile.value} type="button" aria-pressed={selected}
        onClick={() => selectTile(tile.value)}
        className={cn('flex items-center gap-3 rounded-xl border bg-card p-3.5 text-left shadow-sm outline-none transition-[border-color,box-shadow] hover:border-border-strong focus-visible:ring-2 focus-visible:ring-ring', selected && 'border-foreground/60 ring-1 ring-foreground/20')}>
        <span className="grid size-8 place-items-center rounded-lg bg-muted"><Icon className={cn('size-4', tile.color)} aria-hidden /></span>
        <span className="grid"><span className="text-xs text-muted-foreground">{tile.label}{tile.value === 'debug' && !showDebug && ' · 已隐藏'}</span>
          <span className={cn('tabular text-lg font-semibold leading-6', tile.value === 'debug' && !showDebug && 'text-muted-foreground')}>{counts[tile.value]}</span></span>
      </button>; })}
    </section>

    {lastError && <div role="status" className="flex items-start gap-3 rounded-xl border border-destructive/25 bg-destructive/5 p-4">
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p className="text-sm font-medium">最近一次错误 · <span className="tabular font-mono text-caption">{formatTimeMs(lastError.entry.time)}</span></p>
        <p className="break-words text-caption text-secondary-foreground">{lastError.log.message}</p>
      </div>
      <button type="button" onClick={() => view.open(lastError.entry)} className="shrink-0 text-caption font-medium text-foreground underline-offset-2 hover:underline">查看详情</button>
    </div>}

    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b p-3 sm:px-4">
        <Segmented aria-label="日志级别" value={filter} onValueChange={setFilter} className="max-w-full overflow-x-auto"
          options={[{ value: 'all', label: '全部', count: counts.all - hidden }, ...levelOptions.map(tile => ({ value: tile.value, label: tile.label, count: counts[tile.value] }))]} />
        <div className="ml-auto flex w-full items-center gap-4 sm:w-auto">
          <Tooltip content="未适配回调等调试信息，相当于终端的 /verbose">
            <label htmlFor="show-debug" className="flex shrink-0 cursor-pointer items-center gap-2 text-caption text-secondary-foreground">
              <Switch id="show-debug" checked={showDebug} onCheckedChange={toggleDebug} />显示调试日志
            </label>
          </Tooltip>
          <SearchInput value={query} onValueChange={setQuery} placeholder="搜索日志内容" className="min-w-0 flex-1 sm:w-72 sm:flex-none" />
        </div>
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
        </ul> : query || filter !== 'all' ? <EmptyState icon={SearchX} title="没有匹配的日志" description="调整级别或搜索词后再试。" />
          : hidden ? <EmptyState icon={ScrollText} title="没有需要关注的日志" description={`${hidden} 条调试日志已隐藏。`}
            action={<Button variant="outline" size="sm" onClick={() => toggleDebug(true)}>显示调试日志</Button>} />
          : <EmptyState icon={ScrollText} title="暂无日志" description="挂接 QQ、会话就绪、同步状态和异常诊断会实时出现在这里。" />}
      <ListFooter>
        <span className="tabular">显示 {rows.length} 条{hidden > 0 && ` · 已隐藏 ${hidden} 条调试日志`}</span>
        <span>终端输入 /verbose 可查看 QQ 原始日志</span>
      </ListFooter>
    </Card>
    <EntryDetail entry={view.detail} onClose={view.close} />
  </Page>;
}
