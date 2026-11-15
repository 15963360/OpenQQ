import { cn } from '../lib/utils';

// The mark is the same file the page uses as its favicon (/logo.svg), so there is one drawing to maintain.
export function BrandMark({ className }: { className?: string }) {
  return <img src="/logo.svg" alt="" draggable={false} className={cn('brand-mark size-6 shrink-0 rounded-[6px] shadow-sm', className)} />;
}

export function Brand({ compact, className }: { compact?: boolean; className?: string }) {
  return <span className={cn('flex min-w-0 items-center gap-2.5', className)}>
    <BrandMark />
    {!compact && <span className="truncate text-[15px] font-semibold tracking-[-0.015em] text-foreground">OpenQQ</span>}
  </span>;
}
