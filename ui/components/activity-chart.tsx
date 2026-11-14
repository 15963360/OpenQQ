import { useState, type KeyboardEvent } from 'react';
import { cn, formatNumber } from '../lib/utils';
import type { Metrics } from '../lib/types';

type Bucket = Metrics['timeline'][number];
const height = 152;
const clock = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });

function niceMax(value: number) {
  if (value <= 4) return 4;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * power >= value) return step * power;
  return 10 * power;
}

const series = [
  { key: 'events', label: '事件', color: 'bg-chart-1' },
  { key: 'actions', label: '动作', color: 'bg-chart-2' },
] as const;

/** Per-minute stacked columns for the last hour: events at the baseline, actions on top. */
export function ActivityChart({ timeline }: { timeline: Bucket[] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...timeline.map(bucket => bucket.events + bucket.actions)));
  const scale = (value: number) => value > 0 ? Math.max(2, value / max * height) : 0;
  const quiet = timeline.every(bucket => bucket.events + bucket.actions === 0);
  const current = active == null ? null : timeline[active];

  function onKey(event: KeyboardEvent) {
    if (event.key === 'ArrowLeft') { event.preventDefault(); setActive(index => Math.max(0, (index ?? timeline.length) - 1)); }
    if (event.key === 'ArrowRight') { event.preventDefault(); setActive(index => Math.min(timeline.length - 1, (index ?? -1) + 1)); }
    if (event.key === 'Escape') setActive(null);
  }

  return <figure className="m-0 grid gap-3">
    <div className="flex items-center gap-4 text-xs text-secondary-foreground" aria-hidden>
      {series.map(item => <span key={item.key} className="inline-flex items-center gap-1.5"><span className={cn('size-2 rounded-[2px]', item.color)} />{item.label}</span>)}
      <span className="ml-auto text-muted-foreground">每列 1 分钟</span>
    </div>
    <div className="relative">
      {[1, 0.5, 0].map(ratio => <div key={ratio} className="pointer-events-none absolute inset-x-0 flex items-center gap-2" style={{ top: (1 - ratio) * height }}>
        <div className={cn('h-px flex-1', ratio === 0 ? 'bg-border-strong' : 'bg-border/70')} />
        <span className="tabular w-8 -translate-y-px text-right text-2xs text-muted-foreground">{formatNumber(max * ratio)}</span>
      </div>)}
      <div role="img" tabIndex={0} aria-label={`近 60 分钟每分钟事件与动作数量，最高 ${max}`} onKeyDown={onKey} onBlur={() => setActive(null)} onMouseLeave={() => setActive(null)}
        className="relative mr-10 flex items-end gap-[2px] rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-card" style={{ height }}>
        {timeline.map((bucket, index) => <div key={bucket.minute} onMouseEnter={() => setActive(index)}
          className={cn('flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-[2px] rounded-[3px] transition-colors', active === index && 'bg-muted')}>
          {bucket.actions > 0 && <div className={cn('w-full max-w-6 rounded-t-[3px]', series[1].color)} style={{ height: scale(bucket.actions) }} />}
          {bucket.events > 0 && <div className={cn('w-full max-w-6', series[0].color, bucket.actions > 0 ? 'rounded-[1px]' : 'rounded-t-[3px]')} style={{ height: scale(bucket.events) }} />}
        </div>)}
        {quiet && <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-caption text-muted-foreground">近 60 分钟没有事件或动作</p>}
      </div>
      {current && active != null && <div role="status" className="pointer-events-none absolute top-0 z-10 w-36 rounded-lg border bg-popover p-2.5 text-xs shadow-md"
        style={{ left: `clamp(0px, calc(${(active + 0.5) / timeline.length * 100}% - 4.5rem), calc(100% - 9rem - 2.5rem))` }}>
        <p className="mb-1.5 font-medium text-foreground">{clock.format(current.minute)}</p>
        {series.map(item => <p key={item.key} className="flex items-center gap-1.5 text-secondary-foreground">
          <span className={cn('size-2 rounded-[2px]', item.color)} />{item.label}<span className="tabular ml-auto font-medium text-foreground">{formatNumber(current[item.key])}</span>
        </p>)}
        <p className="mt-1 flex items-center gap-1.5 border-t pt-1 text-secondary-foreground">异常<span className={cn('tabular ml-auto font-medium', current.errors ? 'text-destructive-text' : 'text-foreground')}>{formatNumber(current.errors)}</span></p>
      </div>}
      <div className="mr-10 mt-2 flex justify-between text-2xs text-muted-foreground" aria-hidden>
        <span>{timeline[0] ? clock.format(timeline[0].minute) : ''}</span>
        <span>{timeline[30] ? clock.format(timeline[30].minute) : ''}</span>
        <span>现在</span>
      </div>
    </div>
    <table className="sr-only">
      <caption>近 60 分钟每分钟活动</caption>
      <thead><tr><th>时间</th><th>事件</th><th>动作</th><th>异常</th></tr></thead>
      <tbody>{timeline.filter(bucket => bucket.events || bucket.actions || bucket.errors).map(bucket =>
        <tr key={bucket.minute}><td>{clock.format(bucket.minute)}</td><td>{bucket.events}</td><td>{bucket.actions}</td><td>{bucket.errors}</td></tr>)}</tbody>
    </table>
  </figure>;
}
