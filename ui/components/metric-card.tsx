import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../lib/utils';
import { Skeleton } from './ui/misc';

interface MetricCardProps {
  label: string;
  value: ReactNode;
  icon: LucideIcon;
  hint?: ReactNode;
  tone?: 'default' | 'destructive';
  loading?: boolean;
  children?: ReactNode;
  className?: string;
}

export function MetricCard({ label, value, icon: Icon, hint, tone = 'default', loading, children, className }: MetricCardProps) {
  return <div className={cn('flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm', className)}>
    <div className="flex items-center justify-between gap-2">
      <span className="truncate text-caption font-medium text-muted-foreground">{label}</span>
      <Icon className="size-4 shrink-0 text-muted-foreground/80" aria-hidden />
    </div>
    <div className="grid gap-1">
      {loading ? <Skeleton className="h-7 w-20" /> : <span className={cn('tabular truncate text-[22px] font-semibold leading-7 tracking-[-0.02em]', tone === 'destructive' ? 'text-destructive-text' : 'text-foreground')}>{value}</span>}
      {hint && <span className="truncate text-xs text-muted-foreground">{hint}</span>}
    </div>
    {children}
  </div>;
}

/** A thin usage meter; the label beside it carries the number. */
export function Meter({ value, label }: { value: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamped)}>
    <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: Math.max(clamped, clamped > 0 ? 2 : 0) + '%' }} />
  </div>;
}
