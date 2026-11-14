import type { ReactNode } from 'react';
import { CircleAlert, RotateCw, type LucideIcon } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './ui/button';

export function Page({ children, className, wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  return <div className={cn('mx-auto flex w-full flex-col gap-6 px-4 pb-12 pt-6 sm:px-6 lg:px-8', wide ? 'max-w-[1440px]' : 'max-w-[1200px]', className)}>{children}</div>;
}

export function PageHeader({ title, description, actions, meta }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; meta?: ReactNode }) {
  return <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
    <div className="grid min-w-0 gap-1">
      <div className="flex flex-wrap items-center gap-2.5">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-foreground">{title}</h1>
        {meta}
      </div>
      {description && <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </header>;
}

interface StateProps { icon: LucideIcon; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string; compact?: boolean }
export function EmptyState({ icon: Icon, title, description, action, className, compact }: StateProps) {
  return <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'gap-2 px-6 py-10' : 'gap-3 px-6 py-16', className)}>
    <span className="grid size-10 place-items-center rounded-xl border bg-card text-muted-foreground shadow-sm"><Icon className="size-5" aria-hidden /></span>
    <div className="grid max-w-sm gap-1">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="text-caption text-muted-foreground">{description}</p>}
    </div>
    {action && <div className="mt-1">{action}</div>}
  </div>;
}

export function ErrorState({ title = '加载失败', description, onRetry, className }: { title?: string; description?: ReactNode; onRetry?: () => void; className?: string }) {
  return <div role="alert" className={cn('flex flex-col items-center justify-center gap-3 px-6 py-14 text-center', className)}>
    <span className="grid size-10 place-items-center rounded-xl border border-destructive/25 bg-destructive/10 text-destructive"><CircleAlert className="size-5" aria-hidden /></span>
    <div className="grid max-w-md gap-1">
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="text-caption text-muted-foreground">{description}</p>}
    </div>
    {onRetry && <Button variant="outline" size="sm" onClick={onRetry}><RotateCw />重试</Button>}
  </div>;
}

/** A term/description grid for key-value details. */
export function DescriptionList({ items, className }: { items: [ReactNode, ReactNode][]; className?: string }) {
  return <dl className={cn('grid gap-x-6 gap-y-0 divide-y text-sm', className)}>
    {items.map(([term, value], index) => <div key={index} className="grid grid-cols-[minmax(96px,30%)_minmax(0,1fr)] items-start gap-4 py-2.5 first:pt-0 last:pb-0">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0 break-words text-foreground">{value}</dd>
    </div>)}
  </dl>;
}
